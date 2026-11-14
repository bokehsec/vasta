// Tasks on a phone (390×844, touch): a table view drawn as rows with its columns as row fields and
// no sideways scrolling, the one-time swipe tip, a swipe right deferring (the bottom sheet, Undo), a
// swipe left uncovering Done (and not opening the task), a vertical move that scrolls instead, a
// plain tap still opening the task, the quick actions in a row's long-press menu, "Show as table on
// this phone", a board one column at a time (chips, snapping, a chip jumping to its column), a swipe
// on a task listed by a query embedded in a page, and the desktop table unchanged.
// Swipes: Chromium gets real touches through CDP (Input.dispatchTouchEvent); WebKit gets TouchEvents
// dispatched in the page (plain events carrying touch points: it has no Touch constructor). Headless WebKit has no `hover: none`, so touch is faked in matchMedia there.
//   node phone-rows.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const W = 390
const H = 844
const options = { viewport: { width: W, height: H }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-phone-rows-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
if (engine === 'webkit') {
  await context.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      if (!/hover:\s*none/.test(query)) return original(query)
      return { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
    }
  })
}
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
// Known noise, not this check's: WebKit's dev server chunk loads, and linkify's warning about the
// message: links scheme registered late (both also on the build before this check).
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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
      const shot = path.join(tmpdir(), `vasta-phone-rows-${engine}.png`)
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

// Touches ------------------------------------------------------------------
const cdp = engine === 'webkit' ? undefined : await context.newCDPSession(page)
/** A finger from (x, y) moved by (dx, dy) in steps, then lifted. */
async function swipe(x, y, dx, dy, steps = 8) {
  if (cdp) {
    const at = (px, py) => [{ x: px, y: py, id: 1 }]
    await sleep(700)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x, y) })
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x + (dx * i) / steps, y + (dy * i) / steps) })
      await sleep(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return
  }
  await page.evaluate(
    async ({ x, y, dx, dy, steps }) => {
      const target = document.elementFromPoint(x, y)
      if (!target) throw new Error(`nothing to touch at ${x}, ${y}`)
      // Linux WebKit has no Touch constructor: an event carrying touch-shaped points instead.
      const touch = (px, py) => ({ identifier: 1, target, clientX: px, clientY: py, pageX: px, pageY: py })
      const send = (type, t, list) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, { touches: { value: list }, targetTouches: { value: list }, changedTouches: { value: [t] } })
        return target.dispatchEvent(event)
      }
      let t = touch(x, y)
      send('touchstart', t, [t])
      for (let i = 1; i <= steps; i++) {
        t = touch(x + (dx * i) / steps, y + (dy * i) / steps)
        send('touchmove', t, [t])
        await new Promise((r) => setTimeout(r, 16))
      }
      send('touchend', t, [])
    },
    { x, y, dx, dy, steps }
  )
}
/** A finger's tap at the middle of the element (Chromium: a real touch; WebKit: its touches, then a click). */
async function tap(locator) {
  await locator.waitFor()
  if (!cdp) {
    // WebKit: the touches a tap starts with, then its click (after an open row has settled).
    await sleep(400)
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    await swipe(box.x + box.width / 2, box.y + box.height / 2, 0, 0, 1)
    return locator.click()
  }
  await locator.scrollIntoViewIfNeeded()
  // Chromium's gesture recognizer drops a tap that follows another touch too closely.
  await sleep(700)
  const box = await locator.boundingBox()
  const point = [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point })
  await sleep(40)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(100)
}

// Setup ------------------------------------------------------------------
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
const tableId = `${taskType.id}:phonetable`
const boardId = `${taskType.id}:phoneboard`
const status = found.properties.find((p) => p.id === 'status')
const original = {
  ...found,
  views: found.views.filter((v) => v.id !== tableId && v.id !== boardId),
  properties: found.properties
    .filter((p) => p.id !== 'dodate' && p.id !== 'nextstep')
    .map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== 'dropped' && o.id !== 'scheduled') } : p)),
  quickActions: undefined,
}
const phoneType = {
  ...original,
  properties: [
    ...original.properties.map((p) =>
      p.id === 'status' ? { ...status, options: [...original.properties.find((q) => q.id === 'status').options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'dropped', label: 'Dropped', status: 'done' }] } : p
    ),
    { id: 'dodate', kind: 'date', name: 'Do date' },
    { id: 'nextstep', kind: 'text', name: 'Next step' },
  ],
  quickActions: { deferField: 'dodate', deferStatus: 'scheduled', nextStepField: 'nextstep' },
  views: [
    { id: tableId, name: 'PhoneTable', layout: 'table', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'PhoneRows' } }] }, table: { columns: [{ field: 'title' }, { field: 'quickActions' }, { field: 'status' }, { field: 'due' }, { field: 'tags' }] } },
    { id: boardId, name: 'PhoneBoard', layout: 'kanban', groupBy: [{ field: 'status' }], filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'PhoneRows' } }] } },
    ...original.views,
  ],
}
await put(`/api/types/${taskType.id}`, phoneType)
await sleep(1500) // the replica pulls it
for (const object of await get(`/api/spaces/${space.id}/search?q=PhoneRows&limit=50`)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })

const days = await page.evaluate(() => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = key(new Date())
  return { today, tomorrow: key(new Date(new Date(`${today}T12:00:00`).getTime() + 86400000)) }
})
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const statusOf = async (id) => (await propsOf(id)).status?.value?.[0]
const dodateOf = async (id) => (await propsOf(id)).dodate?.value?.start?.slice(0, 10)
const make = (name, props) => post('/api/objects', { typeId: taskType.id, title: `PhoneRows ${name} ${tag}`, props })
const todo = { kind: 'select', value: [status.options.find((o) => o.status === 'todo').id] }
const a = await make('Alpha', { status: todo, due: { kind: 'date', value: { start: `${days.today}T00:00:00.000Z`, resolution: 'day' } }, nextstep: { kind: 'text', value: 'Call the shop' } })
const b = await make('Bravo', { status: todo })
const c = await make('Charlie', { status: todo })
const made = []
await sleep(1500)

const row = (task) => page.locator(`main a[href="/o/${task.id}"]`).first()
const toast = page.locator('[role=status]')
// A phone picks a view in the views sheet; a wider screen has tabs.
const openView = async (name) => {
  await page.goto(`${base}/t/${taskType.id}`)
  const picker = page.locator('[data-view-picker]')
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  if (await picker.count()) {
    await picker.click()
    await page.locator('[data-view-option]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first().click()
}
const centre = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, box }
}

