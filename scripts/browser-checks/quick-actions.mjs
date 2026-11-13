// A task's quick actions in the test env: the default Done, Defer (Tomorrow, Next week, a day on the
// calendar) and Drop under its tags (a button each, [data-action="<id>"]), with their Undo notices;
// what the old settings still shape in the defaults (a "Dropped" status, a "Do date" field and a
// "Scheduled" status), the "Due …" line and the late note; the section showing for Task only; the
// "Next week" pick in a date property's editor; a phone width (list rows, and a table's actions under
// each title).
// Type settings › Quick actions: the defaults listed, the first edit making them the type's own list
// (keeping the other settings), "Use the defaults"; a custom "Waiting" action (Status and a date in 7
// days) on the page and on a row, setting both with Undo; renaming and moving an action up; an
// action that asks for a text field; the "Next step under the title" select.
// Then the same actions on task rows: a view's "Quick actions" toggle (list: on each row; table: a
// "Quick actions" column, hidden by default, second after Title when first shown, then shown, hidden
// and dragged in the Columns menu like any other; Task only), the next step typed on a row (saved,
// Undo, cleared), Done / Drop / Defer from a row without leaving the list, a query with quickActions
// (list) or its checkbox in a table (the column), the next step action on the page too, a phone.
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
  // Row quick actions: the "Plain" view and the toggle are this check's.
  views: found.views.filter((v) => !v.id.endsWith(':plain')).map(({ quickActions, table, ...v }) => ({ ...v, layout: v.layout === 'table' ? 'list' : v.layout })),
  properties: found.properties
    .filter((p) => p.id !== 'dodate' && p.id !== 'nextstep')
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
  return { today, tomorrow: add(today, 1), inWeek: add(today, 7), nextWeek, month: today.slice(0, 7) }
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
const act = (id) => actions.locator(`button[data-action="${id}"]`)
const buttonNames = async () => (await actions.locator('button[data-action]').allInnerTexts()).map((t) => t.trim())
const toast = page.locator('[role=status]')
const dueLine = () => page.locator('[data-defer-menu] p', { hasText: /\bDue\b/ })
const dueRow = () => page.locator('.vasta-prop-row', { has: page.locator('.vasta-prop-name', { hasText: /^\s*Due\s*$/ }) })
const dateDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
step('built-in task: Done and Defer shown, no Drop')
let task = await makeTask('Plain')
await open(task)
await actions.waitFor()
await act('done').waitFor()
await act('defer').waitFor()
if ((await act('drop').count()) !== 0) throw new Error('the built-in task has no second done status, yet Drop is shown')

step('Defer › Tomorrow sets Due; Undo empties it again')
await act('defer').click()
await page.waitForSelector('[data-defer-menu]')
if ((await dueLine().count()) !== 0) throw new Error('"Due …" shown while Defer sets Due itself')
await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
await until(async () => dayOf((await propsOf(task.id)).due) === days.tomorrow, `Due is ${days.tomorrow}`)
await toast.filter({ hasText: 'Defer · Due' }).locator('button', { hasText: 'Undo' }).waitFor()
await until(async () => !(await dueRow().innerText()).includes('Empty'), 'the Due field shows the date')
await toast.locator('button', { hasText: 'Undo' }).click()
await until(async () => (await propsOf(task.id)).due === undefined, 'Due empty after Undo')
await until(async () => (await dueRow().innerText()).includes('Empty'), 'the Due field shows Empty again')

step('Done closes the task and the buttons go; Undo brings them back')
await act('done').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'done', 'status is done')
await until(async () => (await actions.count()) === 0, 'the buttons are gone')
await toast.filter({ hasText: 'Done' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await actions.count()) === 1, 'the buttons are back')
await until(async () => (await propsOf(task.id)).status?.value?.[0] !== 'done', 'status no longer done')
await act('defer').waitFor()

step('a task already done shows no buttons')
const closed = await makeTask('Closed', { status: { kind: 'select', value: ['done'] } })
await open(closed)
await sleep(500)
if ((await actions.count()) !== 0) throw new Error('quick actions shown on a done task')

// ---------------------------------------------------------------------------
step('Type settings: the Task type lists its default actions; Page has none')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
await until(async () => (await page.locator('[data-quick-action]').count()) === 2, 'the built-in task lists two default actions')
if (JSON.stringify(await page.locator('[data-quick-name]').evaluateAll((els) => els.map((e) => e.value))) !== '["Done","Defer"]') throw new Error('the default actions are not Done and Defer')
if ((await page.locator('[data-quick-defaults]').count()) !== 0) throw new Error('"Use the defaults" shown while the type has no list of its own')
if ((await page.locator('[data-next-step-field]').count()) !== 1) throw new Error('no select for the next step field')
if ((await page.locator('[data-quick-action-settings] select').count()) !== 1) throw new Error('the old Defer/Drop selects are still there')
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

