// A task's quick actions in the test env: Done, Defer (Tomorrow, Next week, a day on the calendar) and
// Drop under its tags, with their Undo notices; what Type settings › Quick actions makes them set (a
// "Dropped" status, a "Do date" field and a "Scheduled" status), the "Due …" line and the late note;
// the section showing for Task only; the "Next week" pick in a date property's editor; a phone width.
//   node quick-actions.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
// WebKit has OPFS (the replica) only in a persistent profile.
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-quick-actions-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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
      const shot = path.join(tmpdir(), `vasta-quick-actions-${engine}.png`)
      await page.screenshot({ path: shot })
      console.log('screenshot:', shot)
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
const pageType = bundle.types.find((t) => t.system === 'page')
// A failed run may have left its additions on the type: start from the type without them.
const found = await get(`/api/types/${taskType.id}`)
const originalTask = {
  ...found,
  properties: found.properties
    .filter((p) => p.id !== 'dodate')
    .map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== 'dropped' && o.id !== 'scheduled') } : p)),
  quickActions: undefined,
}
const resetType = async () => {
  await put(`/api/types/${taskType.id}`, originalTask)
  await sleep(1500)
}
await resetType()

// Clean up objects from an earlier failed run.
for (const object of await get(`/api/spaces/${space.id}/search?q=QuickActions&limit=50`)) {
  await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}

// Days as this browser sees them (the page's own clock and locale).
const days = await page.evaluate(() => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const add = (day, n) => key(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86400000))
  const today = key(new Date())
  const info = new Intl.Locale(navigator.language)
  const first = (info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 0) % 7
  const weekday = new Date(`${today}T12:00:00`).getDay()
  const nextWeek = add(today, 7 - ((weekday - first + 7) % 7))
  return { today, tomorrow: add(today, 1), nextWeek, month: today.slice(0, 7) }
})
const dayOf = (value) => value?.value?.start?.slice(0, 10)
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
async function makeTask(title, props) {
  const created = await post('/api/objects', { typeId: taskType.id, title: `QuickActions ${title} ${tag}`, ...(props ? { props } : {}) })
  await sleep(1000) // the replica pulls it
  return created
}
const open = async (task, width) => {
  await page.goto(`${base}/o/${task.id}`)
  await page.waitForSelector('textarea[data-large-text]')
}
const actions = page.locator('[data-quick-actions]')
const button = (label) => actions.locator('button', { hasText: new RegExp(`^\\s*${label}\\s*$`) })
const toast = page.locator('[role=status]')
const dueLine = () => page.locator('[data-defer-menu] p', { hasText: /\bDue\b/ })
const dueRow = () => page.locator('.vasta-prop-row', { has: page.locator('.vasta-prop-name', { hasText: /^\s*Due\s*$/ }) })
const dateDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
step('built-in task: Done and Defer shown, no Drop')
let task = await makeTask('Plain')
await open(task)
await actions.waitFor()
await button('Done').waitFor()
await button('Defer').waitFor()
if ((await button('Drop').count()) !== 0) throw new Error('the built-in task has no second done status, yet Drop is shown')

step('Defer › Tomorrow sets Due; Undo empties it again')
await button('Defer').click()
await page.waitForSelector('[data-defer-menu]')
if ((await dueLine().count()) !== 0) throw new Error('"Due …" shown while Defer sets Due itself')
await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
await until(async () => dayOf((await propsOf(task.id)).due) === days.tomorrow, `Due is ${days.tomorrow}`)
await toast.filter({ hasText: 'Deferred to' }).locator('button', { hasText: 'Undo' }).waitFor()
await until(async () => !(await dueRow().innerText()).includes('Empty'), 'the Due field shows the date')
await toast.locator('button', { hasText: 'Undo' }).click()
await until(async () => (await propsOf(task.id)).due === undefined, 'Due empty after Undo')
await until(async () => (await dueRow().innerText()).includes('Empty'), 'the Due field shows Empty again')

