// What a task's dates mean, in the test env (America/Toronto): Type settings' "Meaning" of a date (plan,
// deadline or a plain date; one of each, so choosing the plan for another date takes it off the old
// one, saved on the property); Defer writes the Do date and keeps Due; a timed Do date keeps its time of
// day when deferred, a repeating one moves only this occurrence (an exception, the rule and later
// occurrences stay); a repeating task done goes on to its next occurrence and a Do date on or before
// the one done is cleared, with Undo putting both back; Due for review in a view's filter lists the
// review's check-ins (not new tasks, not closed ones).
//   node date-roles.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[123]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
// WebKit has OPFS (the replica) only in a persistent profile.
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-date-roles-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|Working without a local replica: Error: SQLITE_CORRUPT/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      await page.screenshot({ path: path.join(tmpdir(), `vasta-date-roles-${engine}.png`) })
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => {
  const response = await page.request.put(`${base}${url}`, { headers, data })
  if (!response.ok()) throw new Error(`PUT ${url}: ${response.status()} ${await response.text()}`)
  return response.json()
}

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const original = await get(`/api/types/${taskType.id}`)
const withCheckback = {
  ...original,
  properties: [...original.properties.filter((p) => p.id !== 'checkback'), { id: 'checkback', kind: 'date', name: 'Check back' }],
  quickActions: undefined,
}
const resetType = async () => {
  await put(`/api/types/${taskType.id}`, withCheckback)
  await sleep(1500)
}
const savedType = async () => get(`/api/types/${taskType.id}`)
const roleOf = async (id) => (await savedType()).properties.find((p) => p.id === id)?.role
const days = await page.evaluate(() => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const add = (day, n) => key(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86400000))
  const today = key(new Date())
  const info = new Intl.Locale(navigator.language)
  const first = (info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 0) % 7
  const weekday = new Date(`${today}T12:00:00`).getDay()
  return { today, tomorrow: add(today, 1), inWeek: add(today, 7), inTenDays: add(today, 10), nextWeek: add(today, 7 - ((weekday - first + 7) % 7)) }
})
// A local wall-clock time on a day, as an instant.
const at = (day, hour, minute) => page.evaluate(([d, h, m]) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString(), [day, hour, minute])
const dayOnly = (day) => ({ kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } })
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const dayOf = (value) => value?.value?.start?.slice(0, 10)
const toast = page.locator('[role=status]')
const actions = page.locator('[data-quick-actions]')
const act = (id) => actions.locator(`button[data-action="${id}"]`)
const status = original.properties.find((p) => p.id === 'status')
const todo = status.options.find((o) => o.status === 'todo').id
async function makeTask(title, props) {
  const created = await post('/api/objects', { typeId: taskType.id, title: `DateRoles ${title} ${tag}`, props: { status: { kind: 'select', value: [todo] }, ...props } })
  await sleep(1000) // the replica pulls it
  return created
}
async function open(task) {
  await page.goto(`${base}/o/${task.id}`)
  await page.waitForSelector('textarea[data-large-text]')
  await actions.waitFor()
}