step('Type settings: defaults shaped by the old fields; the first edit keeps them; Use the defaults goes back')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
const quickRows = page.locator('[data-quick-action]')
const saveButton = page.locator('button', { hasText: /^\s*Save\s*$/ })
await until(async () => (await quickRows.count()) === 3, 'Done, Defer and Drop are listed')
if (JSON.stringify(await page.locator('[data-quick-name]').evaluateAll((els) => els.map((e) => e.value))) !== '["Done","Defer","Drop"]') throw new Error('the defaults are not Done, Defer, Drop')
const deferSummary = await quickRows.nth(1).innerText()
if (!deferSummary.includes('Do date') || !deferSummary.includes('Scheduled')) throw new Error(`Defer does not say it sets Do date and Scheduled: ${deferSummary}`)
if (!(await quickRows.nth(2).innerText()).includes('Dropped')) throw new Error('Drop does not say it sets Dropped')
if ((await page.locator('[data-quick-defaults]').count()) !== 0) throw new Error('"Use the defaults" shown on the defaults')
await quickRows.nth(2).locator('[data-quick-name]').fill('Drop it')
await quickRows.nth(2).locator('[data-quick-name]').blur()
await page.locator('[data-quick-defaults]').waitFor()
await saveButton.click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.actions?.length === 3, 'the first edit saved the three defaults as the type\'s own list')
{
  const saved = (await get(`/api/types/${taskType.id}`)).quickActions
  if (saved.actions.map((a) => a.id).join() !== 'done,defer,drop' || saved.actions[2].name !== 'Drop it') throw new Error(`own list: ${JSON.stringify(saved.actions)}`)
  if (saved.deferField !== 'dodate' || saved.deferStatus !== 'scheduled') throw new Error(`the edit lost the other settings: ${JSON.stringify(saved)}`)
}
await sleep(1500)
task = await makeTask('Renamed')
await open(task)
await until(async () => (await buttonNames()).join() === 'Done,Defer,Drop it', 'the page shows Drop it')
await act('drop').click()
await toast.filter({ hasText: 'Drop it' }).waitFor()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'dropped', 'the renamed Drop still sets Dropped')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.locator('[data-quick-defaults]').click()
await until(async () => (await page.locator('[data-quick-name]').evaluateAll((els) => els.map((e) => e.value))).join() === 'Done,Defer,Drop', 'the defaults are back, Drop named Drop')
if ((await page.locator('[data-quick-defaults]').count()) !== 0) throw new Error('"Use the defaults" still shown on the defaults')
await saveButton.click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.actions === undefined, 'Use the defaults saved: no list of its own')
if ((await get(`/api/types/${taskType.id}`)).quickActions?.deferField !== 'dodate') throw new Error('Use the defaults dropped the Defer setting')
await put(`/api/types/${taskType.id}`, { ...(await get(`/api/types/${taskType.id}`)), quickActions: { deferField: 'dodate', deferStatus: 'scheduled' } })
await sleep(1500)

step('Drop sets Dropped and Undo reopens the task')
task = await makeTask('Drop')
await open(task)
await act('done').waitFor()
await act('defer').waitFor()
await act('drop').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'dropped', 'status is dropped')
await until(async () => (await actions.count()) === 0, 'the buttons are gone after Drop')
await toast.filter({ hasText: 'Drop' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await actions.count()) === 1 && (await propsOf(task.id)).status?.value?.[0] !== 'dropped', 'Drop undone')

step('Defer › a day on the calendar sets Do date and Scheduled, not Due')
const picked = `${days.month}-18`
await act('defer').click()
await page.waitForSelector('[data-defer-menu]')
await page.locator('[data-defer-menu] button', { hasText: /^\s*18\s*$/ }).first().click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === picked && (await propsOf(task.id)).status?.value?.[0] === 'scheduled', `Do date ${picked}, status Scheduled`)
if ((await propsOf(task.id)).due !== undefined) throw new Error('Defer set Due although it sets Do date')
await toast.filter({ hasText: 'Defer · Do date' }).locator('button', { hasText: 'Undo' }).waitFor()
await toast.locator('button', { hasText: 'Undo' }).click()
await until(async () => (await propsOf(task.id)).dodate === undefined && (await propsOf(task.id)).status?.value?.[0] !== 'scheduled', 'Defer undone')

step('"Due …" in the defer menu; deferring past it says so, before it does not')
const due = `${days.month}-12`
task = await makeTask('Late', { due: { kind: 'date', value: { start: `${due}T00:00:00.000Z`, resolution: 'day' } } })
await open(task)
await act('defer').click()
await page.waitForSelector('[data-defer-menu]')
await dueLine().waitFor()
if (!(await dueLine().innerText()).includes(dateDay(due))) throw new Error(`Due line: ${await dueLine().innerText()}`)
await page.locator('[data-defer-menu] button', { hasText: /^\s*18\s*$/ }).first().click()
await toast.filter({ hasText: 'after its due date' }).waitFor()
await until(async () => dayOf((await propsOf(task.id)).dodate) === picked, 'Do date set although late')
if (dayOf((await propsOf(task.id)).due) !== due) throw new Error('Due changed')
// Before the due date: no note.
await act('defer').click()
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
for (const label of ['done', 'defer', 'drop']) {
  const box = await act(label).boundingBox()
  if (!box || box.x < 0 || box.x + box.width > 390 || box.height < 28) throw new Error(`${label} not usable at 390px: ${JSON.stringify(box)}`)
}
await act('defer').click()
await page.waitForSelector('[data-defer-menu]')
const menu = await page.locator('[data-defer-menu]').boundingBox()
if (menu.x < 0 || menu.x + menu.width > 390) throw new Error(`defer menu outside the screen: ${JSON.stringify(menu)}`)
await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
await until(async () => dayOf((await propsOf(task.id)).dodate) === days.tomorrow, 'Tomorrow tapped on the phone')
await act('drop').click()
await until(async () => (await propsOf(task.id)).status?.value?.[0] === 'dropped', 'Drop tapped on the phone')


// ---------------------------------------------------------------------------
// Quick actions on task rows.
await page.setViewportSize({ width: 1400, height: 900 })
const taskStatus = originalTask.properties.find((p) => p.id === 'status')
const allId = `${taskType.id}:all`
const plainId = `${taskType.id}:plain`
const rowsType = {
  ...originalTask,
  properties: [
    ...originalTask.properties.map((p) => (p.id === 'status' ? { ...taskStatus, options: [...taskStatus.options, { id: 'dropped', label: 'Dropped', status: 'done', color: 'red' }] } : p)),
    { id: 'nextstep', kind: 'text', name: 'Next step' },
  ],
  views: [{ id: allId, name: 'All', layout: 'list' }, { id: plainId, name: 'Plain', layout: 'list' }],
}
await resetType()
await put(`/api/types/${taskType.id}`, rowsType)
await sleep(1500)
const statusOf = async (id) => (await propsOf(id)).status?.value?.[0]
const nextOf = async (id) => (await propsOf(id)).nextstep?.value
const row = (id) => page.locator(`main a[href="/o/${id}"], main tr:has(a[href="/o/${id}"])`).first()
const rowActions = (id) => row(id).locator('[data-quick-actions]')
const rowButton = (id, action) => rowActions(id).locator(`button[data-action="${action}"]`)
const layoutButton = () => page.locator('main button').filter({ hasText: /^\s*(List|Table)\s*$/ })
async function openTasks() {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main button', { hasText: /^\s*All\s*$/ }).first().click() // the view last used is remembered
  await page.getByPlaceholder('Filter…').fill('QuickActions')
}
async function pickLayout(label) {
  await layoutButton().click()
  await page.locator('[data-view-quick-actions]').waitFor()
  await page.locator('button', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click()
}
const headerFields = () => page.locator('main thead th[data-column]').evaluateAll((ths) => ths.map((th) => th.dataset.column))
const savedView = async () => (await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === allId)
async function dragBetween(from, to) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 8)
  await page.mouse.up()
}
const toggleState = async () => {
  await layoutButton().click()
  const toggle = page.locator('[data-view-quick-actions]')
  await toggle.waitFor()
  const on = (await toggle.getAttribute('aria-pressed')) === 'true'
  await page.keyboard.press('Escape')
  return on
}
async function setToggle(on) {
  await layoutButton().click()
  const toggle = page.locator('[data-view-quick-actions]')
  await toggle.waitFor()
  if (((await toggle.getAttribute('aria-pressed')) === 'true') !== on) await toggle.click()
  await page.keyboard.press('Escape')
}