step('Done closes the task and the buttons go; Undo brings them back')
await button('Done').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'done', 'status is done')
await until(async () => (await actions.count()) === 0, 'the buttons are gone')
await toast.filter({ hasText: 'Marked done' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await actions.count()) === 1, 'the buttons are back')
await until(async () => (await propsOf(task.id)).status?.value?.[0] !== 'done', 'status no longer done')
await button('Defer').waitFor()

step('a task already done shows no buttons')
const closed = await makeTask('Closed', { status: { kind: 'select', value: ['done'] } })
await open(closed)
await sleep(500)
if ((await actions.count()) !== 0) throw new Error('quick actions shown on a done task')

// ---------------------------------------------------------------------------
step('Type settings: Quick actions for Task, not for Page')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
if ((await page.locator('[data-quick-action-settings] select').count()) !== 3) throw new Error('expected three selects in Quick actions')
await page.goto(`${base}/t/${pageType.id}?settings=1`)
await page.getByText('Properties', { exact: true }).first().waitFor()
if ((await page.locator('[data-quick-action-settings]').count()) !== 0) throw new Error('Quick actions shown for Page')

// ---------------------------------------------------------------------------
// A "Dropped" and a "Scheduled" status, a "Do date" field, and Task's quick actions pointing at them.
const status = originalTask.properties.find((p) => p.id === 'status')
await put(`/api/types/${taskType.id}`, {
  ...originalTask,
  properties: [
    ...originalTask.properties.map((p) => (p.id === 'status' ? { ...status, options: [...status.options, { id: 'dropped', label: 'Dropped', status: 'done', color: 'red' }, { id: 'scheduled', label: 'Scheduled', status: 'todo', color: 'purple' }] } : p)),
    { id: 'dodate', kind: 'date', name: 'Do date' },
  ],
  quickActions: { deferField: 'dodate', deferStatus: 'scheduled' },
})
await sleep(1500) // the replica pulls the type

step('Type settings shows what was set, and changing it saves')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
const settings = page.locator('[data-quick-action-settings] select')
await until(async () => (await settings.nth(0).inputValue()) === 'dodate' && (await settings.nth(1).inputValue()) === 'scheduled', 'the selects show Do date and Scheduled')
if ((await settings.nth(2).inputValue()) !== '') throw new Error('Drop sets should be on its default')
if (!(await settings.nth(2).locator('option:checked').innerText()).includes('Dropped')) throw new Error('the default Drop is not shown as Dropped')
await settings.nth(1).selectOption('')
await page.locator('button', { hasText: /^\s*Save\s*$/ }).click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.deferStatus === undefined, 'deferStatus cleared by Save')
if ((await get(`/api/types/${taskType.id}`)).quickActions?.deferField !== 'dodate') throw new Error('deferField lost by Save')
await put(`/api/types/${taskType.id}`, { ...(await get(`/api/types/${taskType.id}`)), quickActions: { deferField: 'dodate', deferStatus: 'scheduled' } })
await sleep(1500)

step('Drop sets Dropped and Undo reopens the task')
task = await makeTask('Drop')
await open(task)
await button('Done').waitFor()
await button('Defer').waitFor()
await button('Drop').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'dropped', 'status is dropped')
await until(async () => (await actions.count()) === 0, 'the buttons are gone after Drop')
await toast.filter({ hasText: 'Marked dropped' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await actions.count()) === 1 && (await propsOf(task.id)).status?.value?.[0] !== 'dropped', 'Drop undone')

step('Defer › a day on the calendar sets Do date and Scheduled, not Due')
const picked = `${days.month}-18`
await button('Defer').click()
await page.waitForSelector('[data-defer-menu]')
await page.locator('[data-defer-menu] button', { hasText: /^\s*18\s*$/ }).first().click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === picked && (await propsOf(task.id)).status?.value?.[0] === 'scheduled', `Do date ${picked}, status Scheduled`)
if ((await propsOf(task.id)).due !== undefined) throw new Error('Defer set Due although it sets Do date')
await toast.filter({ hasText: 'Deferred to' }).locator('button', { hasText: 'Undo' }).waitFor()
await toast.locator('button', { hasText: 'Undo' }).click()
await until(async () => (await propsOf(task.id)).dodate === undefined && (await propsOf(task.id)).status?.value?.[0] !== 'scheduled', 'Defer undone')

