// Rows act one at a time, with no multiselect anywhere: no select box on a row (hovering with a
// mouse on a desktop, ever on a phone), no picked look, no bulk bar. What a row offers still works:
// a desktop's Shift-click opens the task instead of picking a range, the completion circle completes
// (with Undo), and a row's menu (right-click on a desktop, ⋯ or a long press on a phone) lists its
// actions with no Select entry and runs one (Mark done, with Undo). A phone's More menu offers no
// "Select tasks", and a tap on a row opens the task.
// Chromium sends real touches (CDP); WebKit gets touch-shaped events in the page and a faked
// `hover: none` (see phone-rows.mjs).
//   node no-multiselect.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const desktop = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
// WebKit uses only persistent contexts below; a spare browser can block its automation session.
const opened = []
// Playwright's WebKit shares OPFS between contexts (navigator.locks does not span them): two open at
// once with the replica on corrupt its database, so a context that only needs the API runs without it.
async function newContext(options, touch, replica = true) {
  // WebKit keeps the replica (OPFS) only in a persistent profile.
  const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-no-multiselect-')), options) : await browser.newContext(options)
  opened.push(context)
  if (process.env.MODE === 'json' || !replica) await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
  if (touch && engine === 'webkit') {
    await context.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query) =>
        /hover:\s*none/.test(query) ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : original(query)
    })
  }
  return context
}
const problems = []
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
let page
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => {
  const response = await page.request.put(`${base}${url}`, { headers, data })
  if (!response.ok()) throw new Error(`PUT ${url}: ${response.status()} ${await response.text()}`)
  return response.json()
}
async function login(context) {
  const p = context.pages()[0] ?? (await context.newPage())
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|404|TextSelection endpoint|due to access control checks|async component loader|Importing a module script failed|Uncaught error during route navigation|linkifyjs: already initialized|Failed to load resource/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
  p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await p.goto(base)
  await p.fill('#login-username', 'tester')
  await p.fill('#login-password', 'test-password')
  await p.click('button[type=submit]')
  await p.waitForSelector('main', { timeout: 30000 })
  return p
}

const context = await newContext(desktop)
page = await login(context)
const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const found = await get(`/api/types/${taskType.id}`)
const viewId = `${taskType.id}:nosel`
// A failed run may have left its view on the type: start from the type without it.
const original = {
  ...found,
  views: found.views.filter((v) => v.id !== viewId),
}
await put(`/api/types/${taskType.id}`, {
  ...original,
  views: [{ id: viewId, name: 'NoSel', layout: 'list', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `NoSel ${tag}` } }] } }, ...original.views],
})
const status = found.properties.find((p) => p.id === 'status')
const todo = status.options.find((o) => o.status === 'todo').id
const doneId = status.options.find((o) => o.status === 'done').id
const tasks = []
for (const name of ['A', 'B', 'C']) tasks.push(await post('/api/objects', { typeId: taskType.id, title: `NoSel ${tag} ${name}`, props: { status: { kind: 'select', value: [todo] } } }))
await sleep(1500)
const statusOf = async (id) => (await get(`/api/objects/${id}`)).props.status?.value?.[0]
const row = (task) => page.locator(`main a[href="/o/${task.id}"]`).first()
const toast = () => page.locator('[role=status]')
/** Nothing of a selection anywhere: no boxes, no picked look, no bar. */
const nothingSelected = async () => {
  if ((await page.locator('main [data-select-row]').count()) !== 0) throw new Error('a row carries a select box')
  if ((await page.locator('main [data-selected]').count()) !== 0) throw new Error('a row shows as picked')
  if ((await page.locator('[data-bulk-bar]').count()) !== 0) throw new Error('the bulk bar shows')
}
// A phone picks a view in the views sheet; a wider screen has tabs.
const openView = async () => {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  if (await page.locator('[data-view-picker]').count()) {
    await page.locator('[data-view-picker]').click()
    await page.locator('[data-view-option]', { hasText: /^\s*NoSel\s*$/ }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: /^\s*NoSel\s*$/ }).first().click()
  await page.locator(`main a[href="/o/${tasks[0].id}"]`).waitFor()
}
const [a, b, c] = tasks

