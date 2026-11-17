// Closed tasks in a type's views: Done and Dropped left out by the view's own filter, "Status is not
// Done, Dropped", shown with its others but not counted (a phone list's first row is an open task
// that swipes; one closed there stays until the view is left), "Show done and dropped" in the
// phone's Filters sheet and the desktop's Filter menu removing it and adding it back, as the
// person's own choice for the view (an account preference, kept on reload; the view itself is not
// edited), the sheet's count of what is shown (the view's own filter is not counted) and its Done;
// a view whose filter names
// the status, and a board in status columns, list them as before; a new view starts with it.
//   node closed.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode); SHOTS=<dir>: the sheet
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(phone) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-closed-')), phone)
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
      const shot = path.join(tmpdir(), `vasta-closed-${engine}.png`)
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

// The phone's swipe (Chromium: CDP touches; WebKit: touch events in the page).
const cdp = engine === 'webkit' ? undefined : await context.newCDPSession(page)
async function swipe(x, y, dx, steps = 8) {
  if (cdp) {
    const at = (px) => [{ x: px, y, id: 1 }]
    await sleep(700)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x) })
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x + (dx * i) / steps) })
      await sleep(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return
  }
  await page.evaluate(
    async ({ x, y, dx, steps }) => {
      const target = document.elementFromPoint(x, y)
      const touch = (px) => ({ identifier: 1, target, clientX: px, clientY: y, pageX: px, pageY: y })
      const send = (type, t, list) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, { touches: { value: list }, targetTouches: { value: list }, changedTouches: { value: [t] } })
        target.dispatchEvent(event)
      }
      let t = touch(x)
      send('touchstart', t, [t])
      for (let i = 1; i <= steps; i++) {
        t = touch(x + (dx * i) / steps)
        send('touchmove', t, [t])
        await new Promise((r) => setTimeout(r, 16))
      }
      send('touchend', t, [])
    },
    { x, y, dx, steps }
  )
}