step('Type settings: "Next step under the title in lists" lists the text properties and saves')
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
const nextSelect = page.locator('[data-next-step-field]')
const saveSettings = page.locator('button', { hasText: /^\s*Save\s*$/ })
await until(async () => (await nextSelect.locator('option', { hasText: /^Next step$/ }).count()) === 1, 'the select offers the Next step property')
if ((await nextSelect.inputValue()) !== '') throw new Error('the next step field should start on None')
if ((await nextSelect.locator('option').first().innerText()).trim() !== 'None') throw new Error('first option of the next step field is not None')
if ((await page.locator('[data-quick-action]').count()) !== 3) throw new Error('without a next step field the defaults are Done, Defer, Drop')
await nextSelect.selectOption('nextstep')
await until(async () => (await page.locator('[data-quick-action]').count()) === 4, 'choosing the field adds the Next step action to the list')
await saveSettings.click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.nextStepField === 'nextstep', 'nextStepField saved by Save')
if ((await get(`/api/types/${taskType.id}`)).quickActions?.actions !== undefined) throw new Error('choosing the next step field made the actions the type\'s own')
await sleep(1500)
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
await until(async () => (await nextSelect.inputValue()) === 'nextstep', 'the select shows Next step after a reload')
await nextSelect.selectOption('')
await saveSettings.click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.nextStepField === undefined, 'nextStepField cleared by Save')
await sleep(1500)
await page.goto(`${base}/t/${taskType.id}?settings=1`)
await page.waitForSelector('[data-quick-action-settings]')
await until(async () => (await nextSelect.inputValue()) === '', 'the select shows None after clearing')
await nextSelect.selectOption('nextstep')
await saveSettings.click()
await until(async () => (await get(`/api/types/${taskType.id}`)).quickActions?.nextStepField === 'nextstep', 'nextStepField saved again')
await sleep(1500)

step('a view without the toggle shows no row actions')
const rowTask = await makeTask('Row A')
const rowTask2 = await makeTask('Row B')
const rowTask3 = await makeTask('Row C')
const rowTask4 = await makeTask('Row D')
const closedRow = await makeTask('Row Closed', { status: { kind: 'select', value: ['done'] } })
await openTasks()
await until(async () => (await row(rowTask.id).count()) > 0, 'the list shows the test tasks')
if ((await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('row actions shown before the view turned them on')
if ((await page.locator('main [data-next-step-line]').count()) !== 0) throw new Error('next step line shown without the toggle')

step('the layout menu toggles Quick actions on the view and saves it')
await layoutButton().click()
const toggle = page.locator('[data-view-quick-actions]')
await toggle.waitFor()
if ((await toggle.getAttribute('aria-pressed')) !== 'false') throw new Error('the toggle starts on')
await toggle.click()
await page.keyboard.press('Escape')
await until(async () => (await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === allId)?.quickActions === true, 'view.quickActions saved')
await until(async () => (await rowActions(rowTask.id).count()) === 1, 'the row shows its actions')
for (const id of ['done', 'defer', 'drop', 'next-step']) await rowButton(rowTask.id, id).waitFor()
for (const [id, name] of [['done', 'Done'], ['defer', 'Defer'], ['drop', 'Drop'], ['next-step', 'Next step']]) {
  if ((await rowButton(rowTask.id, id).getAttribute('title')) !== name) throw new Error(`the ${id} row button is not titled ${name}`)
}
if ((await rowActions(closedRow.id).count()) !== 0) throw new Error('a done task shows row actions')
if ((await page.locator('main [data-next-step-line]').count()) !== 0) throw new Error('a next step line shown with no next step')
// The other view of the type keeps its own setting.
await page.locator('main button', { hasText: /^\s*Plain\s*$/ }).click()
await sleep(400)
await page.getByPlaceholder('Filter…').fill('QuickActions')
await until(async () => (await row(rowTask.id).count()) > 0, 'Plain lists the tasks')
if ((await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('the Plain view shows row actions')
await layoutButton().click()
if (((await page.locator('[data-view-quick-actions]').getAttribute('aria-pressed')) ?? '') !== 'false') throw new Error('Plain says Quick actions are on')
await page.keyboard.press('Escape')

step('another type never offers the toggle')
await page.goto(`${base}/t/${pageType.id}`)
await page.locator('main button').filter({ hasText: /^\s*(List|Table|Grid|Wall|Gallery|Board)\s*$/ }).first().click()
await page.locator('button', { hasText: /^\s*Full page\s*$/ }).first().waitFor()
if ((await page.locator('[data-view-quick-actions]').count()) !== 0) throw new Error('Quick actions toggle offered for Page')
await page.keyboard.press('Escape')

step('list: the next step is typed on the row, saved, shown under the title; Undo restores it')
await openTasks()
await rowActions(rowTask.id).waitFor()
const url = page.url()
await rowButton(rowTask.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
await page.locator('[data-next-step] input').fill('Call the plumber')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask.id)) === 'Call the plumber', 'next step saved on the server')
await toast.filter({ hasText: 'Next step' }).locator('button', { hasText: 'Undo' }).waitFor()
await until(async () => (await row(rowTask.id).locator('[data-next-step-line]').innerText().catch(() => '')).includes('Call the plumber'), 'the next step shows under the title')
if (page.url() !== url) throw new Error(`the page moved: ${page.url()}`)
await toast.locator('button', { hasText: 'Undo' }).click()
await until(async () => (await nextOf(rowTask.id)) === undefined, 'Undo emptied the next step')
await until(async () => (await row(rowTask.id).locator('[data-next-step-line]').count()) === 0, 'the line is gone after Undo')
// Change an existing one: the box opens with it; Escape closes without saving.
await rowButton(rowTask.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
await page.locator('[data-next-step] input').fill('Book the flights')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask.id)) === 'Book the flights', 'second next step saved')
await rowButton(rowTask.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
if ((await page.locator('[data-next-step] input').inputValue()) !== 'Book the flights') throw new Error('the box did not open with the saved next step')
await page.locator('[data-next-step] input').fill('Never saved')
await page.keyboard.press('Escape')
await until(async () => (await page.locator('[data-next-step]').count()) === 0, 'Escape closes the box')
await sleep(500)
if ((await nextOf(rowTask.id)) !== 'Book the flights') throw new Error('Escape saved the typed text')
if (page.url() !== url) throw new Error(`Escape moved the page: ${page.url()}`)
// An empty box clears it.
await rowButton(rowTask.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
await page.locator('[data-next-step] input').fill('')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask.id)) === undefined, 'an empty box clears the next step')
await toast.filter({ hasText: 'Next step' }).waitFor()
await until(async () => (await row(rowTask.id).locator('[data-next-step-line]').count()) === 0, 'the line is gone once cleared')
// The page shows the Next step action too, with the same box.
await page.goto(`${base}/o/${rowTask.id}`)
await page.waitForSelector('textarea[data-large-text]')
await actions.waitFor()
await act('next-step').waitFor()
if ((await actions.locator('button[data-action="next-step"]').innerText()).trim() !== 'Next step') throw new Error('the page button is not named Next step')
await act('next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
await page.locator('[data-next-step] input').fill('From the page')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask.id)) === 'From the page', 'the page saved the next step')
await toast.filter({ hasText: 'Next step' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await nextOf(rowTask.id)) === undefined, 'Undo on the page emptied the next step')

