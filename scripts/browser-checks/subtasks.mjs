// Subtasks in the test env: Type settings › Subtasks adds a "Part of" field; a task's page lists
// its steps (Add subtask: Return for the next, pasted lines one each, steps taking the parent's
// priority and tags), ticks one, says when all are done with a Done button (never closing the
// parent by itself), and says "still open" when the parent is closed early; a list nests the steps
// under their parent with a caret that folds them and a "2/4" chip, "Nest subtasks" off lists them
// flat, a step whose parent is not listed names it; "Make subtask of…" leaves out the task's own
// steps (no loops); a row's menu takes a step out of its parent; a phone shows the panel at 16px.
//   node subtasks.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-subtasks-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
await context.grantPermissions?.(['clipboard-read', 'clipboard-write']).catch(() => {})
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
// Known noise, not this check's: WebKit's dev server chunk loads, and linkify's late scheme warning.
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) throw new Error(`timed out: ${what}`)
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
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const found = await get(`/api/types/${taskType.id}`)
const listId = `${taskType.id}:steps`
const childId = `${taskType.id}:stepchildren`
const filterOn = (text) => ({ kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: text } }] })
// A failed run may have left a Part of field: start without one.
const original = {
  ...found,
  properties: found.properties.filter((p) => !(p.kind === 'relation' && p.name === 'Part of')),
  views: found.views.filter((v) => v.id !== listId && v.id !== childId),
  subtasks: undefined,
}
await put(`/api/types/${taskType.id}`, {
  ...original,
  views: [{ id: listId, name: 'Steps', layout: 'list', filter: filterOn(tag) }, { id: childId, name: 'StepChildren', layout: 'list', filter: filterOn(`Child one ${tag}`) }, ...original.views],
})
await sleep(1500)

const made = []
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const status = taskType.properties.find((p) => p.id === 'status')
const todo = status.options.find((o) => o.status === 'todo').id
const doneId = status.options.find((o) => o.status === 'done').id
const priority = taskType.properties.find((p) => p.id === 'priority')
const high = priority?.options?.[0]?.id
const tagObject = await post('/api/objects', { typeId: bundle.types.find((t) => t.system === 'tag').id, title: `steptag-${tag}` })
made.push(tagObject)
const parent = await post('/api/objects', { typeId: taskType.id, title: `Parent ${tag}`, props: { status: { kind: 'select', value: [todo] }, ...(high ? { priority: { kind: 'select', value: [high] } } : {}) }, tagIds: [tagObject.id] })
made.push(parent)
await sleep(1200)

const toast = page.locator('[role=status]')
const openView = async (name) => {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main :is(button, [role=button])', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first().click()
}
const row = (id) => page.locator(`main a[href="/o/${id}"]`).first()