// Setup ------------------------------------------------------------------
await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const taskType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const found = await get(`/api/types/${taskType.id}`)
const ids = { list: `${taskType.id}:closedlist`, done: `${taskType.id}:closeddone`, board: `${taskType.id}:closedboard` }
const status = found.properties.find((p) => p.id === 'status')
const original = {
  ...found,
  views: found.views.filter((v) => !Object.values(ids).includes(v.id)),
  properties: found.properties.map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== 'dropped') } : p)),
}
const ours = { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'ClosedCheck' } }
const doneId = status.options.find((o) => o.status === 'done').id
const hiding = { kind: 'filter', field: 'status', operator: 'not-contains', value: { kind: 'literal', value: [doneId, 'dropped'] } }
const hides = (view) => !!view?.filter?.items.some((item) => item.field === 'status' && item.operator === 'not-contains' && item.value.value.includes(doneId) && item.value.value.includes('dropped'))
await put(`/api/types/${taskType.id}`, {
  ...original,
  properties: original.properties.map((p) => (p.id === 'status' ? { ...p, options: [...p.options, { id: 'dropped', label: 'Dropped', status: 'done' }] } : p)),
  views: [
    { id: ids.list, name: 'ClosedList', layout: 'list', sort: [{ field: 'createdAt', direction: 'desc' }], filter: { kind: 'group', operator: 'and', items: [ours, hiding] } },
    { id: ids.done, name: 'ClosedDone', layout: 'list', filter: { kind: 'group', operator: 'and', items: [ours, { kind: 'filter', field: 'status', operator: 'is', value: { kind: 'literal', value: [doneId] } }] } },
    { id: ids.board, name: 'ClosedBoard', layout: 'kanban', groupBy: [{ field: 'status' }], filter: { kind: 'group', operator: 'and', items: [ours] } },
    ...original.views,
  ],
})
await sleep(1500)
for (const object of await get(`/api/spaces/${space.id}/search?q=ClosedCheck&limit=50`)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
const todoId = status.options.find((o) => o.status === 'todo').id
const make = (name, id) => post('/api/objects', { typeId: taskType.id, title: `ClosedCheck ${name} ${tag}`, props: { status: { kind: 'select', value: [id] } } })
// Made in this order, so the newest (listed first) are closed.
const open = await make('Open', todoId)
await sleep(50)
const done = await make('Finished', doneId)
await sleep(50)
const dropped = await make('Dropped', 'dropped')
await sleep(1500)

const row = (task) => page.locator(`main a[href="/o/${task.id}"]`).first()
const openView = async (name) => {
  await page.goto(`${base}/t/${taskType.id}`)
  const picker = page.locator('[data-view-picker]')
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  if (await picker.count()) {
    await picker.click()
    await page.locator('[data-view-option]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first().click()
}
const savedView = async (id) => (await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === id)

try {
  step('phone: a list leaves out Done and Dropped; the first row is open and swipes')
  await openView('ClosedList')
  await row(open).waitFor()
  if ((await row(done).count()) || (await row(dropped).count())) throw new Error('closed tasks are listed')
  const first = page.locator('main [data-swipe-row]').first()
  if (!(await first.locator(`a[href="/o/${open.id}"]`).count())) throw new Error('the first row is not the open task')
  const box = await first.boundingBox()
  await swipe(box.x + box.width - 40, box.y + box.height / 2, -200)
  await until(async () => (await first.getAttribute('data-swipe-open')) !== null, 'a left swipe opens the row')
  step('phone: a task closed here stays until the view is left')
  await first.locator('[data-swipe-button="done"]').click()
  await until(async () => (await get(`/api/objects/${open.id}`)).props.status?.value?.[0] === doneId, 'Done saved')
  await sleep(500)
  if (!(await row(open).count())) throw new Error('the task closed here left the list at once')
  await page.reload()
  await page.locator('[data-filters-button]').waitFor()
  await sleep(1500)
  if (await row(open).count()) throw new Error('the closed task is still listed after a reload')
  const reopened = await get(`/api/objects/${open.id}`)
  await put(`/api/objects/${open.id}`, { ...reopened, props: { ...reopened.props, status: { kind: 'select', value: [todoId] } } })
  await sleep(1500)

  step('phone: the Filters sheet counts nothing of the view\'s own filter, and its switch shows closed tasks for this person only')
  await page.goto(page.url())
  await row(open).waitFor()
  if (await page.locator('[data-filters-count]').count()) throw new Error('the filter button counts the view\'s own filter')
  await page.locator('[data-filters-button]').click()
  const own = (await page.locator('[data-view-filter-text]').textContent())?.trim() ?? ''
  if (!/ClosedCheck/.test(own) || /Done|Dropped/.test(own)) throw new Error(`the view's own filter reads "${own}" (the closed condition is the switch, not listed)`)
  if ((await page.locator('[data-show-closed]').getAttribute('aria-pressed')) !== 'false') throw new Error('the switch is on while they are left out')
  await page.locator('[data-show-closed]').filter({ hasText: 'Show done and dropped' }).click()
  await row(done).waitFor()
  await row(dropped).waitFor()
  await until(async () => ((await get('/api/auth/me')).preferences ?? {})[`type/${taskType.id}/view/${ids.list}/show-closed`] === true, 'the choice kept for the person')
  if (!hides(await savedView(ids.list))) throw new Error('showing closed tasks edited the view')
  await until(async () => /^3 tasks shown$/.test((await page.locator('[data-filters-shown]').textContent())?.trim() ?? ''), 'the sheet counts what is shown')
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `filters-sheet-${engine}.png`) })
  await page.locator('[data-filters-done]').click()
  await until(async () => !(await page.locator('[data-filters-done]').isVisible()), 'Done closes the sheet')
  await page.reload()
  await row(dropped).waitFor()
  if (await page.locator('main [data-swipe-row]').first().locator(`a[href="/o/${dropped.id}"]`).count()) throw new Error('a dropped row swipes')

  step('phone: a view filtering on the status lists what it names')
  await openView('ClosedDone')
  await row(done).waitFor()
  await page.locator('[data-filters-button]').click()
  if ((await page.locator('[data-show-closed]').getAttribute('aria-pressed')) !== 'true') throw new Error('the switch is off where the view asks for Done')
  await page.keyboard.press('Escape')

  step('phone: a board in status columns keeps its Done column')
  await openView('ClosedBoard')
  await page.locator(`main a[href="/o/${done.id}"], main [data-object-id="${done.id}"]`).first().waitFor({ state: 'attached' })

  step('desktop: the Filter menu turns them off again')
  await page.setViewportSize({ width: 1280, height: 900 })
  await openView('ClosedList')
  await row(done).waitFor()
  await page.locator('main button', { hasText: /^\s*Filter/ }).first().click()
  await page.locator('[data-show-closed]').click()
  await until(async () => !(await row(done).count()) && !(await row(dropped).count()), 'closed rows hidden')
  await until(async () => ((await get('/api/auth/me')).preferences ?? {})[`type/${taskType.id}/view/${ids.list}/show-closed`] === false, 'the choice kept for the person')
  if (!hides(await savedView(ids.list))) throw new Error('the view was edited')

  step('desktop: a new view starts with the filter')
  const before = (await get(`/api/types/${taskType.id}`)).views.map((v) => v.id)
  await page.locator('main button[title="Add view"]').click()
  await page.locator('form input').last().fill(`ClosedNew ${tag}`)
  await page.locator('form button[type=submit]').click()
  const added = await until(async () => (await get(`/api/types/${taskType.id}`)).views.find((v) => !before.includes(v.id)), 'the new view saved')
  ids.added = added.id
  if (!hides(added)) throw new Error(`the new view does not leave closed tasks out: ${JSON.stringify(added.filter)}`)

  const unexpected = problems.filter((p) => !/Failed to load resource/.test(p))
  if (unexpected.length) throw new Error(unexpected.join('\n'))
  console.log(`closed: ok (${engine})`)
} finally {
  for (const task of [open, done, dropped]) await page.request.delete(`${base}/api/objects/${task.id}`, { headers }).catch(() => {})
  await put(`/api/types/${taskType.id}`, { ...original, views: (await get(`/api/types/${taskType.id}`)).views.filter((v) => !Object.values(ids).includes(v.id)) }).catch(() => {})
  await browser.close()
}
