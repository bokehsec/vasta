// Completion feedback in agendas (Phase 3 acceptance): a task marked Done in an agenda filtered to
// open tasks (a type view's, and a query's embedded in a page) saves, then its entry stays where it
// was, checked and struck, past the background refreshes; Undo restores the exact status (In
// progress, not To do); a reload drops it. A repeating task's entry stays at the occurrence just
// done, reading "Done this time · Next: …", and Undo restores the due date too. On a task's page,
// completing a subtask in the panel offers an Undo, and its checkbox undoes it as well, both
// putting the exact status back.
//   node completion-agenda.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
// WebKit's OPFS replica in the test env can fail to open (SQLITE_CORRUPT, a known flake: the app
// falls back to the server's events); its warning is not this check's.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'UTC' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-cf-agenda-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|SQLITE_CORRUPT/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 12000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      const shot = path.join(tmpdir(), `vasta-cf-agenda-${engine}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
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
const del = (id) => page.request.delete(`${base}/api/objects/${id}`, { headers }).catch(() => {})

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

// The browser runs in UTC (above), so its days are the UTC ones.
const dayAt = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const today = dayAt(0)
const week = dayAt(7)
const day = (key) => page.locator(`section[data-agenda-day="${key}"]`)
const entry = (key, title) => day(key).locator('[data-calendar-entry]', { hasText: title })
const listed = async (key, title) => (await entry(key, title).count()) > 0
const struck = async (key, title) => (await entry(key, title).locator('.line-through').count()) === 1

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const pageType = bundle.types.find((t) => t.system === 'page')
const queryType = bundle.types.find((t) => t.system === 'query')
const found = await get(`/api/types/${taskType.id}`)
const status = found.properties.find((p) => p.id === 'status')
const todoId = status.options.find((o) => o.status === 'todo').id
const doingId = status.options.find((o) => o.id === 'doing')?.id ?? status.options.find((o) => o.status === 'doing').id
const doneId = status.options.find((o) => o.status === 'done').id
const viewId = `${taskType.id}:cfagenda${Date.now() % 100000}`
const parentField = `cfpartof${Date.now() % 100000}`

// The agenda view: open tasks only (its "not Done" filter would drop one just completed), the
// tasks picked out by a marker in their titles. A "Part of" field for the subtasks flow later.
const openFilter = (marker) => ({
  kind: 'group',
  operator: 'and',
  items: [
    { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: marker } },
    { kind: 'filter', field: 'status', operator: 'not-contains', value: { kind: 'literal', value: [doneId] } },
  ],
})
const original = { ...found, views: found.views.filter((v) => !v.id.startsWith(`${taskType.id}:cfagenda`)), subtasks: undefined, properties: found.properties.filter((p) => !p.id.startsWith('cfpartof')) }
await put(`/api/types/${taskType.id}`, {
  ...original,
  properties: [...original.properties, { id: parentField, kind: 'relation', name: 'Part of', targetTypeIds: [taskType.id], multiple: false, reverseName: 'Subtasks' }],
  subtasks: { parentField },
  views: [{ id: viewId, name: 'CFAgenda', layout: 'agenda', openIn: 'page', filter: openFilter(tag) }, ...original.views],
})
await sleep(1500)

const made = []
const task = async (name, dueValue) => {
  const created = await post('/api/objects', { typeId: taskType.id, title: `CFAgenda ${name} ${tag}`, props: { status: { kind: 'select', value: [doingId] }, due: dueValue } })
  made.push(created)
  return created
}
const timed = (dayKey) => ({ kind: 'date', value: { start: `${dayKey}T12:00:00.000Z`, resolution: 'time' } })
const apiStatus = async (object) => (await get(`/api/objects/${object.id}`)).props.status?.value?.[0]
const apiDue = async (object) => (await get(`/api/objects/${object.id}`)).props.due?.value
/** Saves the object from outside (a title change), then waits for the agenda's background refresh to show it. */
async function backgroundSave(object, title) {
  const stored = await get(`/api/objects/${object.id}`)
  await put(`/api/objects/${object.id}`, { ...stored, title: `${stored.title} ${title}` })
  for (let i = 0; i < 4 && !(await day(today).locator('[data-calendar-entry]', { hasText: title }).count()); i++) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(1500)
  }
  if (!(await day(today).locator('[data-calendar-entry]', { hasText: title }).count())) console.log(`  (the background save did not reach the agenda in 6s; checked without it)`)
}