try {
  // ---------------------------------------------------------------------------
  step('desktop: hovering a row shows no select box, no picked look, no bar')
  await openView()
  await nothingSelected()
  await row(a).hover()
  await nothingSelected()

  step('desktop: Shift-click keeps the browser link behaviour, without picking a range')
  // ObjectLink leaves modified clicks to the browser, which may open a separate window.
  const opening = context.waitForEvent('page', { timeout: 5000 }).catch(() => null)
  await row(b).locator('span.font-medium').first().click({ modifiers: ['Shift'] })
  const opened = await opening
  if (opened) {
    await opened.waitForURL((url) => url.pathname === `/o/${b.id}`)
    await opened.close()
  } else {
    await page.waitForURL((url) => new URLSearchParams(url.search).get('popup') === b.id || url.pathname === `/o/${b.id}`)
    await page.goBack()
  }
  await until(async () => (await row(a).count()) === 1, 'back on the list')
  await nothingSelected()
  if ((await page.locator('main a[href^="/o/"]').count()) < 3) throw new Error('a row went missing after the Shift-click')

  step('desktop: the completion circle still works (Done, then Undo)')
  await row(a).hover()
  const check = row(a).locator('[data-task-check]')
  if ((await check.getAttribute('aria-label')) !== 'Mark as done') throw new Error(`the circle's label: ${await check.getAttribute('aria-label')}`)
  await check.click()
  await until(async () => (await statusOf(a.id)) === doneId, 'the circle completed the task')
  await toast().filter({ hasText: 'Done' }).locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await statusOf(a.id)) === todo, 'Undo put it back to do')
  await nothingSelected()

  step('desktop: the row menu (right-click) has no Select entry; Mark done runs from it, with Undo')
  await row(b).click({ button: 'right' })
  const menu = page.locator('[role=menu]').first()
  await menu.waitFor()
  if (await menu.locator('button', { hasText: /^\s*Select\s*$/ }).count()) throw new Error('the row menu still offers Select')
  await menu.locator('button', { hasText: /^\s*Mark done\s*$/ }).click()
  await until(async () => (await statusOf(b.id)) === doneId, 'Mark done from the menu completed the task')
  await toast().filter({ hasText: 'Done' }).locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await statusOf(b.id)) === todo, 'Undo put it back to do')
  await nothingSelected()
  await context.close()

  // ---------------------------------------------------------------------------
  step('phone: the More menu offers no "Select tasks"')
  const phoneContext = await newContext(phone, true)
  page = await login(phoneContext)
  const cdp = engine === 'webkit' ? undefined : await phoneContext.newCDPSession(page)
  async function touchAt(x, y, dx = 0, dy = 0, steps = 1) {
    await sleep(700)
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps, id: 1 }] })
        await sleep(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      return
    }
    await page.evaluate(
      async ({ x, y, dx, dy, steps }) => {
        const target = document.elementFromPoint(x, y)
        const point = (px, py) => ({ identifier: 1, target, clientX: px, clientY: py, pageX: px, pageY: py })
        const send = (type, t, list) => {
          const event = new Event(type, { bubbles: true, cancelable: true })
          Object.defineProperties(event, { touches: { value: list }, targetTouches: { value: list }, changedTouches: { value: [t] } })
          target.dispatchEvent(event)
        }
        let t = point(x, y)
        send('touchstart', t, [t])
        for (let i = 1; i <= steps; i++) {
          t = point(x + (dx * i) / steps, y + (dy * i) / steps)
          send('touchmove', t, [t])
          await new Promise((r) => setTimeout(r, 16))
        }
        send('touchend', t, [])
      },
      { x, y, dx, dy, steps }
    )
  }
  async function tap(locator) {
    await locator.waitFor()
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    await touchAt(box.x + box.width / 2, box.y + box.height / 2)
    if (!cdp) await locator.click()
    await sleep(150)
  }
  await openView()
  await nothingSelected()
  await page.locator('main header button[title="More"]').click()
  const sheet = page.locator('[data-sheet]')
  await sheet.waitFor()
  if ((await page.locator('[data-select-mode]').count()) !== 0) throw new Error('the More menu still offers Select tasks')
  if (await sheet.locator('button', { hasText: /Select/ }).count()) throw new Error(`a Select entry in the More menu`)
  await page.keyboard.press('Escape')
  await until(async () => (await sheet.count()) === 0, 'the More menu closed')

  step("phone: a row's ⋯ menu lists its actions with no Select; Mark done runs from it, with Undo")
  const more = row(b).locator('[data-row-more]')
  await more.waitFor()
  await tap(more)
  const menuSheet = page.locator('[data-menu-sheet]')
  await menuSheet.waitFor()
  if (await menuSheet.locator('button', { hasText: /^\s*Select\s*$/ }).count()) throw new Error('the row menu still offers Select')
  await tap(menuSheet.locator('button', { hasText: /^\s*Mark done\s*$/ }))
  await until(async () => (await statusOf(b.id)) === doneId, 'Mark done from the row menu completed the task')
  await tap(toast().locator('button', { hasText: 'Undo' }))
  await until(async () => (await statusOf(b.id)) === todo, 'Undo put it back to do')
  await nothingSelected()

  step('phone: the completion circle still works (Done, then Undo)')
  await tap(row(a).locator('[data-task-check]'))
  await until(async () => (await statusOf(a.id)) === doneId, 'the circle completed the task')
  await tap(toast().locator('button', { hasText: 'Undo' }))
  await until(async () => (await statusOf(a.id)) === todo, 'Undo put it back to do')

  step('phone: a tap on a row opens the task (nothing gets picked instead)')
  await tap(row(c).locator('span.font-medium').first())
  await page.waitForURL((url) => new URLSearchParams(url.search).get('popup') === c.id || /\/o\//.test(url.pathname))
  await page.goBack()
  await until(async () => (await row(c).count()) === 1, 'back on the list')
  await nothingSelected()
  await phoneContext.close()

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll no-multiselect checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-no-multiselect-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  console.error(error)
  process.exitCode = 1
} finally {
  try {
    const cleanup = await newContext(desktop, false, false)
    page = await login(cleanup)
    for (const t of tasks) await page.request.delete(`${base}/api/objects/${t.id}`, { headers })
    const now = await get(`/api/types/${taskType.id}`)
    await put(`/api/types/${taskType.id}`, { ...now, views: original.views }).catch(() => {})
  } catch (error) {
    console.error('cleanup failed:', error)
    process.exitCode = 1
  }
  // Every context, the cleanup's too (WebKit's persistent ones are not closed with the browser), then
  // leave: a script that passed must not hang.
  for (const context of opened) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  process.exit(process.exitCode ?? 0)
}
