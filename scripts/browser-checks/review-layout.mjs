// Review tasks, the layout. A big screen: the review fills the window, so its panel and its button row are
// the same for a short and a long task (1440×900, 1280×800); the six decision buttons are one row in the
// task's column, never cut off and without icons, their key shown only on hover or keyboard focus; a window
// too narrow (700×800), or labels too long for the column, gets the tray instead. The header's button says
// the next task's whole title ("Last one" on the last) and opens the session's tasks (Done with what
// happened, Now, Coming up); a task in it is a way there, saving what is typed; Escape closes it. The
// fields are one line of the filled ones, which opens the chips. The latest comment has no stripe or box.
// A phone: the tray's order, every button 44px or more, the list as a sheet.
// node review-layout.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica; SHOTS=<dir>
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const options = { viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-layout-')), options) : await browser.newContext(options)
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
const currentTitle = () => page.locator('[data-process-title]').innerText()
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const shot = async (name) => {
  if (!process.env.SHOTS) return
  mkdirSync(process.env.SHOTS, { recursive: true })
  // The pointer out of the way, so no hover tint or key hint is in the picture.
  await page.mouse.move(2, 2)
  await new Promise((r) => setTimeout(r, 250))
  await page.screenshot({ path: path.join(process.env.SHOTS, `${engine}-${process.env.MODE === 'json' ? 'json-' : ''}${name}.png`) })
}
const DECISIONS = '[data-process-reviewed], [data-process-role]'
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
async function size(width, height) {
  await page.setViewportSize({ width, height })
  await settle()
  await new Promise((r) => setTimeout(r, 150))
}
const buttons = () => page.locator(DECISIONS).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect()
  return {
    role: el.dataset.processRole ?? 'keep', top: Math.round(r.top), left: r.left, right: r.right, width: Math.round(r.width), height: r.height,
    // A label is cut when it needs more than its button has, or is set to end in an ellipsis.
    cut: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1 || [el, ...el.querySelectorAll('*')].some((e) => getComputedStyle(e).textOverflow === 'ellipsis'),
    icons: el.querySelectorAll('svg, img').length,
  }
}))
const box = (selector) => page.locator(selector).boundingBox()
const panel = () => box('[data-process-mode] [role=dialog]')
async function neverCut(width) {
  const list = await buttons()
  assert(list.length >= 5, `no buttons at ${width}`)
  for (const b of list) {
    assert(!b.cut, `a label is cut at ${width}: ${JSON.stringify(b)}`)
    assert(b.left >= 0 && b.right <= width + 0.5, `a button is off screen at ${width}: ${JSON.stringify(b)}`)
    assert.equal(b.icons, 0, `an icon on a decision button: ${b.role}`)
  }
  assert.equal(await page.locator('[data-process-mode]').evaluate((el) => [...el.querySelectorAll('[data-process-choices], [data-process-card], header')].some((e) => e.scrollWidth > e.clientWidth + 1) || el.scrollWidth > innerWidth), false, `sideways overflow at ${width}`)
  return list
}
/** The next-task button's words, all of them on screen. */
async function nextLabel() {
  const label = page.locator('[data-process-next]')
  assert.equal(await label.evaluate((el) => [el, ...el.querySelectorAll('*')].some((e) => getComputedStyle(e).textOverflow === 'ellipsis' || (e.clientWidth && e.scrollWidth > e.clientWidth + 1))), false, 'the next task’s title is cut')
  return (await page.locator('[data-process-next-label]').innerText()).replace(/\s+/g, ' ').trim()
}
const listItems = () => page.locator('[data-process-list] > *').evaluateAll((els) => els.slice(1).map((el) => (el.dataset.processListGroup ? `# ${el.dataset.processListGroup}` : el.innerText.replace(/\s+/g, ' ').trim())))
let space
try {
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Review layout check ${engine} ${Date.now()}` })
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  const statuses = (waiting = 'Waiting') => [
    { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
    { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'waiting', label: waiting, status: 'todo' },
    { id: 'done', label: 'Done', status: 'done' }, { id: 'dropped', label: 'Dropped', status: 'done' },
    { id: 'hold', label: 'On Hold', status: 'todo' },
  ]
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: [...type.properties.map((p) => (p.id === 'status' ? { ...p, options: statuses() } : p)), { id: 'checkback', kind: 'date', name: 'Check back' }],
    review: { every: 7, incoming: ['inbox'] },
    quickActions: undefined,
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const plus = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
  const short = (value) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00Z`))
  const date = (value) => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day' } })
  const me = (await get('/api/auth/me')).id
  const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const make = (title, props = {}, lines = []) => post('/api/objects', { typeId: type.id, title, props: { status: { kind: 'select', value: ['next'] }, ...props }, content: lines.length ? { body: { type: 'doc', content: lines.map(paragraph) } } : {} })
  const priority = type.properties.find((p) => p.id === 'priority')
  const high = priority?.options.find((o) => /high/i.test(o.label)) ?? priority?.options[0]
  const short1 = await make('Renew passport')
  const long = await make('Get the kitchen ceiling repaired after the upstairs leak and make sure the insurance claim is closed properly before the end of the year', {
    due: date(plus(20)), checkback: date(plus(6)), ...(high ? { priority: { kind: 'select', value: [high.id] } } : {}),
    'comment:one': { kind: 'comment', value: { author: me, at: `${plus(-1)}T15:00:00.000Z`, text: 'The plumber can only come on Thursday morning, and only if someone is home to let him in. Confirm with the landlord before the end of the week.' } },
  }, Array.from({ length: 24 }, (_, i) => `Note ${i + 1}: the adjuster asked for photos of the ceiling, the invoice for the first visit and a written quote for the repair.`))
  const wordy = await make('Write down everything the accountant needs for the year-end filing, including the receipts, the mileage log and both property tax statements')
  const fourth = await make('Book the dentist')
  const last = await make('Water the plants')
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')
  await until(async () => /^Review\s+5$/.test((await page.locator('[data-review-tasks]').innerText()).trim()), 'Review 5')
  await click('[data-review-tasks]')
  await until(async () => (await currentTitle()) === short1.title, 'the review starts with the short task')

  step('big screen: the same panel and button row for a short and a long task; six buttons on one row in the task’s column')
  const widths = [[1440, 900], [1280, 800]]
  const measured = {}
  for (const [width, height] of widths) {
    await size(width, height)
    const frame = await panel()
    assert(frame.width >= width - 48 && frame.height >= height - 48, `the review does not fill the window at ${width}: ${JSON.stringify(frame)}`)
    const row = await neverCut(width)
    assert.deepEqual(row.map((b) => b.role), ['keep', 'defer', 'wait', 'done', 'drop', 'snooze'])
    assert.equal(new Set(row.map((b) => b.top)).size, 1, `not one row at ${width}: ${JSON.stringify(row)}`)
    assert.equal(await page.locator('[data-process-tray]').count(), 0)
    const column = await box('[data-process-title]')
    const line = await box('[data-process-row]')
    assert(Math.abs(column.x - line.x) < 1 && Math.abs(column.x + column.width - (line.x + line.width)) < 1 && line.width <= 600.5, `column and row do not line up at ${width}: ${JSON.stringify({ column, line })}`)
    assert(Math.abs(row[0].left - line.x) < 1 && Math.abs(row.at(-1).right - (line.x + line.width)) < 1, 'the row spans the column')
    measured[width] = { frame, top: row[0].top }
    await shot(`desktop-${width}-short`)
  }

  step('the key hints show only on hover or keyboard focus; the facts line of a task with nothing but its status')
  const kbd = page.locator('[data-process-role="done"] kbd')
  assert.equal(await kbd.isVisible(), false)
  await page.locator('[data-process-role="done"]').hover()
  assert.equal(await kbd.isVisible(), true)
  await page.mouse.move(2, 2)
  assert.equal(await kbd.isVisible(), false)
  assert.equal((await page.locator('[data-process-facts]').innerText()).trim(), 'Next', 'empty fields are not in the line')
  assert.equal(await page.locator('[data-process-plan]').count(), 0, 'the chips are closed')
  await click('[data-process-facts]')
  assert.match(await page.locator('[data-process-plan]').innerText(), /\+ Due/, 'opened, the empty fields are offered')
  await click('[data-process-facts]')
  await page.locator('[data-process-plan]').waitFor({ state: 'detached' })

  step('the next task’s button: its whole title, wrapping; the list is Done, Now, Coming up; Escape closes it and the review stays')
  await size(1440, 900)
  assert.equal(await nextLabel(), `1 of 5 · Next: ${long.title}`)
  await size(1024, 768)
  assert((await box('[data-process-next]')).height > 40, 'a long title wraps to a second line')
  assert.equal(await nextLabel(), `1 of 5 · Next: ${long.title}`)
  await size(1440, 900)
  await click('[data-process-next]')
  await page.locator('[data-process-list]').waitFor()
  assert.equal(await page.locator('[data-process-list-scope]').innerText(), 'All tasks')
  assert.deepEqual(await listItems(), ['# Now', short1.title, '# Coming up', long.title, wordy.title, fourth.title, last.title])
  await page.keyboard.press('Escape')
  await page.locator('[data-process-list]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-process-mode]').count(), 1, 'Escape closes the list, not the review')
  await page.keyboard.press('k')
  await until(async () => (await currentTitle()) === long.title, 'Keep moved on')

  step('a long task: the panel and the buttons have not moved; the facts line shows the filled fields and opens the chips')
  for (const [width, height] of widths) {
    await size(width, height)
    assert.deepEqual(await panel(), measured[width].frame, `the panel changed size at ${width}`)
    const row = await neverCut(width)
    assert(row.every((b) => b.top === measured[width].top), `the button row moved at ${width}: ${row[0].top} not ${measured[width].top}`)
    assert(await page.locator('[data-process-card]').evaluate((el) => el.scrollHeight > el.clientHeight), 'the long task scrolls in the middle')
    await shot(`desktop-${width}-long`)
    const line = (await page.locator('[data-process-facts]').innerText()).replace(/\s+/g, ' ').trim()
    assert.equal(line, ['Next', `check back ${short(plus(6))}`, `due ${short(plus(20))}`, ...(high ? [high.label] : [])].join(' · '))
    assert.equal(await page.getByRole('button', { name: /^Edit fields/ }).count(), 1)
    await click('[data-process-facts]')
    await page.locator('[data-process-plan]').waitFor()
    assert.equal(await page.locator('[data-process-field="checkback"]').count(), 1, 'what the line says can be edited')
    assert.deepEqual(await panel(), measured[width].frame)
    await shot(`desktop-${width}-facts`)
    await click('[data-process-facts]')
    await page.locator('[data-process-plan]').waitFor({ state: 'detached' })
    await click('[data-process-next]')
    await page.locator('[data-process-list]').waitFor()
    await shot(`desktop-${width}-list`)
    await page.keyboard.press('Escape')
    await page.locator('[data-process-list]').waitFor({ state: 'detached' })
  }
  const comment = await page.locator('[data-process-latest-comment]').evaluate((el) => [el, ...el.querySelectorAll('*')].map((e) => { const s = getComputedStyle(e); return `${s.borderLeftWidth} ${s.backgroundColor}` }))
  assert(comment.every((s) => s === '0px rgba(0, 0, 0, 0)'), `the latest comment has a stripe or a box: ${comment}`)
  assert.equal((await page.locator('[data-process-latest-label]').innerText()).trim(), short(plus(-1)))

  step('a jump from the list saves what is typed; the list says what was done; the last task says Last one')
  await page.locator('[data-process-comment]').fill('Called, no answer yet')
  await click('[data-process-next]')
  await page.locator('[data-process-list-item]', { hasText: last.title }).click()
  await until(async () => (await currentTitle()) === last.title, 'a click jumps to the task')
  await until(async () => Object.values(await propsOf(long.id)).some((v) => v.kind === 'comment' && v.value.text === 'Called, no answer yet'), 'the typed text is saved as a comment')
  assert.equal(await nextLabel(), '5 of 5 · Last one')
  await click('[data-process-next]')
  await page.locator('[data-process-list]').waitFor()
  assert.deepEqual(await listItems(), ['# Done', `${short1.title} Kept`, '# Now', last.title, '# Coming up', long.title, wordy.title, fourth.title])
  await page.locator('[data-process-list-item]', { hasText: wordy.title }).click()
  await until(async () => (await currentTitle()) === wordy.title, 'back to one passed over')
  await click('[data-process-role="wait"]')
  await click('[data-waiting-save]')
  await until(async () => (await currentTitle()) === fourth.title, 'Waiting moved on')
  await click('[data-process-next]')
  await page.locator('[data-process-list]').waitFor()
  assert.deepEqual((await listItems()).slice(0, 3), ['# Done', `${short1.title} Kept`, `${wordy.title} Waiting until ${short(plus(7))}`])
  await shot('desktop-1280-list-done')
  await page.keyboard.press('Escape')

  step('no label is cut at 1440, 1280, 1024, 820, 390, 375 or 320; at 700×800 the tray takes over')
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [820, 800], [390, 844], [375, 667], [320, 640]]) {
    await size(width, height)
    await neverCut(width)
  }
  await size(700, 800)
  await page.locator('[data-process-tray]').waitFor()
  await neverCut(700)
  await shot('narrow-700')

  step('names too long for one row on a big screen: the tray, no ellipsis; short again, the row')
  await size(1280, 800)
  assert.equal(await page.locator('[data-process-tray]').count(), 0)
  const wide = await get(`/api/spaces/${space.id}`).then((b) => b.types.find((t) => t.id === type.id))
  const rename = (label) => put(`/api/types/${type.id}`, { ...wide, properties: wide.properties.map((p) => (p.id === 'status' ? { ...p, options: statuses(label) } : p)) })
  await rename('Waiting for someone else to get back to me about it')
  await page.locator('[data-process-tray]').waitFor()
  await neverCut(1280)
  await shot('desktop-1280-long-labels')
  await rename('Waiting')
  await until(async () => (await page.locator('[data-process-tray]').count()) === 0, 'the row comes back')
  await neverCut(1280)

  step('phone: ‹ · Review · Pause, the next task’s button under them; the tray’s order, every button 44px or more; the list is a sheet')
  for (const [width, height] of [[390, 844], [375, 667], [320, 640]]) {
    await size(width, height)
    const list = await neverCut(width)
    assert.deepEqual(list.map((b) => b.role), ['keep', 'defer', 'wait', 'done', 'drop', 'snooze'])
    assert(list.every((b) => b.height >= 44), `a button under 44px at ${width}: ${JSON.stringify(list)}`)
    const [keep, schedule, waiting, done, drop, snooze] = list
    assert(keep.top < schedule.top && schedule.top === waiting.top && waiting.top < done.top && done.top < drop.top && drop.top === snooze.top && schedule.left < waiting.left && drop.left < snooze.left, `the tray's order at ${width}: ${JSON.stringify(list)}`)
    assert(keep.width > schedule.width * 1.8 && done.width === keep.width, 'Keep and Done take a row each')
    for (const selector of ['[data-process-next]', '[data-process-close]', '[data-process-back]', '[data-process-facts]']) assert((await box(selector)).height >= 44, `${selector} under 44px at ${width}`)
    assert((await box('[data-process-next]')).y >= (await box('[data-process-heading]')).y + (await box('[data-process-heading]')).height - 1, 'the button has a line of its own')
    assert.equal(await nextLabel(), `4 of 5 · Next: ${last.title}`)
    await shot(`phone-${width}`)
  }
  await size(390, 844)
  await click('[data-process-next]')
  await page.locator('[data-sheet] [data-process-list]').waitFor()
  for (const item of await page.locator('[data-process-list-item]').all()) assert((await item.boundingBox()).height >= 44)
  await new Promise((r) => setTimeout(r, 300))
  await shot('phone-390-list')
  await page.keyboard.press('Escape')
  await page.locator('[data-process-list]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-process-mode]').count(), 1)
  await click('[data-process-facts]')
  await shot('phone-390-facts')
  await click('[data-process-facts]')
  await click('[data-process-next]')
  await page.locator('[data-process-list-item]', { hasText: long.title }).click()
  await until(async () => (await currentTitle()) === long.title, 'a tap in the sheet jumps')
  await page.locator('[data-process-card]').evaluate((el) => (el.scrollTop = 0))
  await shot('phone-390-long')
  await size(320, 640)
  await neverCut(320)
  await page.locator('[data-process-card]').evaluate((el) => (el.scrollTop = 0))
  await shot('phone-320-long')

  assert.deepEqual(errors, [])
  console.log(`Review layout checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-layout-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