try {
  // -------------------------------------------------------------------------
  step('a table view on a phone is drawn as rows, with its columns as row fields, no sideways scroll')
  await openView('PhoneTable')
  await page.locator('[data-phone-rows]').waitFor()
  if ((await page.locator('main table').count()) !== 0) throw new Error('a table is still drawn on the phone')
  await row(a).waitFor()
  const fields = await row(a).locator('[data-row-fields]').innerText()
  if (!/To do|Todo|Not started/i.test(fields) && !fields.trim()) throw new Error(`no row fields on the row: "${fields}"`)
  if (!(await row(a).locator('[data-next-step-line]').innerText()).includes('Call the shop')) throw new Error('the next step line is missing')
  const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('main').scrollWidth))
  if (wide > 392) throw new Error(`the page scrolls sideways: ${wide}px wide`)
  if ((await row(a).locator('[data-quick-actions]').count()) !== 0) throw new Error('the row buttons are still shown where swipes replace them')
  const title = await row(a).locator('span.font-medium').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  if (title < 16) throw new Error(`row titles are ${title}px on a phone`)

  step('the swipe tip shows once, says what a right swipe does, and stays hidden')
  const tip = page.locator('[data-swipe-tip]')
  await tip.waitFor()
  if (!(await tip.innerText()).includes('Swipe right to defer')) throw new Error(`tip: ${await tip.innerText()}`)
  await tap(tip.getByRole('button', { name: 'Hide this tip' }))
  await until(async () => (await tip.count()) === 0, 'the tip hides')
  await page.reload()
  await row(a).waitFor()
  await sleep(500)
  if ((await tip.count()) !== 0) throw new Error('the tip came back after a reload')

  step('swipe right past 40%: Defer asks in the bottom sheet, sets the do date and status; Undo')
  let p = await centre(row(a))
  await swipe(60, p.y, W * 0.6, 0)
  await page.locator('[data-quick-ask-sheet]').waitFor()
  if (page.url().includes('/o/')) throw new Error('the swipe opened the task')
  await tap(page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }))
  await until(async () => (await dodateOf(a.id)) === days.tomorrow && (await statusOf(a.id)) === 'scheduled', 'the swipe deferred to tomorrow')
  await tap(toast.filter({ hasText: 'Defer' }).locator('button', { hasText: 'Undo' }))
  await until(async () => !(await dodateOf(a.id)) && (await statusOf(a.id)) === todo.value[0], 'Undo put the task back')

  step('a short swipe right springs back and does nothing')
  p = await centre(row(b))
  await swipe(60, p.y, 60, 0)
  await sleep(500)
  if ((await page.locator('[data-quick-ask-sheet]').count()) !== 0) throw new Error('a short swipe deferred')

  step('swipe left uncovers Done first and More; Done closes the task without opening it')
  await swipe(W - 40, p.y, -200, 0)
  const open = page.locator('[data-swipe-open]')
  await open.waitFor()
  const buttons = await open.locator('[data-swipe-button]').evaluateAll((els) => els.map((e) => e.dataset.swipeButton))
  if (buttons[0] !== 'done' || buttons.at(-1) !== 'more') throw new Error(`swipe buttons: ${buttons}`)
  await tap(open.locator('[data-swipe-button="done"]'))
  await until(async () => (await statusOf(b.id)) !== todo.value[0], 'Done from the swipe')
  if (page.url().includes('/o/')) throw new Error('Done opened the task')
  await tap(toast.locator('button', { hasText: 'Undo' }))
  await until(async () => (await statusOf(b.id)) === todo.value[0], 'Undo of Done')

  step('a tap elsewhere closes an open row')
  p = await centre(row(c))
  await swipe(W - 40, p.y, -200, 0)
  await open.waitFor()
  await tap(page.locator('main h1').first())
  await until(async () => (await open.count()) === 0, 'the open row closed')

  step('a vertical move does not swipe')
  await swipe(200, p.y, 4, -120)
  await sleep(400)
  if ((await open.count()) !== 0 || (await page.locator('[data-quick-ask-sheet]').count()) !== 0) throw new Error('a vertical move swiped the row')
  if (page.url().includes('/o/')) throw new Error('a vertical move opened the task')

  step("the row's menu (long press) lists the quick actions; Defer… asks in the sheet")
  await row(c).dispatchEvent('contextmenu', { clientX: 100, clientY: p.y })
  const deferItem = page.locator('button', { hasText: /^\s*Defer…\s*$/ })
  await deferItem.waitFor()
  await tap(deferItem)
  await page.locator('[data-quick-ask-sheet]').waitFor()
  await tap(page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }))
  await until(async () => (await dodateOf(c.id)) === days.tomorrow, 'Defer from the menu')

  step('a plain tap on a row still opens the task')
  await tap(row(b).locator('span.font-medium').first())
  await page.waitForURL(/\/o\//)

  step('"Show as table on this phone" brings the table back for this view, and off again')
  await openView('PhoneTable')
  await page.locator('[data-phone-rows]').waitFor()
  await tap(page.locator('main button').filter({ hasText: /^\s*Table\s*$/ }))
  await tap(page.locator('[data-phone-table]'))
  await page.locator('main table').waitFor()
  await page.reload()
  await page.locator('main table').waitFor()
  await tap(page.locator('main button').filter({ hasText: /^\s*Table\s*$/ }))
  await tap(page.locator('[data-phone-table]'))
  await page.locator('[data-phone-rows]').waitFor()

  step('a board on a phone: one column at a time, chips with counts jump to a column')
  await openView('PhoneBoard')
  const chips = page.locator('[data-board-chips] [data-board-chip]')
  await until(async () => (await chips.count()) >= 2, 'the column chips')
  const column = page.locator('[data-board-column]').first()
  const columnWidth = (await column.boundingBox()).width
  if (columnWidth < W * 0.8 || columnWidth > W * 0.9) throw new Error(`a column is ${columnWidth}px wide on a ${W}px phone`)
  const snap = await page.locator('[data-drag-scroll]').evaluate((el) => getComputedStyle(el).scrollSnapType)
  if (!snap.includes('x')) throw new Error(`the board does not snap: ${snap}`)
  const second = chips.nth(1)
  const key = await second.getAttribute('data-board-chip')
  await tap(second)
  await until(async () => {
    const box = await page.locator(`[data-board-column="${key}"]`).boundingBox()
    return box && box.x >= 0 && box.x < 40
  }, 'the chip scrolled its column into view')
  await until(async () => (await second.getAttribute('aria-current')) === 'true', 'the chip shows as current')

  step('a task list embedded in a page swipes too (touches reach rows inside the editor)')
  const queryType = bundle.types.find((t) => t.system === 'query')
  const pageType = bundle.types.find((t) => t.system === 'page')
  const query = await post('/api/objects', {
    typeId: queryType.id,
    title: `PhoneRows query ${tag}`,
    query: { typeIds: [taskType.id], layout: 'list', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `PhoneRows Charlie ${tag}` } }] } },
  })
  const host = await post('/api/objects', {
    typeId: pageType.id,
    title: `PhoneRows page ${tag}`,
    content: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Above the list' }] }, { type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }, { type: 'paragraph' }] } },
  })
  made.push(query, host)
  await sleep(1500)
  await page.goto(`${base}/o/${host.id}`)
  const embedded = page.locator(`.ProseMirror [data-swipe-row]:has(a[href="/o/${c.id}"])`)
  await embedded.waitFor({ timeout: 20000 })
  const e = await centre(embedded)
  await swipe(W - 40, e.y, -200, 0)
  await embedded.locator('[data-swipe-button="done"]').waitFor()
  await tap(embedded.locator('[data-swipe-button="done"]'))
  await until(async () => (await statusOf(c.id)) !== todo.value[0], 'Done from a swipe inside the page')
  if (!page.url().includes(host.id)) throw new Error('the swipe left the page')

  step('on a desktop the table is a table, with its buttons')
  await page.setViewportSize({ width: 1400, height: 900 })
  await openView('PhoneTable')
  await page.locator('main table').waitFor()
  if ((await page.locator('[data-phone-rows]').count()) !== 0) throw new Error('rows on a desktop')
  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll phone-rows checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-phone-rows-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  throw error
} finally {
  for (const task of [a, b, c, ...made]) await page.request.delete(`${base}/api/objects/${task.id}`, { headers })
  await put(`/api/types/${taskType.id}`, { ...original, updatedAt: undefined }).catch(() => {})
  await browser.close()
}