let host
try {
  step('a type view as an agenda: Done keeps the entry in place, checked and struck')
  const one = await task('One', timed(today))
  const two = await task('Two', { kind: 'date', value: { start: `${dayAt(1)}T10:00:00.000Z`, resolution: 'time' } })
  await sleep(1500) // the replica pulls them
  await page.goto(`${base}/t/${taskType.id}?view=${viewId}`)
  await until(async () => listed(today, `CFAgenda One ${tag}`), 'the first task under today', 20000)
  await until(async () => listed(dayAt(1), `CFAgenda Two ${tag}`), 'the second task under tomorrow')
  await entry(today, `CFAgenda One ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiStatus(one)) === doneId, 'Done saved')
  await until(async () => (await entry(today, `CFAgenda One ${tag}`).locator('button[title="Mark as to do"]').count()) === 1, 'the checkbox shows it done')
  await until(() => struck(today, `CFAgenda One ${tag}`), 'the title struck through')
  if (await struck(dayAt(1), `CFAgenda Two ${tag}`)) throw new Error('another task struck')

  step('the entry stays past the background refresh')
  await backgroundSave(one, 'synced')
  await until(() => struck(today, `CFAgenda One ${tag} synced`), 'the entry still struck after the background refresh')
  if ((await entry(today, `CFAgenda One ${tag} synced`).locator('button[title="Mark as to do"]').count()) !== 1) throw new Error('the checkbox lost its done state after the background refresh')

  step('Undo returns exactly In progress')
  await entry(today, `CFAgenda One ${tag} synced`).locator('button[title="Mark as to do"]').click()
  await until(async () => (await apiStatus(one)) === doingId, 'Undo returns exactly In progress')
  await until(async () => listed(today, `CFAgenda One ${tag}`) && !(await struck(today, `CFAgenda One ${tag}`)), 'the entry back, unstruck')

  step('a reload drops the completed task')
  await entry(today, `CFAgenda One ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiStatus(one)) === doneId && (await struck(today, `CFAgenda One ${tag}`)), 'Done again, struck')
  await page.reload()
  await until(() => listed(dayAt(1), `CFAgenda Two ${tag}`), 'the view after a reload', 20000)
  await until(async () => !(await listed(today, `CFAgenda One ${tag}`)), 'a fresh view drops the completed task')

  step('a repeating task: the occurrence stays struck with "Done this time · Next: …"; Undo restores the due date')
  const repeat = await task('Repeat', { kind: 'date', value: { start: `${today}T00:00:00.000Z`, resolution: 'day', rrule: 'FREQ=WEEKLY;COUNT=3' } })
  await sleep(1500)
  await page.goto(`${base}/t/${taskType.id}?view=${viewId}`)
  await until(() => listed(today, `CFAgenda Repeat ${tag}`), 'the repeating task under today', 20000)
  await entry(today, `CFAgenda Repeat ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiDue(repeat)).start === `${week}T00:00:00.000Z`, 'the due date advanced a week')
  await until(async () => (await apiStatus(repeat)) === todoId, 'the repeating task reopened as To do (completeRepeat)')
  const note = entry(today, `CFAgenda Repeat ${tag}`).locator('[data-completion-note]')
  await until(async () => (await note.count()) === 1 && /^Done this time · Next: \S/.test((await note.innerText()).trim()), 'the row reads "Done this time · Next: …"')
  if (!(await struck(today, `CFAgenda Repeat ${tag}`))) throw new Error('the repeating row is not struck')
  if ((await entry(today, `CFAgenda Repeat ${tag}`).locator('button[title="Mark as to do"]').count()) !== 1) throw new Error('the repeating checkbox shows done')
  await backgroundSave(repeat, 'synced')
  await until(() => struck(today, `CFAgenda Repeat ${tag} synced`), 'the repeating entry still struck after the background refresh')
  await entry(today, `CFAgenda Repeat ${tag} synced`).locator('button[title="Mark as to do"]').click()
  await until(async () => (await apiDue(repeat)).start === `${today}T00:00:00.000Z`, 'Undo restored the due date')
  await until(async () => (await apiStatus(repeat)) === doingId, 'Undo returned exactly In progress')
  await until(async () => (await note.count()) === 0 && !(await struck(today, `CFAgenda Repeat ${tag}`)), 'the note and strike gone after Undo')
  await entry(today, `CFAgenda Repeat ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiDue(repeat)).start === `${week}T00:00:00.000Z`, 'completed again, advanced once')
  await page.reload()
  await until(() => listed(dayAt(1), `CFAgenda Two ${tag}`), 'the view after a reload', 20000)
  await until(async () => !(await listed(today, `CFAgenda Repeat ${tag}`)), 'a fresh view drops the repeating task')

  step('a query as an agenda in a page: the same')
  const solo = await task('Solo', timed(today))
  const query = await post('/api/objects', { typeId: queryType.id, title: `CFAgenda query ${tag}`, query: { typeIds: [taskType.id], layout: 'agenda', agenda: { days: 3 }, filter: openFilter(tag) } })
  made.push(query)
  host = await post('/api/objects', { typeId: pageType.id, title: `CFAgenda host ${tag}`, content: { body: { type: 'doc', content: [{ type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }, { type: 'paragraph' }] } } })
  await sleep(1500)
  await page.goto(`${base}/o/${host.id}`)
  await until(() => listed(today, `CFAgenda Solo ${tag}`), 'the embedded agenda lists the open task', 20000)
  await entry(today, `CFAgenda Solo ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiStatus(solo)) === doneId, 'Done saved in the embed')
  await until(() => struck(today, `CFAgenda Solo ${tag}`), 'the entry struck in the embed')
  await backgroundSave(solo, 'synced')
  await until(() => struck(today, `CFAgenda Solo ${tag} synced`), 'the entry still struck after the background refresh')
  await entry(today, `CFAgenda Solo ${tag} synced`).locator('button[title="Mark as to do"]').click()
  await until(async () => (await apiStatus(solo)) === doingId, 'Undo returns exactly In progress in the embed')
  await entry(today, `CFAgenda Solo ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await apiStatus(solo)) === doneId && (await struck(today, `CFAgenda Solo ${tag}`)), 'Done again in the embed')
  await page.reload()
  await until(() => listed(dayAt(1), `CFAgenda Two ${tag}`), 'the page after a reload', 20000)
  await until(async () => !(await listed(today, `CFAgenda Solo ${tag}`)), 'a fresh view drops the completed task in the embed')

  step("a task's page: completing a subtask offers an Undo that restores its exact status")
  const parent = await post('/api/objects', { typeId: taskType.id, title: `CFAgenda parent ${tag}`, props: { status: { kind: 'select', value: [doingId] } } })
  made.push(parent)
  const stepTask = async (name) => {
    const created = await post('/api/objects', { typeId: taskType.id, title: `CFAgenda step ${name} ${tag}`, props: { status: { kind: 'select', value: [doingId] }, [parentField]: { kind: 'relation', value: [parent.id] } } })
    made.push(created)
    return created
  }
  const first = await stepTask('one')
  await stepTask('two')
  await sleep(1500)
  await page.goto(`${base}/o/${parent.id}`)
  const panel = page.locator('[data-subtasks]')
  await panel.waitFor()
  await until(async () => (await panel.locator('[data-subtask]').count()) === 2, 'two steps listed', 20000)
  const stepRow = (title) => panel.locator('[data-subtask]', { hasText: title })
  await stepRow(`step one ${tag}`).locator('[data-subtask-check]').click()
  await until(async () => (await apiStatus(first)) === doneId, 'the step saved as done')
  await until(async () => (await stepRow(`step one ${tag}`).locator('.line-through').count()) === 1, 'the step struck through')
  const toast = page.locator('[role=status]')
  await toast.locator('button', { hasText: /^\s*Undo\s*$/ }).waitFor()
  await toast.locator('button', { hasText: /^\s*Undo\s*$/ }).click()
  await until(async () => (await apiStatus(first)) === doingId, "the notice's Undo returns exactly In progress")

  step("the step's checkbox undoes it too")
  await stepRow(`step one ${tag}`).locator('[data-subtask-check]').click()
  await until(async () => (await apiStatus(first)) === doneId, 'Done again')
  await until(async () => (await stepRow(`step one ${tag}`).locator('button[title="Mark as to do"]').count()) === 1, 'the checkbox shows it done')
  await stepRow(`step one ${tag}`).locator('[data-subtask-check]').click()
  await until(async () => (await apiStatus(first)) === doingId, 'the checkbox undoes it back to In progress')
  await until(async () => (await stepRow(`step one ${tag}`).locator('.line-through').count()) === 0, 'the strike gone after Undo')
} catch (error) {
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  if (host) await del(host.id)
  for (const object of made) await del(object.id)
  try {
    const now = await get(`/api/types/${taskType.id}`)
    await put(`/api/types/${taskType.id}`, { ...now, properties: original.properties, views: original.views, subtasks: undefined })
  } catch {}
  await browser.close()
}

if (problems.length) {
  console.log(`console problems:\n  ${problems.join('\n  ')}`)
  process.exitCode = 1
} else console.log('no console problems')
console.log('ok')
