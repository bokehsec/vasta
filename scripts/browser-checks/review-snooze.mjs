// Review tasks, Snooze and the way out of a date: Snooze hides a new task or a check-in from Review for
// a day (Snoozed until; the status stays, it is not marked reviewed) and goes on, with Undo; it is gone
// from a fresh review and back on its day. Schedule…'s question also offers No date (the first open
// status, no Do date) and Someday (On Hold, no Do date), each settling a new task at once. The
// setting in Type settings › Review changes the days. A phone has Snooze as a quiet row of its own.
// node review-snooze.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica; SHOTS=<dir>
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const options = { viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-snooze-')), options) : await browser.newContext(options)
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
const shot = async (name) => {
  if (!process.env.SHOTS) return
  mkdirSync(process.env.SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(process.env.SHOTS, `review-snooze-${engine}-${name}.png`) })
}
const reviewButton = page.locator('[data-review-tasks]')
let space
try {
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Review snooze check ${engine} ${Date.now()}` })
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'waiting', label: 'Waiting', status: 'todo' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'dropped', label: 'Dropped', status: 'done' },
      { id: 'hold', label: 'On Hold', status: 'todo' },
    ] } : p),
    review: { every: 7, incoming: ['inbox'] },
    quickActions: undefined,
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const plus = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
  const date = (value) => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day' } })
  const day = (value) => value?.value.start.slice(0, 10)
  const make = (title, status, props = {}) => post('/api/objects', { typeId: type.id, title, props: { status: { kind: 'select', value: [status] }, ...props }, content: {} })
  const a = await make('A new, snoozed', 'inbox')
  const b = await make('B new, no date', 'inbox', { dodate: date(today) })
  const c = await make('C new, someday', 'inbox', { dodate: date(today) })
  const d = await make('D check-in, snoozed', 'waiting')
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone, a new task: Today, Schedule…, Waiting…, Done, Drop, then Snooze as a quiet row of its own, nothing overflowing')
  await until(async () => /^Review\s+4$/.test((await reviewButton.innerText()).trim()), 'Review 4')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === a.title, 'the review starts with the oldest new task')
  assert.deepEqual(await roles(), ['today', 'defer', 'wait', 'done', 'drop', 'snooze'])
  assert.equal(await page.locator('[data-process-skip]').count(), 0, 'Snooze replaces Decide later')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const boxes = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: r.height })))
    assert(boxes.every((box) => box.height >= 44), `a button under 44px at ${width}`)
    assert(boxes[5].width > boxes[1].width * 1.8 && boxes[5].top > boxes[4].top, `Snooze is not a row of its own at ${width}: ${JSON.stringify(boxes)}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.equal(await page.locator('[data-process-choices]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `tray overflow at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator('[data-process-role="snooze"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Snooze is quiet')
  assert.match(await page.locator('[data-process-role="snooze"]').getAttribute('title'), /^Hidden from Review for 1 day\. Nothing else changes\.$/)
  await shot('phone-new')

  step('Snooze on a new task: hidden until tomorrow, status and review day untouched, on to the next; Undo takes it back and stays')
  await click('[data-process-role="snooze"]')
  await until(async () => (await currentTitle()) === b.title, 'Snooze settles the new task')
  await until(async () => day((await propsOf(a.id)).snoozed) === plus(1), 'Snoozed until is tomorrow')
  let props = await propsOf(a.id)
  assert.equal(props.status.value[0], 'inbox', 'the status stays')
  assert.equal(props.reviewed, undefined, 'it is not marked reviewed')
  assert.match(await page.locator('[role=status]').innerText(), /^Snoozed until /)
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => (await propsOf(a.id)).snoozed === undefined, 'Undo takes the day back')
  assert.equal(await currentTitle(), b.title, 'Undo does not move the review')
  await page.keyboard.press('ArrowLeft')
  await until(async () => (await currentTitle()) === a.title, 'back to the first')
  await click('[data-process-role="snooze"]')
  await until(async () => day((await propsOf(a.id)).snoozed) === plus(1), 'snoozed again')
  await until(async () => (await currentTitle()) === b.title, 'on to the next')

  step('Schedule… › No date: the first open status, the Do date cleared, on to the next; Undo puts both back')
  assert.equal(day((await propsOf(b.id)).dodate), today)
  await click('[data-process-role="defer"]')
  assert.deepEqual(await page.locator('[data-ask-alternative]').evaluateAll((els) => els.map((el) => el.dataset.askAlternative)), ['no-date', 'someday'])
  assert.match(await page.locator('[data-ask-alternative="no-date"]').innerText(), /No date\s+Ready whenever/)
  assert.match(await page.locator('[data-ask-alternative="someday"]').innerText(), /Someday\s+Park it/)
  await shot('phone-schedule')
  await click('[data-ask-alternative="no-date"]')
  await until(async () => (await currentTitle()) === c.title, 'No date settles the new task')
  await until(async () => (await propsOf(b.id)).status.value[0] === 'next', 'No date saved')
  props = await propsOf(b.id)
  assert.equal(props.dodate, undefined, 'the Do date is cleared')
  assert.match(await page.locator('[role=status]').innerText(), /Moved to Next/)
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => (await propsOf(b.id)).status.value[0] === 'inbox' && day((await propsOf(b.id)).dodate) === today, 'Undo puts the status and the day back')
  assert.equal(await currentTitle(), c.title, 'Undo does not move the review')

  step('Schedule… › Someday: On Hold, the Do date cleared, on to the check-ins')
  await click('[data-process-role="defer"]')
  await click('[data-ask-alternative="someday"]')
  await until(async () => (await position.innerText()).trim() === 'Check-in 1 of 1', 'Someday settles the new task')
  await until(async () => (await propsOf(c.id)).status.value[0] === 'hold', 'Someday saved')
  props = await propsOf(c.id)
  assert.equal(props.dodate, undefined)
  assert.equal(day(props.reviewed), today, 'a status change counts as reviewed')

  step('a check-in: Schedule… offers No date and Someday; Snooze keeps its status; the end counts it')
  assert.equal(await currentTitle(), d.title)
  await click('[data-process-role="defer"]')
  assert.deepEqual(await page.locator('[data-ask-alternative]').evaluateAll((els) => els.map((el) => el.dataset.askAlternative)), ['no-date', 'someday'])
  await click('[data-ask-cancel]')
  await click('[data-process-role="snooze"]')
  await page.locator('[data-process-end]').waitFor()
  await until(async () => day((await propsOf(d.id)).snoozed) === plus(1), 'the check-in is snoozed')
  props = await propsOf(d.id)
  assert.equal(props.status.value[0], 'waiting')
  assert.equal(props.reviewed, undefined, 'a snoozed check-in is not reviewed')
  const summary = await page.locator('[data-process-summary]').innerText()
  assert.match(summary, /Snoozed 2/)
  assert.match(summary, /Moved to On Hold 1/)
  await click('[data-process-finish]')

  step('a fresh review leaves the snoozed ones out; on their day they are back as they were')
  await until(async () => /^Review\s+1$/.test((await reviewButton.innerText()).trim()), 'only B is left to review')
  await put(`/api/objects/${a.id}`, { ...(await get(`/api/objects/${a.id}`)), props: { ...(await propsOf(a.id)), snoozed: date(today) } })
  await put(`/api/objects/${d.id}`, { ...(await get(`/api/objects/${d.id}`)), props: { ...(await propsOf(d.id)), snoozed: date(today) } })
  await until(async () => /^Review\s+3$/.test((await reviewButton.innerText()).trim()), 'A and D are back')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === a.title, 'A is a new task again')
  assert.equal((await propsOf(a.id)).status.value[0], 'inbox')

  step('a decision on a task with a Snoozed until day clears it; Undo puts it back')
  await click('[data-process-role="today"]')
  await until(async () => (await propsOf(a.id)).snoozed === undefined, 'Today cleared Snoozed until')
  assert.equal(day((await propsOf(a.id)).dodate), today)
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => day((await propsOf(a.id)).snoozed) === today, 'Undo put Snoozed until back')
  await click('[data-process-close]')

  step('desktop: Snooze is last in the centred buttons and quiet, key N; Settings › Review sets the days')
  await page.setViewportSize({ width: 1280, height: 800 })
  await reviewButton.click()
  await page.locator('[data-process-mode]').waitFor()
  assert.deepEqual(await roles(), ['today', 'defer', 'wait', 'done', 'drop', 'snooze'])
  assert.equal(await page.locator('[data-process-role="snooze"]').getAttribute('data-key'), 'N')
  const row = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
  assert(row.at(-1).top > row[4].top || row.at(-1).left > row[4].right, 'Snooze last (the six buttons may wrap to a second row)')
  await shot('desktop-new')
  await page.keyboard.press('Escape')
  await page.locator('[data-process-mode]').waitFor({ state: 'detached' })
  await page.locator('button[title="Type settings"]').click()
  const input = page.locator('[data-review-settings] [data-review-snooze]')
  await input.waitFor()
  assert.equal(await input.inputValue(), '1')
  await input.fill('3')
  await input.blur()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await get(`/api/types/${type.id}`)).review?.snooze === 3, 'review.snooze saved on the type')
  await page.keyboard.press('Escape')
  await reviewButton.click()
  await page.locator('[data-process-mode]').waitFor()
  await until(async () => (await page.locator('[data-process-role="snooze"]').getAttribute('title'))?.startsWith('Hidden from Review for 3 days'), 'the tooltip says 3 days')
  const title = await currentTitle()
  const snoozing = [a, b, c, d].find((t) => t.title === title)
  await page.keyboard.press('n')
  await until(async () => day((await propsOf(snoozing.id)).snoozed) === plus(3), 'N snoozed it for the 3 days')
  assert.match(await page.locator('[role=status]').innerText(), /^Snoozed until /)
  assert.deepEqual(errors, [])
  console.log(`Review snooze checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-snooze-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
