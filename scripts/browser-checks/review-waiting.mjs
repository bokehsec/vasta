// Review tasks, Waiting…: "I did my part, now I'm waiting on someone". One press (the button, or W) opens a
// question: Tomorrow, In 3 days, In a week (chosen at first), In 2 weeks or any day, and a comment (which
// starts as what is typed in the review's comment box). Wait sets Status to Waiting, Check back and
// Snoozed until to the day, moves an earlier Do date there (never Due) and adds the comment, in the same
// save; Notes are left alone; the task is out of Review until that
// day and back on it even though its week has not passed. Cancel/Escape change nothing; Undo puts the
// fields back and takes the comment away. A task already waiting is offered it too. The phone's tray fits at 320–430.
// node review-waiting.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica; SHOTS=<dir>
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
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-waiting-')), options) : await browser.newContext(options)
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
const notesOf = async (id) => ((await get(`/api/objects/${id}`)).content.body?.content ?? []).map((n) => (n.content ?? []).map((t) => t.text ?? '').join(''))
const commentsOf = async (id) => Object.entries(await propsOf(id)).filter(([key]) => key.startsWith('comment:')).map(([, value]) => value.value.text)
const roles = () => page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.dataset.processRole))
const shot = async (name) => {
  if (!process.env.SHOTS) return
  mkdirSync(process.env.SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(process.env.SHOTS, `review-waiting-${engine}-${name}.png`) })
}
const reviewButton = page.locator('[data-review-tasks]')
const undo = () => page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
let space
try {
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Review waiting check ${engine} ${Date.now()}` })
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: [...type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'waiting', label: 'Waiting', status: 'todo' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'dropped', label: 'Dropped', status: 'done' },
      { id: 'hold', label: 'On Hold', status: 'todo' },
    ] } : p), { id: 'checkback', kind: 'date', name: 'Check back' }],
    review: { every: 7, incoming: ['inbox'] },
    quickActions: undefined,
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const plus = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
  const date = (value) => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day' } })
  const day = (value) => value?.value.start.slice(0, 10)
  const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const make = (title, status, props = {}, lines = []) => post('/api/objects', { typeId: type.id, title, props: { status: { kind: 'select', value: [status] }, ...props }, content: lines.length ? { body: { type: 'doc', content: lines.map(paragraph) } } : {} })
  const a = await make('A insurance papers', 'next', { dodate: date(today), due: date(plus(3)) }, ['Asked the broker last week'])
  const b = await make('B already waiting', 'waiting', { dodate: date(plus(30)) })
  const c = await make('C no notes, no dates', 'next')
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone: Waiting… is a main button after Schedule…, the tray fits without overflow at 320, 390 and 430')
  await until(async () => /^Review\s+3$/.test((await reviewButton.innerText()).trim()), 'Review 3')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === a.title, 'the review starts with A')
  assert.deepEqual(await roles(), ['defer', 'wait', 'done', 'drop', 'snooze'])
  assert.equal(await page.locator('[data-process-links]').count(), 0, 'Waiting is no link')
  assert.match(await page.locator('[data-process-role="wait"]').innerText(), /^Waiting…/)
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const boxes = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: r.height, right: r.right })))
    assert(boxes.every((box) => box.height >= 44 && box.right <= width), `a button under 44px or outside the screen at ${width}: ${JSON.stringify(boxes)}`)
    assert(boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].top && boxes[2].width > boxes[0].width * 1.8 && boxes[3].top === boxes[4].top && boxes[3].top > boxes[2].top, `not the tray (Schedule… | Waiting… / Done / Drop | Snooze) at ${width}: ${JSON.stringify(boxes)}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.equal(await page.locator('[data-process-choices]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `tray overflow at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('phone-tray')

  step('the question: a week chosen at first, the title and comment box; Escape and Cancel change nothing')
  await click('[data-process-role="wait"]')
  await page.locator('[data-waiting-ask]').waitFor()
  assert.match(await page.locator('[data-waiting-title]').innerText(), /^Waiting — check back on$/)
  assert.deepEqual(await page.locator('[data-waiting-preset]').evaluateAll((els) => els.map((el) => [el.textContent.trim(), el.getAttribute('aria-pressed')])), [['Tomorrow', 'false'], ['In 3 days', 'false'], ['In a week', 'true'], ['In 2 weeks', 'false']])
  assert.match(await page.locator('[data-waiting-day]').innerText(), /^Check back: /)
  assert.equal(await page.locator('[data-waiting-note]').getAttribute('placeholder'), "What you're waiting for — e.g. emailed Sam for the documents")
  assert(await page.locator('[data-waiting-note]').evaluate((el) => el === document.activeElement), 'the note box has the focus')
  await shot('phone-question')
  await page.keyboard.press('Escape')
  await page.locator('[data-waiting-ask]').waitFor({ state: 'detached' })
  await click('[data-process-role="wait"]')
  await page.locator('[data-waiting-note]').fill('never mind')
  await click('[data-waiting-cancel]')
  await page.locator('[data-waiting-ask]').waitFor({ state: 'detached' })
  assert.equal(await currentTitle(), a.title)
  let props = await propsOf(a.id)
  assert.equal(props.status.value[0], 'next')
  assert.equal(props.checkback, undefined)
  assert.equal(props.snoozed, undefined)
  assert.deepEqual(await notesOf(a.id), ['Asked the broker last week'])
  assert.deepEqual(await commentsOf(a.id), [])

  step('Wait with a comment (Enter): Waiting, Check back and Snoozed until +7 days, the Do date moved, Due left, the comment added, Notes untouched; on to the next')
  await click('[data-process-role="wait"]')
  await page.locator('[data-waiting-note]').fill('emailed broker for the insurance documents')
  await page.keyboard.press('Enter')
  await until(async () => (await propsOf(a.id)).status.value[0] === 'waiting', 'Waiting saved')
  props = await propsOf(a.id)
  assert.equal(day(props.checkback), plus(7))
  assert.equal(day(props.snoozed), plus(7))
  assert.equal(day(props.dodate), plus(7), 'the Do date moved to the day')
  assert.equal(day(props.due), plus(3), 'Due is not touched')
  await until(async () => (await commentsOf(a.id)).length === 1, 'the comment is saved')
  assert.deepEqual(await commentsOf(a.id), ['emailed broker for the insurance documents'])
  assert.deepEqual(await notesOf(a.id), ['Asked the broker last week'])
  await until(async () => (await currentTitle()) === b.title, 'on to B')
  assert.match(await page.locator('[role=status]').innerText(), /^Moved to Waiting until /)

  step('Undo puts the fields back and takes the comment away again')
  await undo()
  await until(async () => (await propsOf(a.id)).status.value[0] === 'next', 'Undo restores the status')
  props = await propsOf(a.id)
  assert.equal(props.checkback, undefined)
  assert.equal(props.snoozed, undefined)
  assert.equal(day(props.dodate), today)
  await until(async () => (await commentsOf(a.id)).length === 0, 'Undo removes the comment')
  assert.deepEqual(await notesOf(a.id), ['Asked the broker last week'])
  assert.equal(await currentTitle(), b.title, 'Undo does not move the review')

  step('a task already waiting is offered Waiting… too: another 2 weeks, no note, the Do date later than that stays')
  assert.deepEqual(await roles(), ['defer', 'wait', 'done', 'drop', 'snooze'])
  await click('[data-process-role="wait"]')
  await click('[data-waiting-preset="14"]')
  assert.equal(await page.locator('[data-waiting-preset="14"]').getAttribute('aria-pressed'), 'true')
  await click('[data-waiting-save]')
  await until(async () => day((await propsOf(b.id)).checkback) === plus(14), 'B: Check back +14')
  props = await propsOf(b.id)
  assert.equal(day(props.snoozed), plus(14))
  assert.equal(props.status.value[0], 'waiting')
  assert.equal(day(props.dodate), plus(30))
  assert.deepEqual(await commentsOf(b.id), [], 'no comment typed, none written')
  await until(async () => (await currentTitle()) === c.title, 'on to C')

  step('a task with no Do date and no notes: what is typed in the review\'s box starts the question\'s comment; Tomorrow and another day from the calendar')
  await click('[data-process-comment]')
  await page.locator('[data-process-comment]').fill('Sam has the forms')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-process-mode]').count(), 1, 'Escape in the box does not pause the review')
  await page.keyboard.press('w')
  await page.locator('[data-waiting-ask]').waitFor()
  assert.equal(await page.locator('[data-waiting-note]').inputValue(), 'Sam has the forms', 'the comment starts as the box\'s text')
  assert.match(await page.locator('[data-waiting-ask] label span').innerText(), /^Comment \(optional\)$/)
  await click('[data-waiting-preset="1"]')
  await click('[data-waiting-calendar]')
  const target = `${plus(1).slice(0, 7)}-28` // the calendar opens on the month of the day chosen
  await page.locator('[data-waiting-ask] button:not([class*="ink-faint/70"])', { hasText: new RegExp(`^${Number(target.slice(8))}$`) }).first().click()
  assert.equal(await page.locator('[data-waiting-preset][aria-pressed="true"]').count(), 0, 'no preset is on for another day')
  await click('[data-waiting-save]')
  await page.locator('[data-process-end]').waitFor()
  await until(async () => (await propsOf(c.id)).status.value[0] === 'waiting', 'C is waiting')
  props = await propsOf(c.id)
  assert.equal(day(props.checkback), target)
  assert.equal(day(props.snoozed), target)
  assert.equal(props.dodate, undefined, 'no Do date stays none')
  await until(async () => (await commentsOf(c.id)).length === 1, 'the comment is saved')
  assert.deepEqual(await commentsOf(c.id), ['Sam has the forms'])
  assert.deepEqual(await notesOf(c.id), [], 'Notes are left alone')
  const summary = await page.locator('[data-process-summary]').innerText()
  assert.match(summary, /Moved to Waiting 2/)
  await click('[data-process-finish]')

  step('a fresh review today leaves them out; on its day a task is back though it was reviewed a day earlier')
  await until(async () => /^Review\s+1$/.test((await reviewButton.innerText()).trim()), 'only A (undone, still unreviewed) is left; B and C are out')
  const putA = async (extra) => put(`/api/objects/${a.id}`, { ...(await get(`/api/objects/${a.id}`)), props: { ...(await propsOf(a.id)), status: { kind: 'select', value: ['waiting'] }, ...extra } })
  await putA({ checkback: date(plus(7)), snoozed: date(plus(7)), reviewed: date(today) })
  await until(async () => !/\d/.test((await reviewButton.innerText()).trim()) || /^Review\s+0$/.test((await reviewButton.innerText()).trim()), 'A, waiting until next week, is out too')
  await putA({ checkback: date(today), snoozed: date(today), reviewed: date(plus(-1)) })
  await until(async () => /^Review\s+1$/.test((await reviewButton.innerText()).trim()), 'A is back on its day')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === a.title, 'A is in the check-ins')
  assert.equal(await page.locator('[data-process-meta]').innerText().then((t) => /Check-in/.test(t)), true)
  await click('[data-process-close]')

  step('desktop: Waiting… after Schedule…, key W, the question under the button; Another day… shows the calendar; Escape closes it')
  await page.setViewportSize({ width: 1280, height: 800 })
  await reviewButton.click()
  await page.locator('[data-process-mode]').waitFor()
  assert.deepEqual(await roles(), ['defer', 'wait', 'done', 'drop', 'snooze'])
  assert.equal(await page.locator('[data-process-role="wait"]').getAttribute('data-key'), 'W')
  await page.keyboard.press('w')
  await page.locator('[data-waiting-ask]').waitFor()
  assert.equal(await page.locator('[data-waiting-ask]').evaluate((el) => !!el.closest('[data-overlay]')), true, 'a popover under the button on a wide screen')
  await click('[data-waiting-calendar]')
  await page.locator('[data-waiting-ask] button[title]').first().waitFor()
  await shot('desktop-question')
  await page.keyboard.press('Escape')
  await page.locator('[data-waiting-ask]').waitFor({ state: 'detached' })
  await page.locator('[data-process-mode]').waitFor()
  assert.deepEqual(errors, [])
  console.log(`Review waiting checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-waiting-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