step('list: Done from a row closes the task and stays on the list')
await openTasks()
await rowActions(rowTask2.id).waitFor()
const listUrl = page.url()
await rowButton(rowTask2.id, 'done').click()
await until(async () => (await statusOf(rowTask2.id)) === 'done', 'row Done sets done')
await until(async () => (await rowActions(rowTask2.id).count()) === 0, 'the closed row loses its actions')
if (page.url() !== listUrl) throw new Error(`Done navigated to ${page.url()}`)
if ((await row(rowTask2.id).count()) !== 1) throw new Error('the row disappeared from the list')
await toast.filter({ hasText: 'Done' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await statusOf(rowTask2.id)) !== 'done', 'Undo reopened the task')
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the actions are back')
if (page.url() !== listUrl) throw new Error(`Undo navigated to ${page.url()}`)

step('list: Drop and Defer › Tomorrow from a row')
await rowButton(rowTask3.id, 'drop').click()
await until(async () => (await statusOf(rowTask3.id)) === 'dropped', 'row Drop sets dropped')
await until(async () => (await rowActions(rowTask3.id).count()) === 0, 'the dropped row loses its actions')
if (page.url() !== listUrl) throw new Error(`Drop navigated to ${page.url()}`)
await rowButton(rowTask4.id, 'defer').click()
await page.waitForSelector('[data-defer-menu]')
await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
await until(async () => dayOf((await propsOf(rowTask4.id)).due) === days.tomorrow, `row Defer set Due to ${days.tomorrow}`)
await toast.filter({ hasText: 'Defer · Due' }).waitFor()
if (page.url() !== listUrl) throw new Error(`Defer navigated to ${page.url()}`)
if ((await rowActions(rowTask4.id).count()) !== 1) throw new Error('a deferred task lost its actions')

step('list: a click elsewhere on the row still opens the task')
await row(rowTask2.id).locator('span.font-medium').first().click()
await until(async () => new URL(page.url()).pathname === `/o/${rowTask2.id}`, 'the title click opened the task')