try {
  // -------------------------------------------------------------------------
  step('Type settings › Subtasks: "Add a Part of field" makes the relation and sets it')
  await page.goto(`${base}/t/${taskType.id}?settings=1`)
  const select = page.locator('[data-subtask-field]')
  await select.waitFor()
  await select.selectOption({ label: 'Add a “Part of” field' })
  await page.locator('button', { hasText: /^\s*Save\s*$/ }).click()
  const saved = await until(async () => {
    const type = await get(`/api/types/${taskType.id}`)
    return type.subtasks?.parentField ? type : undefined
  }, 'the type saved with a parent field')
  const field = saved.properties.find((p) => p.id === saved.subtasks.parentField)
  if (field?.kind !== 'relation' || field.multiple || field.name !== 'Part of' || field.reverseName !== 'Subtasks') throw new Error(`the field made: ${JSON.stringify(field)}`)
  const partOf = field.id
  const stepsOf = async () => (await get(`/api/spaces/${space.id}/search?q=${encodeURIComponent(tag)}&limit=50`)).filter((o) => o.id !== parent.id && o.typeId === taskType.id)
  await sleep(1000)

  step("a task's page: Add subtask, Return for the next, pasted lines one each; steps take its priority and tags")
  await page.goto(`${base}/o/${parent.id}`)
  const panel = page.locator('[data-subtasks]')
  await panel.waitFor()
  const input = panel.locator('[data-add-subtask]')
  await input.fill(`Child one ${tag}`)
  await input.press('Enter')
  await until(async () => (await panel.locator('[data-subtask]').count()) === 1, 'the first step listed')
  if (!(await input.evaluate((el) => el === document.activeElement))) throw new Error('the cursor left the Add subtask box')
  await input.fill(`Child two ${tag}`)
  await input.press('Enter')
  await until(async () => (await panel.locator('[data-subtask]').count()) === 2, 'the second step listed')
  await input.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, `Child three ${tag}\nChild four ${tag}`)
  await until(async () => (await panel.locator('[data-subtask]').count()) === 4, 'four steps after pasting two lines')
  const steps = await until(async () => {
    const list = await stepsOf()
    return list.length === 4 ? list : undefined
  }, 'four steps saved')
  for (const s of steps) {
    const p = await propsOf(s.id)
    if (p[partOf]?.value?.[0] !== parent.id) throw new Error(`${s.title} does not point to its parent`)
    if (high && p.priority?.value?.[0] !== high) throw new Error(`${s.title} did not take the parent's priority`)
    if (p.status?.value?.[0] === doneId) throw new Error(`${s.title} took a status`)
    const full = await get(`/api/objects/${s.id}`)
    if (!full.tagIds.includes(tagObject.id)) throw new Error(`${s.title} did not take the parent's tag`)
  }
  made.push(...steps)
  const progress = panel.locator('[data-subtask-progress]')
  await until(async () => (await progress.innerText()).includes('0 of 4'), '0 of 4 done')
  if ((await page.locator('.vasta-prop-name', { hasText: /^\s*Subtasks\s*$/ }).count()) !== 0) throw new Error('the Subtasks relation row is still among what links here')

  step('ticking steps: progress, then "All subtasks done" with Done; the parent stays open until pressed')
  const checks = panel.locator('[data-subtask-check]')
  await checks.nth(0).click()
  await until(async () => (await progress.innerText()).includes('1 of 4'), '1 of 4 done')
  for (let i = 1; i < 4; i++) {
    await checks.nth(i).click()
    await until(async () => (await progress.innerText()).includes(`${i + 1} of 4`), `${i + 1} of 4 done`)
  }
  const ready = page.locator('[data-ready-to-close]')
  await ready.waitFor()
  await sleep(800)
  if ((await propsOf(parent.id)).status?.value?.[0] !== todo) throw new Error('the parent closed by itself')
  await ready.locator('[data-close-parent]').click()
  await until(async () => (await propsOf(parent.id)).status?.value?.[0] === doneId, 'Done from the ready line')
  await toast.locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await propsOf(parent.id)).status?.value?.[0] === todo, 'Undo of Done')

  step('closing a parent with a step still open says so')
  await checks.nth(3).click()
  await until(async () => (await progress.innerText()).includes('3 of 4'), 'a step open again')
  await sleep(500)
  await page.locator('[data-quick-actions] button[data-action="done"]').first().click()
  await toast.filter({ hasText: '1 subtask still open' }).waitFor()
  await toast.locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await propsOf(parent.id)).status?.value?.[0] === todo, 'Undo')

  step('a list nests the steps under their parent, with a "3/4" chip; the caret folds them')
  await openView('Steps')
  await row(parent.id).waitFor()
  await until(async () => (await row(steps[0].id).getAttribute('data-depth')) === '1', 'steps at depth 1')
  if ((await row(parent.id).getAttribute('data-depth')) !== '0') throw new Error('the parent is not at the top')
  const order = await page.locator('main a[data-depth]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
  if (order.indexOf(`/o/${parent.id}`) > order.indexOf(`/o/${steps[0].id}`)) throw new Error('a step comes before its parent')
  await until(async () => (await row(parent.id).locator('[data-step-progress]').innerText()).includes('3/4'), 'the 3/4 chip')
  await row(parent.id).locator('[data-fold-steps]').click()
  await until(async () => (await row(steps[0].id).count()) === 0, 'the steps folded')
  if (!page.url().includes(`/t/${taskType.id}`)) throw new Error('the caret opened the task')
  await row(parent.id).locator('[data-fold-steps]').click()
  await row(steps[0].id).waitFor()

  step('"Nest subtasks" off lists them flat, and on again')
  await page.locator('main button').filter({ hasText: /^\s*List\s*$/ }).click()
  await page.locator('[data-nest-subtasks]').click()
  await until(async () => (await page.locator('main a[data-depth]').count()) === 0, 'the list is flat')
  await until(async () => (await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === listId)?.flat === true, 'flat saved on the view')
  await page.locator('main button').filter({ hasText: /^\s*List\s*$/ }).click()
  await page.locator('[data-nest-subtasks]').click()
  await until(async () => (await row(steps[0].id).getAttribute('data-depth')) === '1', 'nested again')
  await until(async () => !('flat' in ((await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === listId) ?? {})), 'nesting saved on the view')

  step('a step whose parent is not listed stays at the top and names its parent')
  await openView('StepChildren')
  const one = steps.find((s) => s.title.startsWith('Child one'))
  await row(one.id).waitFor()
  await until(async () => (await row(one.id).locator('[data-absent-parent]').innerText()).includes(`Parent ${tag}`), 'the parent named under the step')

  step('"Make subtask of…" leaves out the task itself and its own steps')
  await page.goto(`${base}/o/${parent.id}`)
  await page.locator('button[title="More"]').click()
  await page.locator('[data-make-subtask]').click()
  const picker = page.locator('[data-pick-object]')
  await picker.waitFor()
  await picker.locator('input').fill(`Child one ${tag}`)
  await sleep(800)
  if ((await picker.locator('button', { hasText: `Child one ${tag}` }).count()) !== 0) throw new Error('its own step offered as its parent')
  await page.keyboard.press('Escape')
  await until(async () => (await picker.count()) === 0, 'the picker closed')

  step("a row's menu takes a step out of its parent")
  await openView('Steps')
  await row(steps[1].id).waitFor()
  await row(steps[1].id).click({ button: 'right' })
  await page.locator('button', { hasText: /^\s*Remove from parent\s*$/ }).click()
  await until(async () => !(await propsOf(steps[1].id))[partOf], 'the parent field cleared')
  await until(async () => (await row(steps[1].id).getAttribute('data-depth')) === '0', 'the step at the top level')

  step('on a phone the panel shows at 16px with a 16px Add subtask box')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/o/${parent.id}`)
  await panel.waitFor()
  const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  if (size < 16) throw new Error(`the Add subtask box is ${size}px on a phone`)
  const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('main').scrollWidth))
  if (wide > 392) throw new Error(`the page scrolls sideways: ${wide}px`)

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll subtasks checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-subtasks-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  for (const object of made) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
  const now = await get(`/api/types/${taskType.id}`)
  await put(`/api/types/${taskType.id}`, { ...now, properties: original.properties, views: original.views, subtasks: undefined }).catch(() => {})
  await browser.close()
}