step('"Due …" in the defer menu; deferring past it says so, before it does not')
const due = `${days.month}-12`
task = await makeTask('Late', { due: { kind: 'date', value: { start: `${due}T00:00:00.000Z`, resolution: 'day' } } })
await open(task)
await button('Defer').click()
await page.waitForSelector('[data-defer-menu]')
await dueLine().waitFor()
if (!(await dueLine().innerText()).includes(dateDay(due))) throw new Error(`Due line: ${await dueLine().innerText()}`)
await page.locator('[data-defer-menu] button', { hasText: /^\s*18\s*$/ }).first().click()
await toast.filter({ hasText: 'after its due date' }).waitFor()
await until(async () => dayOf((await propsOf(task.id)).dodate) === picked, 'Do date set although late')
if (dayOf((await propsOf(task.id)).due) !== due) throw new Error('Due changed')
// Before the due date: no note.
await button('Defer').click()
await page.waitForSelector('[data-defer-menu]')
await page.locator('[data-defer-menu] button', { hasText: /^\s*10\s*$/ }).first().click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === `${days.month}-10`, 'Do date moved to the 10th')
if ((await toast.innerText()).includes('after its due date')) throw new Error('late note shown for a day before Due')

step('a date property with no value offers "Next week": the first day of next week')
task = await makeTask('Next')
await open(task)
await page.locator('.vasta-prop-row', { has: page.locator('.vasta-prop-name', { hasText: /^\s*Do date\s*$/ }) }).locator('button', { hasText: 'Empty' }).click()
await page.locator('[data-overlay] button, [role=dialog] button, body button', { hasText: /^Next week$/ }).last().waitFor()
await page.locator('button', { hasText: /^Next week$/ }).last().click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === days.nextWeek, `Do date is ${days.nextWeek}`)
const diff = (new Date(`${days.nextWeek}T00:00:00Z`) - new Date(`${days.today}T00:00:00Z`)) / 86400000
if (diff < 1 || diff > 7) throw new Error(`next week starts ${diff} days away`)
// With a value there is no Next week pick.
await page.locator('.vasta-prop-row', { has: page.locator('.vasta-prop-name', { hasText: /^\s*Do date\s*$/ }) }).locator('button').first().click()
await sleep(300)
if ((await page.locator('button', { hasText: /^Next week$/ }).count()) !== 0) throw new Error('Next week offered for a date that is set')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------------------
step('phone width: the three buttons show and can be tapped')
await page.setViewportSize({ width: 390, height: 844 })
task = await makeTask('Phone')
await open(task)
await actions.waitFor()
for (const label of ['Done', 'Defer', 'Drop']) {
  const box = await button(label).boundingBox()
  if (!box || box.x < 0 || box.x + box.width > 390 || box.height < 28) throw new Error(`${label} not usable at 390px: ${JSON.stringify(box)}`)
}
await button('Defer').click()
await page.waitForSelector('[data-defer-menu]')
const menu = await page.locator('[data-defer-menu]').boundingBox()
if (menu.x < 0 || menu.x + menu.width > 390) throw new Error(`defer menu outside the screen: ${JSON.stringify(menu)}`)
await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === days.tomorrow, 'Tomorrow tapped on the phone')
await button('Drop').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'dropped', 'Drop tapped on the phone')

// ---------------------------------------------------------------------------
await resetType()
for (const object of await get(`/api/spaces/${space.id}/search?q=QuickActions&limit=50`)) {
  await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}
const noise = problems.filter((p) => !/Failed to load resource/.test(p))
if (noise.length) throw new Error(`console problems:\n${noise.join('\n')}`)
console.log(`\nAll quick-actions checks passed for ${engine}.`)
await browser.close()