step('table: Quick actions is a column of its own, hidden by default; the list toggle does not show it')
// The view has quickActions on from the list steps above: it must not affect a table.
await openTasks()
await pickLayout('Table')
await until(async () => (await row(rowTask2.id).locator('td').count()) > 1, 'the table lists the tasks')
if ((await headerFields()).includes('quickActions')) throw new Error(`the column is shown by default: ${await headerFields()}`)
if ((await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('row actions in a table although the column is hidden')
if ((await toggleState()) !== false) throw new Error('the table toggle starts checked although the column is hidden')
if ((await savedView()).quickActions !== true) throw new Error('view.quickActions lost')

step('table: the toggle shows the column right after Title and saves it')
await setToggle(true)
await until(async () => (await headerFields())[1] === 'quickActions', 'Quick actions is the second column')
if ((await headerFields())[0] !== 'title') throw new Error(`Title is not first: ${await headerFields()}`)
if ((await page.locator('main thead th[data-column="quickActions"]').innerText()).trim() !== 'Quick actions') throw new Error('the column heading is not "Quick actions"')
await until(async () => {
  const columns = (await savedView()).table?.columns ?? []
  return columns[0]?.field === 'title' && columns[1]?.field === 'quickActions' && !columns[1].hidden
}, 'the column is saved second in view.table.columns, not hidden')
if ((await toggleState()) !== true) throw new Error('the toggle is not checked with the column shown')
await until(async () => (await row(rowTask2.id).locator('td').nth(1).locator('[data-quick-actions]').count()) === 1, 'the second cell holds the actions')
if ((await row(rowTask2.id).locator('td [data-quick-actions]').count()) !== 1) throw new Error('actions in more than one cell')
if ((await row(closedRow.id).locator('[data-quick-actions]').count()) !== 0) throw new Error('a done task has actions in the table')
if ((await row(closedRow.id).locator('td').count()) !== (await row(rowTask2.id).locator('td').count())) throw new Error('the done row has a different number of cells')

step('table: Done from the column, with Undo')
const tableUrl = page.url()
await rowButton(rowTask2.id, 'done').click()
await until(async () => (await statusOf(rowTask2.id)) === 'done', 'table Done sets done')
await until(async () => (await rowActions(rowTask2.id).count()) === 0, 'the table row loses its actions')
if (page.url() !== tableUrl) throw new Error(`table Done navigated to ${page.url()}`)
await toast.filter({ hasText: 'Done' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await statusOf(rowTask2.id)) !== 'done', 'table Undo reopened the task')
await openTasks()
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the table is still a table with the column after a reload')
if ((await headerFields())[1] !== 'quickActions') throw new Error(`the column moved on reload: ${await headerFields()}`)

step('table: the Columns menu lists Quick actions; hide and show it')
await page.locator('main button', { hasText: 'Columns' }).click()
const menuRow = page.locator('div[data-column="quickActions"]')
await menuRow.waitFor()
if (!(await menuRow.innerText()).includes('Quick actions')) throw new Error('the Columns menu entry is not named Quick actions')
await menuRow.locator('button[title="Hide column"]').click()
await until(async () => !(await headerFields()).includes('quickActions'), 'the column disappears')
await until(async () => (await savedView()).table?.columns.find((c) => c.field === 'quickActions')?.hidden === true, 'hidden saved on the view')
if ((await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('actions remain with the column hidden')
await menuRow.locator('button[title="Show column"]').click()
await until(async () => (await headerFields())[1] === 'quickActions', 'the column is back, second')
await until(async () => (await savedView()).table?.columns.find((c) => c.field === 'quickActions')?.hidden !== true, 'shown saved on the view')
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the actions are back')

step('table: drag Quick actions to the end in the Columns menu')
await dragBetween(menuRow.locator('[title="Drag to reorder"]'), page.locator('div[data-column]').last())
await until(async () => (await headerFields()).at(-1) === 'quickActions', 'Quick actions is the last column')
if ((await headerFields())[0] !== 'title') throw new Error('Title moved')
await until(async () => {
  const columns = (await savedView()).table?.columns ?? []
  return columns.at(-1)?.field === 'quickActions' && !columns.at(-1).hidden && columns[0].field === 'title'
}, 'the new position is saved')
await page.keyboard.press('Escape')
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the actions work from the last column')
const cells = await row(rowTask2.id).locator('td').count()
await until(async () => (await row(rowTask2.id).locator('td').nth(cells - 2).locator('[data-quick-actions]').count()) === 1 || (await row(rowTask2.id).locator('td').nth(cells - 1).locator('[data-quick-actions]').count()) === 1, 'the actions are in the last column')
// The toggle hides and shows it again where it was left (not back after Title).
await setToggle(false)
await until(async () => !(await headerFields()).includes('quickActions'), 'the toggle hides the column')
await until(async () => (await savedView()).table?.columns.find((c) => c.field === 'quickActions')?.hidden === true, 'the toggle saved hidden')
await setToggle(true)
await until(async () => (await headerFields()).at(-1) === 'quickActions', 'the toggle shows it again at its place')
await until(async () => (await savedView()).table?.columns.at(-1)?.field === 'quickActions', 'its place is kept in the saved columns')

step('table: back to a list the view keeps its own quick actions setting')
if ((await savedView()).quickActions !== true) throw new Error('the table toggling changed view.quickActions')
await pickLayout('List')
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the list shows actions (view.quickActions)')
if ((await toggleState()) !== true) throw new Error('the list toggle is not checked')
await setToggle(false)
await until(async () => (await savedView())?.quickActions === undefined, 'view.quickActions cleared in the list')
await until(async () => (await page.locator('main [data-quick-actions]').count()) === 0, 'the list shows no actions with the toggle off')
if (((await savedView()).table?.columns ?? []).find((c) => c.field === 'quickActions')?.hidden) throw new Error('the list toggle hid the table column')
await setToggle(true)
await until(async () => (await rowActions(rowTask2.id).count()) === 1, 'the list shows actions again')

step('table: a type without tasks does not offer the column')
const otherTypes = [pageType, bundle.types.find((t) => t.name === 'Book')].filter(Boolean)
for (const other of otherTypes) {
  const before = await get(`/api/types/${other.id}`)
  try {
    await put(`/api/types/${other.id}`, { ...before, views: before.views.map((v) => ({ ...v, layout: 'table' })) })
    await sleep(1500)
    await page.goto(`${base}/t/${other.id}`)
    await until(async () => (await page.locator('main thead th[data-column="title"]').count()) === 1, `${other.name} shows a table`)
    if ((await headerFields()).includes('quickActions')) throw new Error(`${other.name}'s table shows Quick actions`)
    await page.locator('main button', { hasText: 'Columns' }).click()
    await page.locator('div[data-column="title"]').waitFor()
    if ((await page.locator('div[data-column="quickActions"]').count()) !== 0) throw new Error(`the Columns menu of ${other.name} offers Quick actions`)
    await page.keyboard.press('Escape')
    await layoutButton().click()
    await page.locator('button', { hasText: /^\s*Full page\s*$/ }).first().waitFor()
    if ((await page.locator('[data-view-quick-actions]').count()) !== 0) throw new Error(`Quick actions toggle offered for ${other.name}'s table`)
    await page.keyboard.press('Escape')
  } finally {
    await put(`/api/types/${other.id}`, before)
    await sleep(1000)
  }
}

// ---------------------------------------------------------------------------
// The type's own quick actions: a "Waiting" action built in Type settings.
step('Type settings: add a "Waiting" action that sets Status and a date 7 days on')
{
  const current = await get(`/api/types/${taskType.id}`)
  const currentStatus = current.properties.find((p) => p.id === 'status')
  await put(`/api/types/${taskType.id}`, {
    ...current,
    properties: [
      ...current.properties.map((p) => (p.id === 'status' ? { ...currentStatus, options: [...currentStatus.options, { id: 'scheduled', label: 'Scheduled', status: 'todo', color: 'purple' }] } : p)),
      { id: 'dodate', kind: 'date', name: 'Do date' },
    ],
  })
  await sleep(1500)
}
const settingsUrl = `${base}/t/${taskType.id}?settings=1`
const quickNames = () => page.locator('[data-quick-name]').evaluateAll((els) => els.map((e) => e.value))
const savedActions = async () => (await get(`/api/types/${taskType.id}`)).quickActions?.actions
await page.goto(settingsUrl)
await page.waitForSelector('[data-quick-action-settings]')
await until(async () => (await quickRows.count()) === 4, 'Done, Defer, Drop and Next step are listed')
if ((await quickNames()).join() !== 'Done,Defer,Drop,Next step') throw new Error(`defaults: ${await quickNames()}`)
if ((await quickRows.nth(3).innerText()).includes('→') === false) throw new Error('an action does not summarize its changes')
await page.locator('[data-quick-add]').click()
await until(async () => (await quickRows.count()) === 5, 'Add action adds a row')
const mine = quickRows.last()
await mine.locator('[data-quick-changes]').waitFor()
await mine.locator('[data-quick-name]').fill('Waiting')
await mine.locator('[data-quick-name]').blur()
const changeRow = (n) => mine.locator('[data-quick-change]').nth(n)
await changeRow(0).locator('select[aria-label="Field"]').selectOption({ label: 'Status' })
await changeRow(0).locator('select[aria-label="Option"]').selectOption({ label: 'Scheduled' })
await mine.locator('[data-quick-add-change]').click()
await until(async () => (await mine.locator('[data-quick-change]').count()) === 2, 'Add change adds a second change')
await changeRow(1).locator('select[aria-label="Field"]').selectOption({ label: 'Do date' })
await changeRow(1).locator('select[aria-label="To"]').selectOption('days')
const daysInput = changeRow(1).locator('input[aria-label="Days"]')
await daysInput.waitFor()
await daysInput.fill('9')
await daysInput.blur()
await until(async () => (await mine.innerText()).includes('in 9 days'), 'the summary follows the Days box')
await daysInput.fill('7')
await daysInput.blur()
await until(async () => (await mine.innerText()).includes('Do date → in 7 days') && (await mine.innerText()).includes('Status → Scheduled'), 'the summary says Status → Scheduled and Do date → in 7 days')
await saveButton.click()
await until(async () => (await savedActions())?.length === 5, 'the new list of five saved')
const waiting = (await savedActions()).at(-1)
if (waiting.name !== 'Waiting' || waiting.changes.length !== 2) throw new Error(`saved action: ${JSON.stringify(waiting)}`)
if (JSON.stringify(waiting.changes[0]) !== JSON.stringify({ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['scheduled'] } } })) throw new Error(`Status change: ${JSON.stringify(waiting.changes[0])}`)
if (JSON.stringify(waiting.changes[1]) !== JSON.stringify({ field: 'dodate', value: { kind: 'day', days: 7 } })) throw new Error(`date change: ${JSON.stringify(waiting.changes[1])}`)
if ((await get(`/api/types/${taskType.id}`)).quickActions?.nextStepField !== 'nextstep') throw new Error('the next step field was lost')
await sleep(1500)

step('Waiting on the page: sets Status and the date, with Undo')
task = await makeTask('Waiting page')
await open(task)
await actions.waitFor()
await until(async () => (await buttonNames()).join() === 'Done,Defer,Drop,Next step,Waiting', 'the page shows the five buttons in order')
await act(waiting.id).click()
await until(async () => (await statusOf(task.id)) === 'scheduled' && dayOf((await propsOf(task.id)).dodate) === days.inWeek, `Status Scheduled and Do date ${days.inWeek}`)
await toast.filter({ hasText: 'Waiting · Do date' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await statusOf(task.id)) !== 'scheduled' && (await propsOf(task.id)).dodate === undefined, 'Undo put Status and Do date back')

step('Waiting on a row: the same, with its name as the title')
await openTasks()
await until(async () => (await rowActions(task.id).count()) === 1, 'the row shows its actions')
if ((await rowButton(task.id, waiting.id).getAttribute('title')) !== 'Waiting') throw new Error('the row button is not titled Waiting')
const rowListUrl = page.url()
await rowButton(task.id, waiting.id).click()
await until(async () => (await statusOf(task.id)) === 'scheduled' && dayOf((await propsOf(task.id)).dodate) === days.inWeek, 'the row action set Status and Do date')
if (page.url() !== rowListUrl) throw new Error(`Waiting navigated to ${page.url()}`)
await toast.filter({ hasText: 'Waiting · Do date' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await statusOf(task.id)) !== 'scheduled' && (await propsOf(task.id)).dodate === undefined, 'Undo on the row put them back')

step('Type settings: rename an action and move another up; the order shows on the page and rows')
await page.goto(settingsUrl)
await until(async () => (await quickRows.count()) === 5, 'five actions listed')
if (!(await quickRows.first().locator('button[title="Move up"]').isDisabled())) throw new Error('Move up is enabled on the first action')
if (!(await quickRows.last().locator('button[title="Move down"]').isDisabled())) throw new Error('Move down is enabled on the last action')
await quickRows.nth(4).locator('button[title="Move up"]').click()
await until(async () => (await quickNames()).join() === 'Done,Defer,Drop,Waiting,Next step', 'Waiting moved above Next step')
await quickRows.nth(2).locator('[data-quick-name]').fill('Shelve')
await quickRows.nth(2).locator('[data-quick-name]').blur()
await until(async () => (await quickNames()).join() === 'Done,Defer,Shelve,Waiting,Next step', 'Drop renamed to Shelve')
await saveButton.click()
await until(async () => (await savedActions())?.map((a) => a.name).join() === 'Done,Defer,Shelve,Waiting,Next step', 'the new order and name saved')
if ((await savedActions()).map((a) => a.id).slice(0, 3).join() !== 'done,defer,drop') throw new Error('renaming changed an id')
await sleep(1500)
await open(task)
await until(async () => (await buttonNames()).join() === 'Done,Defer,Shelve,Waiting,Next step', 'the page shows the new order and name')
await openTasks()
await until(async () => (await rowActions(task.id).locator('button[data-action]').evaluateAll((els) => els.map((e) => e.getAttribute('title')))).join() === 'Done,Defer,Shelve,Waiting,Next step', 'the row shows the new order and name')
await rowButton(task.id, 'drop').click()
await until(async () => (await statusOf(task.id)) === 'dropped', 'Shelve still sets Dropped')
await toast.filter({ hasText: 'Shelve' }).locator('button', { hasText: 'Undo' }).click()
await until(async () => (await statusOf(task.id)) !== 'dropped', 'Undo reopened the task')

step('an action that asks for a text field opens the text box; an empty line clears it')
await page.goto(settingsUrl)
await until(async () => (await quickRows.count()) === 5, 'five actions listed again')
await page.locator('[data-quick-add]').click()
await until(async () => (await quickRows.count()) === 6, 'Add action adds a row')
const asker = quickRows.last()
await asker.locator('[data-quick-name]').fill('Remember')
await asker.locator('[data-quick-name]').blur()
await asker.locator('[data-quick-change]').first().locator('select[aria-label="Field"]').selectOption({ label: 'Next step' })
await asker.locator('[data-quick-change]').first().locator('select[aria-label="To"]').selectOption('ask')
await until(async () => (await asker.innerText()).includes('Next step → ask'), 'the summary says Next step → ask')
await saveButton.click()
await until(async () => (await savedActions())?.length === 6, 'six actions saved')
const asking = (await savedActions()).at(-1)
if (asking.changes.length !== 1 || asking.changes[0].field !== 'nextstep' || asking.changes[0].value.kind !== 'ask') throw new Error(`asking action: ${JSON.stringify(asking)}`)
await sleep(1500)
task = await makeTask('Asking')
await open(task)
await act(asking.id).click()
await page.locator('[data-next-step] input').waitFor()
if ((await page.locator('[data-defer-menu]').count()) !== 0) throw new Error('a text field opened the calendar')
await sleep(300)
await page.locator('[data-next-step] input').fill('Pick up the parcel')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(task.id)) === 'Pick up the parcel', 'the asked text was saved')
await toast.filter({ hasText: 'Remember' }).locator('button', { hasText: 'Undo' }).waitFor()
await act(asking.id).click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
if ((await page.locator('[data-next-step] input').inputValue()) !== 'Pick up the parcel') throw new Error('the box did not open with the current text')
await page.locator('[data-next-step] input').fill('')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(task.id)) === undefined, 'an empty line cleared the field')

