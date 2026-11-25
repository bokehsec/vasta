// Review tasks, a day in one press: Schedule…'s question has Today first (the Do date set to today; a
// new task also goes to Next, not Scheduled: what the Today button did before it was dropped) and
// Tomorrow, which place a new task (the type's Defer only sets the day, the default; Tomorrow puts it in
// Scheduled); both settle the task and go on, with Undo. A task that has its place keeps it. Keys S, then
// T inside the question. There is no Today button. Phone (the tray) and desktop.
// node review-today.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica; SHOTS=<dir>
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const options = { viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-today-')), options) : await browser.newContext(options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const headers = { 'x-requested-with': 'vasta' }
async function request(method, route, data) {
  const response = await page.request[method](`${base}${route}`, { headers, data })
  assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`)
  return response.status() === 204 ? undefined : response.json()
}
const get = (route) => request('get', route)
const post = (route, data) => request('post', route, data)
const put = (route, data) => request('put', route, data)
const until = async (check, description) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out: ${description}`)
}
const step = (name) => console.log(`• ${name}`)
const click = (selector) => page.locator(selector).click()
const position = page.locator('[data-process-position]')
const currentTitle = () => page.locator('[data-process-title]').innerText()
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const roles = () => page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.dataset.processRole))
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `review-today-${engine}-${name}.png`) }) }
let space
try {
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Review today check ${engine} ${Date.now()}` })
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  const set = (id) => ({ field: 'status', value: { kind: 'value', value: { kind: 'select', value: [id] } } })
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'waiting', label: 'Waiting', status: 'todo' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'dropped', label: 'Dropped', status: 'done' },
    ] } : p),
    review: { every: 7, incoming: ['inbox'] },
    // Defer as the defaults have it: the Do date alone.
    quickActions: { actions: [
      { id: 'done', name: 'Mark done', changes: [set('done')] },
      { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }] },
      { id: 'drop', name: 'Drop', changes: [set('dropped')] },
    ] },
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const day = (value) => value?.value.start.slice(0, 10)
  const make = (title, status) => post('/api/objects', { typeId: type.id, title, props: { status: { kind: 'select', value: [status] } }, content: {} })
  const a = await make('A new, for today', 'inbox')
  const b = await make('B new, for tomorrow', 'inbox')
  const c = await make('C new, by key', 'inbox')
  const d = await make('D waiting, for today', 'waiting')
  const e = await make('E next, for tomorrow', 'next')
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone, a new task: no Today button; Schedule… | Waiting…, Done a full row, Drop | Snooze')
  await click('[data-review-tasks]')
  await until(async () => (await currentTitle()) === a.title, 'the review starts with the oldest new task')
  assert.deepEqual(await roles(), ['defer', 'wait', 'done', 'drop', 'snooze'])
  assert.deepEqual(await page.locator('[data-process-links] [data-process-choice]').evaluateAll((els) => els.map((el) => el.dataset.processChoice)), [], 'Scheduled is Schedule’s, Next is No date’s and Waiting is Waiting…’s: no links')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const boxes = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), width: Math.round(r.width), height: r.height })))
    assert(boxes.every((box) => box.height >= 44), `a button under 44px at ${width}`)
    assert(boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].top && boxes[2].width > boxes[0].width * 1.8 && boxes[3].top === boxes[4].top && boxes[3].top > boxes[2].top, `not the tray (Schedule… | Waiting… / Done / Drop | Snooze) at ${width}: ${JSON.stringify(boxes)}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('phone-new')

  step('Schedule… → Today on a new task: Do date today, moved to Next (not Scheduled), on to the next task; Undo puts both back')
  await click('[data-process-role="defer"]')
  assert.deepEqual(await page.locator('[data-defer-menu] button[aria-pressed]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['Today', 'Tomorrow', 'Next week'], 'Today first')
  await shot('phone-question')
  await click('[data-ask-today]')
  await until(async () => (await currentTitle()) === b.title, 'Today settles the new task')
  await until(async () => (await propsOf(a.id)).status?.value[0] === 'next', 'Today placed it in Next')
  assert.equal(day((await propsOf(a.id)).dodate), today)
  assert.match(await page.locator('[role=status]').innerText(), /Today/)
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => (await propsOf(a.id)).status?.value[0] === 'inbox', 'Undo puts the status back')
  assert.equal((await propsOf(a.id)).dodate, undefined, 'Undo takes the day back')
  assert.equal(await currentTitle(), b.title, 'Undo does not move the review')

  step('Schedule… on a new task: the day asked, placed in Scheduled, on to the next task')
  await click('[data-process-role="defer"]')
  await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
  await until(async () => (await currentTitle()) === c.title, 'Defer settles the new task')
  await until(async () => (await propsOf(b.id)).status?.value[0] === 'scheduled', 'Defer placed it in Scheduled')
  assert.equal(day((await propsOf(b.id)).dodate), tomorrow)

  step('desktop: S then T is Today (no button, no key T on the card); a check-in keeps its status with Today and with Tomorrow')
  await page.setViewportSize({ width: 1280, height: 800 })
  assert.equal(await page.locator('[data-key="T"]').count(), 0, 'no button has the key T')
  assert.equal(await page.locator('[data-process-role="defer"]').getAttribute('data-key'), 'S')
  await shot('desktop-new')
  await page.keyboard.press('t')
  assert.equal(await page.locator('[data-defer-menu]').count(), 0, 'T alone does nothing')
  assert.equal(await currentTitle(), c.title)
  await page.keyboard.press('s')
  await page.locator('[data-defer-menu]').waitFor()
  await page.keyboard.press('t')
  await until(async () => (await currentTitle()) === d.title, 'T in the question settles the new task; on to the check-ins')
  await until(async () => (await propsOf(c.id)).status?.value[0] === 'next', 'T placed it in Next')
  assert.equal(day((await propsOf(c.id)).dodate), today)
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 2')
  assert.deepEqual(await roles(), ['defer', 'wait', 'done', 'drop', 'snooze'])
  assert.equal((await page.locator('[data-process-reviewed]').innerText()).trim(), 'Keep as planned', 'the key hint shows only on hover or focus')
  await shot('desktop-checkin')
  await click('[data-process-role="defer"]')
  await click('[data-ask-today]')
  await until(async () => (await currentTitle()) === e.title, 'Today goes on from a check-in')
  await until(async () => day((await propsOf(d.id)).dodate) === today, 'Today saved the day')
  assert.equal((await propsOf(d.id)).status.value[0], 'waiting', 'a placed task keeps its status')
  assert.equal(day((await propsOf(d.id)).reviewed), today, 'and counts as reviewed')
  assert.deepEqual(await page.locator('[data-process-links] [data-process-choice]').evaluateAll((els) => els.map((el) => el.dataset.processChoice)), [])
  await page.keyboard.press('s')
  await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
  await page.locator('[data-process-end]').waitFor()
  await until(async () => day((await propsOf(e.id)).dodate) === tomorrow, 'Defer saved the day')
  assert.equal((await propsOf(e.id)).status.value[0], 'next', 'Defer leaves a placed task’s status')
  const summary = await page.locator('[data-process-summary]').innerText()
  assert.match(summary, /Today 2/)
  assert.match(summary, /Schedule 2/)
  assert.deepEqual(errors, [])
  console.log(`Review today checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-today-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
