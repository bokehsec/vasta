// Many tasks at once in the test env. Desktop: a row's box and Shift-click pick a range, the bulk
// bar's Defer asks once and defers all three with one Undo that restores all, Select all and
// Escape, a click on a row picks it while selecting (it does not open), Move to trash with one
// Undo; process mode through the view with keys (1 Done, → skip, ← back, 2 Defer, the end's counts,
// Escape). Phone (390×844, touch): "Select" in a row's long-press menu, a tap picking another row,
// no swipes while selecting, Done from the bar; process mode full screen, a swipe left skipping.
// Chromium sends real touches (CDP); WebKit gets touch-shaped events in the page and a faked
// `hover: none` (see phone-rows.mjs).
//   node bulk.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const desktop = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch()
async function newContext(options, touch) {
  // WebKit keeps the replica (OPFS) only in a persistent profile.
  const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-bulk-')), options) : await browser.newContext(options)
  if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
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
const viewId = `${taskType.id}:bulk`
const status = found.properties.find((p) => p.id === 'status')
const original = {
  ...found,
  views: found.views.filter((v) => v.id !== viewId),
  properties: found.properties.filter((p) => p.id !== 'dodate').map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== 'scheduled') } : p)),
  quickActions: undefined,
}
const baseStatus = original.properties.find((p) => p.id === 'status')
await put(`/api/types/${taskType.id}`, {
  ...original,
  properties: [...original.properties.map((p) => (p.id === 'status' ? { ...baseStatus, options: [...baseStatus.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }] } : p)), { id: 'dodate', kind: 'date', name: 'Do date' }],
  quickActions: { deferField: 'dodate', deferStatus: 'scheduled' },
  views: [{ id: viewId, name: 'Bulk', layout: 'list', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `Bulk ${tag}` } }] } }, ...original.views],
})
const todo = status.options.find((o) => o.status === 'todo').id
const doneId = status.options.find((o) => o.status === 'done').id
const tasks = []
for (const name of ['A', 'B', 'C', 'D', 'E']) tasks.push(await post('/api/objects', { typeId: taskType.id, title: `Bulk ${tag} ${name}`, props: { status: { kind: 'select', value: [todo] } } }))
await sleep(1500)
const days = await page.evaluate(() => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = key(new Date())
  return { tomorrow: key(new Date(new Date(`${today}T12:00:00`).getTime() + 86400000)) }
})
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const statusOf = async (id) => (await propsOf(id)).status?.value?.[0]
const dodateOf = async (id) => (await propsOf(id)).dodate?.value?.start?.slice(0, 10)
const deleted = async (id) => {
  const response = await page.request.get(`${base}/api/objects/${id}`)
  return !response.ok() || !!(await response.json()).deletedAt
}
// A phone picks a view in the views sheet; a wider screen has tabs.
const openView = async () => {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  if (await page.locator('[data-view-picker]').count()) {
    await page.locator('[data-view-picker]').click()
    await page.locator('[data-view-option]', { hasText: /^\s*Bulk\s*$/ }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: /^\s*Bulk\s*$/ }).first().click()
  await page.locator(`main a[href="/o/${tasks[0].id}"]`).waitFor()
}
const row = (task) => page.locator(`main a[href="/o/${task.id}"]`).first()
const bar = () => page.locator('[data-bulk-bar]')
const count = async () => ((await bar().count()) ? (await page.locator('[data-bulk-count]').innerText()).trim() : '')
const toast = () => page.locator('[role=status]')
/** The rows in the order drawn. */
const drawn = async () => (await page.locator('main a[href^="/o/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href').slice(3)))).filter((id) => tasks.some((t) => t.id === id))