step('Use the defaults brings back the four defaults and keeps the next step field')
await page.goto(settingsUrl)
await until(async () => (await quickRows.count()) === 6, 'six actions listed')
await page.locator('[data-quick-defaults]').click()
await until(async () => (await quickNames()).join() === 'Done,Defer,Drop,Next step', 'the four defaults are back, with their names')
await saveButton.click()
await until(async () => (await savedActions()) === undefined, 'Use the defaults saved')
if ((await get(`/api/types/${taskType.id}`)).quickActions?.nextStepField !== 'nextstep') throw new Error('Use the defaults lost the next step field')
await sleep(1500)
await open(task)
await until(async () => (await buttonNames()).join() === 'Done,Defer,Drop,Next step', 'the page shows the four defaults')
await openTasks()
await until(async () => (await rowActions(task.id).count()) === 1, 'the row shows its actions')
if ((await rowButton(task.id, waiting.id).count()) !== 0 || (await rowButton(task.id, asking.id).count()) !== 0) throw new Error('a custom action is still on the row')
if ((await rowActions(task.id).locator('button[data-action]').count()) !== 4) throw new Error('the row does not show four actions')

step('a query with quickActions shows row actions for its tasks')
const queryType = bundle.types.find((t) => t.system === 'query')
const queryObject = await post('/api/objects', { typeId: queryType.id, title: `QuickActions Query ${tag}`, query: { typeIds: [taskType.id], layout: 'list', quickActions: true } })
const plainQuery = await post('/api/objects', { typeId: queryType.id, title: `QuickActions Plain query ${tag}`, query: { typeIds: [taskType.id], layout: 'list' } })
await sleep(1000)
await page.goto(`${base}/o/${plainQuery.id}`)
await until(async () => (await row(rowTask4.id).count()) > 0, 'the plain query lists the tasks')
if ((await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('a query without quickActions shows row actions')
await page.goto(`${base}/o/${queryObject.id}`)
await until(async () => (await rowActions(rowTask4.id).count()) === 1, 'the query row shows its actions')
await until(async () => (await row(closedRow.id).count()) > 0, 'the query lists the done task')
if ((await rowActions(closedRow.id).count()) !== 0) throw new Error('a done task shows actions in the query')
const queryUrl = page.url()
await rowButton(rowTask4.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
await sleep(300)
await page.locator('[data-next-step] input').fill('From the query')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask4.id)) === 'From the query', 'the query row saved the next step')
await until(async () => (await row(rowTask4.id).locator('[data-next-step-line]').innerText().catch(() => '')).includes('From the query'), 'the query row shows the next step')
await rowButton(rowTask4.id, 'drop').click()
await until(async () => (await statusOf(rowTask4.id)) === 'dropped', 'the query row Drop sets dropped')
if (page.url() !== queryUrl) throw new Error(`the query row moved the page: ${page.url()}`)
// The query's own checkbox sets it, in the editor.
await page.goto(`${base}/o/${plainQuery.id}`)
const queryBox = page.locator('label', { hasText: /^\s*Quick actions\s*$/ }).locator('input[type=checkbox]')
await queryBox.waitFor()
if (await queryBox.isChecked()) throw new Error('the checkbox starts checked')
await queryBox.check()
await until(async () => (await get(`/api/objects/${plainQuery.id}`)).query?.quickActions === true, 'the query checkbox saved quickActions')
await until(async () => (await rowActions(rowTask.id).count()) === 1, 'the query shows actions after the checkbox')
await queryBox.uncheck()
await until(async () => (await get(`/api/objects/${plainQuery.id}`)).query?.quickActions === undefined, 'unchecking removed quickActions')
await until(async () => (await rowActions(rowTask.id).count()) === 0, 'the query shows no actions after unchecking')