try {
  await resetType()
  for (const object of await get(`/api/spaces/${space.id}/search?q=DateRoles&limit=50`)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })

  step('the built-in Task: Due is the deadline, Do date the plan')
  if ((await roleOf('due')) !== 'deadline') throw new Error(`Due is ${await roleOf('due')}`)
  if ((await roleOf('dodate')) !== 'plan') throw new Error(`Do date is ${await roleOf('dodate')}`)

  step('Type settings: a date\'s Meaning; the plan is one date, so choosing it for Check back takes it off Do date')
  await page.goto(`${base}/t/${taskType.id}?settings=1`)
  await page.waitForSelector('[data-quick-action-settings]')
  const index = (id) => withCheckback.properties.findIndex((p) => p.id === id)
  const meaning = page.locator('[data-date-role]')
  await page.locator('button[title="Options"]').nth(index('dodate')).click()
  if ((await meaning.inputValue()) !== 'plan') throw new Error(`Do date shows ${await meaning.inputValue()}`)
  await page.locator('button[title="Options"]').nth(index('dodate')).click()
  await page.locator('button[title="Options"]').nth(index('checkback')).click()
  if ((await meaning.inputValue()) !== '') throw new Error(`Check back shows ${await meaning.inputValue()}`)
  await meaning.selectOption('plan')
  await page.locator('button[title="Options"]').nth(index('dodate')).click()
  if ((await meaning.inputValue()) !== '') throw new Error(`Do date kept its meaning: ${await meaning.inputValue()}`)
  await page.locator('button', { hasText: /^\s*Save\s*$/ }).click()
  await until(async () => (await roleOf('checkback')) === 'plan' && (await roleOf('dodate')) === undefined, 'Check back is the plan, Do date plain')
  if ((await roleOf('due')) !== 'deadline') throw new Error('the deadline lost its role')
  await resetType()
  await put(`/api/types/${taskType.id}`, { ...(await savedType()), properties: (await savedType()).properties.map((p) => (p.id === 'checkback' ? { ...p, role: undefined } : p)) })
  await resetType()

  step('Defer › Next week sets the Do date in one tap and leaves Due alone, a timed Due keeps its time')
  const due = await at(days.inTenDays, 9, 0)
  let task = await makeTask('Timed due', { due: { kind: 'date', value: { start: due, resolution: 'time' } } })
  await open(task)
  await act('defer').click()
  await page.waitForSelector('[data-defer-menu]')
  await page.locator('[data-defer-menu] button', { hasText: /^Next week$/ }).click()
  await until(async () => dayOf((await propsOf(task.id)).dodate) === days.nextWeek, `Do date is ${days.nextWeek}`)
  if ((await propsOf(task.id)).due.value.start !== due) throw new Error('Defer moved Due')

  step('a timed Do date keeps its time of day when deferred')
  const planned = await at(days.today, 15, 30)
  task = await makeTask('Timed plan', { dodate: { kind: 'date', value: { start: planned, resolution: 'time' } } })
  await open(task)
  await act('defer').click()
  await page.waitForSelector('[data-defer-menu]')
  await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
  await until(async () => (await propsOf(task.id)).dodate?.value.start === (await at(days.tomorrow, 15, 30)), 'the Do date is tomorrow at 15:30')
  if ((await propsOf(task.id)).dodate.value.resolution !== 'time') throw new Error('the Do date lost its time')
  await toast.locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await propsOf(task.id)).dodate?.value.start === planned, 'Undo put the time back')

  step('a repeating Do date: Defer moves only this occurrence, the series stays')
  task = await makeTask('Repeating plan', { dodate: { kind: 'date', value: { start: `${days.today}T00:00:00.000Z`, resolution: 'day', rrule: 'FREQ=WEEKLY' } } })
  await open(task)
  await act('defer').click()
  await page.waitForSelector('[data-defer-menu]')
  await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
  await until(async () => (await propsOf(task.id)).dodate?.value.exceptions, 'the occurrence moved by an exception')
  {
    const value = (await propsOf(task.id)).dodate.value
    if (value.start !== `${days.today}T00:00:00.000Z` || value.rrule !== 'FREQ=WEEKLY') throw new Error(`the series changed: ${JSON.stringify(value)}`)
    if (value.exceptions[`${days.today}T00:00:00.000Z`]?.start !== `${days.tomorrow}T00:00:00.000Z`) throw new Error(`exceptions: ${JSON.stringify(value.exceptions)}`)
  }
  await toast.locator('button', { hasText: 'Undo' }).click()
  await until(async () => !(await propsOf(task.id)).dodate.value.exceptions, 'Undo took the exception off')

  step('a repeating task done: Due goes on, a Do date on or before the one done is cleared, Undo puts both back')
  const weekly = { kind: 'date', value: { start: `${days.today}T00:00:00.000Z`, resolution: 'day', rrule: 'FREQ=WEEKLY' } }
  task = await makeTask('Repeating task', { due: weekly, dodate: dayOnly(days.today) })
  await open(task)
  await act('done').click()
  await until(async () => dayOf((await propsOf(task.id)).due) === days.inWeek, 'Due is a week on')
  await until(async () => (await propsOf(task.id)).dodate === undefined, 'the Do date was cleared')
  if ((await propsOf(task.id)).status.value[0] !== todo) throw new Error('the task did not go back to to do')
  await toast.locator('button', { hasText: 'Undo' }).click()
  await until(async () => dayOf((await propsOf(task.id)).due) === days.today && dayOf((await propsOf(task.id)).dodate) === days.today, 'Undo put Due and the Do date back')
  // A Do date after the occurrence done is the next time's.
  task = await makeTask('Later plan', { due: weekly, dodate: dayOnly(days.inWeek) })
  await open(task)
  await act('done').click()
  await until(async () => dayOf((await propsOf(task.id)).due) === days.inWeek, 'Due is a week on')
  if (dayOf((await propsOf(task.id)).dodate) !== days.inWeek) throw new Error('a later Do date was cleared')

  step('Due for review (a view\'s filter) is the review\'s check-ins: not new tasks, not closed ones')
  const reviewable = await get(`/api/types/${taskType.id}`)
  const hasReviewed = reviewable.properties.some((p) => p.id === 'reviewed')
  if (hasReviewed) {
    const done = status.options.find((o) => o.status === 'done').id
    const open1 = await makeTask('Check-in', {})
    const fresh = await post('/api/objects', { typeId: taskType.id, title: `DateRoles New ${tag}` })
    const closed = await makeTask('Closed', { status: { kind: 'select', value: [done] } })
    const found = await post(`/api/spaces/${space.id}/query`, { query: { typeIds: [taskType.id], filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'reviewDue', operator: 'is-checked' }, { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `DateRoles` } }] } } })
    const titles = (found.objects ?? found).map((o) => o.title)
    if (!titles.includes(open1.title)) throw new Error(`the check-in is not listed: ${titles}`)
    if (titles.includes(fresh.title)) throw new Error('a new task is listed as due for review')
    if (titles.includes(closed.title)) throw new Error('a closed task is listed as due for review')
  }

  if (problems.length) throw new Error(`console problems:\n${problems.join('\n')}`)
  console.log(`All date role checks passed for ${engine}.`)
} finally {
  await put(`/api/types/${taskType.id}`, original).catch(() => {})
  for (const object of await get(`/api/spaces/${space.id}/search?q=DateRoles&limit=50`).catch(() => [])) await page.request.delete(`${base}/api/objects/${object.id}`, { headers }).catch(() => {})
  await browser.close()
}