try {
  // ---------------------------------------------------------------------------
  step("desktop: a row's box picks it; Shift-click on another picks the range between")
  await openView()
  const order = await drawn()
  const byId = (id) => tasks.find((t) => t.id === id)
  const [first, second, third, fourth, fifth] = order.map(byId)
  await row(first).hover()
  await row(first).locator('[data-select-row]').click()
  await until(async () => (await count()) === '1 selected', '1 selected')
  await row(third).hover()
  await row(third).locator('[data-select-row]').click({ modifiers: ['Shift'] })
  await until(async () => (await count()) === '3 selected', 'the range: 3 selected')
  if ((await page.locator('main [data-selected]').count()) !== 3) throw new Error('3 rows should look picked')

  step('the bar: Defer asks once, defers all three, one notice; Undo puts all three back')
  await page.locator('[data-bulk-action="defer"]').click()
  await page.locator('[data-defer-menu]').waitFor()
  await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
  for (const t of [first, second, third]) await until(async () => (await dodateOf(t.id)) === days.tomorrow && (await statusOf(t.id)) === 'scheduled', `${t.title} deferred`)
  if ((await dodateOf(fourth.id)) || (await statusOf(fourth.id)) !== todo) throw new Error('a task not picked was deferred')
  await toast().filter({ hasText: '3 tasks' }).waitFor()
  await until(async () => (await bar().count()) === 0, 'the selection cleared after the action')
  await toast().locator('button', { hasText: 'Undo' }).click()
  for (const t of [first, second, third]) await until(async () => !(await dodateOf(t.id)) && (await statusOf(t.id)) === todo, `${t.title} back`)

  step('Select all picks the whole view; Escape clears it')
  await row(second).hover()
  await row(second).locator('[data-select-row]').click()
  await page.locator('[data-bulk-all]').click()
  await until(async () => (await count()) === '5 selected', 'all 5 selected')
  await page.keyboard.press('Escape')
  await until(async () => (await bar().count()) === 0, 'Escape cleared it')

  step('while selecting, a click on a row picks it instead of opening it; Move to trash with one Undo')
  await row(second).hover()
  await row(second).locator('[data-select-row]').click()
  await row(fourth).locator('span.font-medium').first().click()
  await until(async () => (await count()) === '2 selected', 'the clicked row picked')
  if (page.url().includes('/o/')) throw new Error('the click opened the task')
  await page.locator('[data-bulk-trash]').click()
  await until(async () => (await deleted(second.id)) && (await deleted(fourth.id)), 'both in the trash')
  await until(async () => (await row(second).count()) === 0, 'the rows left the list')
  await toast().filter({ hasText: '2 objects' }).locator('button', { hasText: 'Undo' }).click()
  await until(async () => !(await deleted(second.id)) && !(await deleted(fourth.id)), 'both back')

  step('process mode: keys 1 (Done), → skip, ← back, 2 (Defer), to the end, its counts, Escape')
  await openView()
  await page.locator('[data-process]').click()
  const position = page.locator('[data-process-position]')
  const titleNow = async () => (await page.locator('[data-process-title]').innerText()).trim()
  await until(async () => (await position.innerText()).startsWith('1 of 5'), '1 of 5')
  const firstTitle = await titleNow()
  await page.keyboard.press('1')
  await until(async () => (await position.innerText()).startsWith('2 of 5'), 'Done moved on')
  const doneTask = tasks.find((t) => t.title === firstTitle)
  await until(async () => (await statusOf(doneTask.id)) === doneId, 'key 1 ran Done')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await position.innerText()).startsWith('3 of 5'), '→ skipped')
  await page.keyboard.press('ArrowLeft')
  await until(async () => (await position.innerText()).startsWith('2 of 5'), '← went back')
  const deferTitle = await titleNow()
  await page.keyboard.press('2')
  await page.locator('[data-defer-menu]').waitFor()
  await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
  await until(async () => (await position.innerText()).startsWith('3 of 5'), 'Defer moved on')
  await until(async () => (await dodateOf(tasks.find((t) => t.title === deferTitle).id)) === days.tomorrow, 'key 2 deferred')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.locator('[data-process-end]').waitFor()
  const summary = await page.locator('[data-process-summary]').innerText()
  if (!/Done 1/.test(summary) || !/Defer 1/.test(summary) || !/Skipped/.test(summary)) throw new Error(`end summary: ${summary}`)
  await page.keyboard.press('Escape')
  await until(async () => (await page.locator('[data-process-mode]').count()) === 0, 'Escape closed it')
  // Back to "to do" for the phone's turn.
  for (const t of tasks) {
    const object = await get(`/api/objects/${t.id}`)
    await put(`/api/objects/${t.id}`, { ...object, props: { status: { kind: 'select', value: [todo] } } })
  }
  await context.close()

  // ---------------------------------------------------------------------------
  step('phone: "Select" in the long-press menu, a tap picks another row, no swipes while selecting, Done from the bar')
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
  const phoneOrder = (await drawn()).map(byId)
  await row(phoneOrder[0]).dispatchEvent('contextmenu', { clientX: 100, clientY: 300 })
  await tap(page.locator('button', { hasText: /^\s*Select\s*$/ }))
  await until(async () => (await count()) === '1 selected', 'selection mode with one row')
  if ((await page.locator('main [data-swipe-row]').count()) !== 0) throw new Error('swipes are still on while selecting')
  await tap(row(phoneOrder[1]).locator('span.font-medium').first())
  await until(async () => (await count()) === '2 selected', 'a tap picked a second row')
  if (page.url().includes('/o/')) throw new Error('the tap opened the task')
  await tap(page.locator('[data-bulk-action="done"]'))
  for (const t of phoneOrder.slice(0, 2)) await until(async () => (await statusOf(t.id)) === doneId, `${t.title} done from the bar`)
  await tap(toast().locator('button', { hasText: 'Undo' }))
  for (const t of phoneOrder.slice(0, 2)) await until(async () => (await statusOf(t.id)) === todo, `${t.title} back`)

  step('phone: process mode fills the screen; a swipe left skips; Done moves on')
  await openView()
  await tap(page.locator('[data-process]'))
  const dialog = await page.locator('[data-process-mode] [role=dialog]').boundingBox()
  if (dialog.width < 385 || dialog.height < 800) throw new Error(`process mode is not full screen: ${JSON.stringify(dialog)}`)
  const pos = page.locator('[data-process-position]')
  await until(async () => (await pos.innerText()).startsWith('1 of'), 'process mode on the phone')
  const card = await page.locator('[data-process-card]').boundingBox()
  await touchAt(card.x + card.width - 40, card.y + 80, -260, 0, 8)
  await until(async () => (await pos.innerText()).startsWith('2 of'), 'a swipe left skipped')
  await tap(page.locator('[data-process-action="done"]'))
  await until(async () => (await pos.innerText()).startsWith('3 of'), 'Done moved on')
  await tap(page.locator('[data-process-close]'))
  await phoneContext.close()

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll bulk checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-bulk-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  const cleanup = await newContext(desktop)
  page = await login(cleanup)
  for (const t of tasks) await page.request.delete(`${base}/api/objects/${t.id}`, { headers })
  const now = await get(`/api/types/${taskType.id}`)
  await put(`/api/types/${taskType.id}`, { ...now, views: original.views, properties: original.properties, quickActions: undefined }).catch(() => {})
  await browser.close()
}