step('a query in a table: its Quick actions checkbox shows the column')
const tableQuery = await post('/api/objects', { typeId: queryType.id, title: `QuickActions Table query ${tag}`, query: { typeIds: [taskType.id], layout: 'table' } })
await sleep(1000)
await page.goto(`${base}/o/${tableQuery.id}`)
const tableBox = page.locator('label', { hasText: /^\s*Quick actions\s*$/ }).locator('input[type=checkbox]')
await tableBox.waitFor()
await until(async () => (await row(rowTask4.id).locator('td').count()) > 1, 'the query shows a table')
if ((await headerFields()).includes('quickActions') || (await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('the query table shows the column by default')
if (await tableBox.isChecked()) throw new Error('the table query checkbox starts checked')
await tableBox.check()
await until(async () => (await headerFields())[1] === 'quickActions', 'the query table shows the column after Title')
await until(async () => {
  const saved = (await get(`/api/objects/${tableQuery.id}`)).query
  return saved?.table?.columns?.[1]?.field === 'quickActions' && !saved.table.columns[1].hidden && saved.quickActions === undefined
}, 'the query saved the column (not quickActions)')
await until(async () => (await rowActions(rowTask.id).count()) === 1, 'the query table rows show actions')
if (!(await tableBox.isChecked())) throw new Error('the checkbox is not checked with the column shown')
await page.locator('main button', { hasText: 'Columns' }).click()
await page.locator('div[data-column="quickActions"]').waitFor()
await page.keyboard.press('Escape')
await tableBox.uncheck()
await until(async () => !(await headerFields()).includes('quickActions'), 'unchecking hides the column')
await until(async () => (await get(`/api/objects/${tableQuery.id}`)).query?.table?.columns?.find((c) => c.field === 'quickActions')?.hidden === true, 'the query saved it hidden')
// A table query with the old list setting does not show the column.
const oldQuery = await post('/api/objects', { typeId: queryType.id, title: `QuickActions Old query ${tag}`, query: { typeIds: [taskType.id], layout: 'table', quickActions: true } })
await sleep(1000)
await page.goto(`${base}/o/${oldQuery.id}`)
await until(async () => (await row(rowTask4.id).locator('td').count()) > 1, 'the old query shows a table')
if ((await headerFields()).includes('quickActions') || (await page.locator('main [data-quick-actions]').count()) !== 0) throw new Error('query.quickActions affects a table')

step('phone width: the row buttons are visible and inside the screen')
await page.setViewportSize({ width: 390, height: 844 })
await openTasks()
await until(async () => (await rowActions(rowTask.id).count()) === 1, 'the phone list shows actions')
for (const title of ['done', 'defer', 'drop', 'next-step']) {
  const box = await rowButton(rowTask.id, title).boundingBox()
  if (!box || box.x < 0 || box.x + box.width > 390 || box.width < 28 || box.height < 28) throw new Error(`${title} not usable at 390px: ${JSON.stringify(box)}`)
}
if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) throw new Error('the phone list scrolls sideways')
// In a narrow list the actions wrap onto a line of their own under the title.
const titleBox = await row(rowTask.id).locator('span.font-medium').first().boundingBox()
const actionsBox = await rowActions(rowTask.id).boundingBox()
if (!titleBox || !actionsBox || actionsBox.y < titleBox.y + titleBox.height - 1) throw new Error(`the actions are not below the title: title ${JSON.stringify(titleBox)}, actions ${JSON.stringify(actionsBox)}`)
if (actionsBox.x < 0 || actionsBox.x + actionsBox.width > 390) throw new Error(`the actions line is outside the screen: ${JSON.stringify(actionsBox)}`)
await rowButton(rowTask.id, 'next-step').click()
await page.locator('[data-next-step] input').waitFor()
const form = await page.locator('[data-next-step]').boundingBox()
if (form.x < 0 || form.x + form.width > 390) throw new Error(`next step box outside the screen: ${JSON.stringify(form)}`)
await page.locator('[data-next-step] input').fill('On the phone')
await sleep(300)
await page.keyboard.press('Enter')
await until(async () => (await nextOf(rowTask.id)) === 'On the phone', 'next step typed on the phone')
const line = await row(rowTask.id).locator('[data-next-step-line]').boundingBox()
if (!line || line.x < 0 || line.x + line.width > 390) throw new Error(`next step line outside the screen: ${JSON.stringify(line)}`)
await rowButton(rowTask.id, 'done').click()
await until(async () => (await statusOf(rowTask.id)) === 'done', 'Done tapped on the phone')

step('phone width: a table puts its Quick actions under each title instead of a column')
await page.setViewportSize({ width: 1400, height: 900 })
await page.goto(`${base}/o/${tableQuery.id}`)
await tableBox.waitFor()
await tableBox.check()
await until(async () => (await headerFields()).includes('quickActions'), 'the desktop table shows the column')
await page.setViewportSize({ width: 390, height: 844 })
await until(async () => !(await headerFields()).includes('quickActions'), 'the phone table has no Quick actions column')
const underTitle = page.locator('main tbody td:first-child [data-quick-actions]').first()
await underTitle.waitFor()
const underBox = await underTitle.boundingBox()
if (!underBox || underBox.x < 0 || underBox.x + underBox.width > 390) throw new Error(`the actions under the title are outside the screen: ${JSON.stringify(underBox)}`)
await page.setViewportSize({ width: 1400, height: 900 })
await until(async () => (await headerFields()).includes('quickActions') && (await page.locator('main tbody td:first-child [data-quick-actions]').count()) === 0, 'back on a wide screen the column returns')
await tableBox.uncheck()

// ---------------------------------------------------------------------------
await resetType()
for (const object of await get(`/api/spaces/${space.id}/search?q=QuickActions&limit=50`)) {
  await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}
const noise = problems.filter((p) => !/Failed to load resource/.test(p))
if (noise.length) throw new Error(`console problems:\n${noise.join('\n')}`)
console.log(`\nAll quick-actions checks passed for ${engine}.`)
await browser.close()
