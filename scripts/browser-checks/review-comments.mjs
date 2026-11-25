// Review tasks, comments: a one-line box under the task's text ("Add a comment…", key C; Escape leaves it
// without pausing). Text typed there goes in the same save as whatever decision is pressed (one Undo takes
// both back); Enter on a check-in is Keep as planned with it, on a new task it saves the comment alone and
// stays; leaving the card without a decision (the arrow keys, Pause) saves it alone; blank text is nothing.
// The newest comment shows under the facts line (its date, and who wrote it when that is not
// you, no box), three lines at most; the next step chip shows only when it has a value. The tray and the box fit a
// phone at 320, 390 and 430 without sideways scrolling, and a big screen.
// node review-comments.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica; SHOTS=<dir>
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, request as pwRequest, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const options = { viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-comments-')), options) : await browser.newContext(options)
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
const commentsOf = async (id) => Object.entries(await propsOf(id)).filter(([key]) => key.startsWith('comment:')).map(([, value]) => value.value).sort((a, b) => a.at.localeCompare(b.at))
const texts = async (id) => (await commentsOf(id)).map((c) => c.text)
const box = page.locator('[data-process-comment]')
const callout = page.locator('[data-process-latest-comment]')
const reviewButton = page.locator('[data-review-tasks]')
// The chips are under the facts line, closed on each new card.
const openFacts = async () => {
  if (!(await page.locator('[data-process-plan]').count())) await click('[data-process-facts]')
}
const undo = () => page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
const shot = async (name) => {
  if (!process.env.SHOTS) return
  mkdirSync(process.env.SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(process.env.SHOTS, `review-comments-${engine}-${process.env.MODE === 'json' ? 'json-' : ''}${name}.png`) })
}
let space
let ana
try {
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Review comments check ${engine} ${Date.now()}` })
  const members = await post(`/api/spaces/${space.id}/members`, { username: 'anatest', role: 'editor' })
  const anaId = members.find((m) => m.username === 'anatest')?.userId
  assert(anaId, 'add the anatest account first (see people.mjs)')
  ana = await pwRequest.newContext({ extraHTTPHeaders: headers })
  assert((await ana.post(`${base}/api/auth/login`, { data: { username: 'anatest', password: 'test-password' } })).ok())
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: [...type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'waiting', label: 'Waiting', status: 'todo' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'dropped', label: 'Dropped', status: 'done' },
    ] } : p), { id: 'nextstep', kind: 'text', name: 'Next step' }],
    review: { every: 7, incoming: ['inbox'] },
    quickActions: { nextStepField: 'nextstep' },
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const plus = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
  const short = (value) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00Z`))
  const day = (value) => value?.value.start.slice(0, 10)
  const make = (title, status, props = {}) => post('/api/objects', { typeId: type.id, title, props: { status: { kind: 'select', value: [status] }, ...props }, content: {} })
  const written = (author, text, at) => ({ kind: 'comment', value: { author, at, text } })
  const me = (await get('/api/auth/me')).id
  const a = await make('A new, Enter keeps it here', 'inbox')
  const b = await make('B new, left with text', 'inbox')
  const long = 'The plumber can only come on Thursday morning, and only if someone is home to let him in. He needs the water shut off at the street, which the landlord has to do. Please confirm with both before the end of the week so the visit is not lost again.'
  const c = await make('C next, comments from two people', 'next', { nextstep: { kind: 'text', value: 'Call the plumber' }, 'comment:old': written(me, 'Asked the landlord', `${plus(-4)}T15:00:00.000Z`) })
  const withAna = await (await ana.get(`${base}/api/objects/${c.id}`)).json()
  withAna.props['comment:new'] = written(anaId, long, `${plus(-2)}T15:00:00.000Z`)
  assert((await ana.put(`${base}/api/objects/${c.id}`, { data: withAna })).ok(), 'Ana comments on C')
  const d = await make('D next, no next step, Keep with Enter', 'next')
  const e = await make('E next, Escape then the arrow', 'next')
  const f = await make('F next, Pause with text', 'next')
  const g = await make('G next, my own comment, a blank one', 'next', { 'comment:mine': written(me, 'Mine from last week', `${plus(-7)}T15:00:00.000Z`) })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone, a new task: the box under the text ("Add a comment…"), no latest comment, no empty Next step chip; it and the tray fit at 320, 390 and 430')
  await until(async () => /^Review\s+7$/.test((await reviewButton.innerText()).trim()), 'Review 7')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === a.title, 'the review starts with A')
  assert.equal(await box.getAttribute('placeholder'), 'Add a comment…')
  assert.equal(await callout.count(), 0, 'no comments, no callout')
  await openFacts()
  assert.equal(await page.locator('[data-process-field="nextstep"]').count(), 0, 'an empty next step has no chip')
  await click('[data-process-facts]')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    await box.scrollIntoViewIfNeeded()
    const [field, tray] = await Promise.all([box.boundingBox(), page.locator('[data-process-choices]').boundingBox()])
    assert(field.y + field.height <= tray.y + 0.5 && field.x >= 0 && field.x + field.width <= width, `the box is not reachable above the tray at ${width}: ${JSON.stringify({ field, tray })}`)
    assert(field.height >= 36, `the box is too small to tap at ${width}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.equal(await page.locator('[data-process-card]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `card overflow at ${width}`)
    assert.equal(await page.locator('[data-process-choices]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `tray overflow at ${width}`)
    const buttons = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), width: Math.round(r.width), height: r.height, right: r.right })))
    assert(buttons.every((r) => r.height >= 44 && r.right <= width), `the tray's buttons at ${width}: ${JSON.stringify(buttons)}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })

  step('Enter on a new task saves the comment alone and stays; the box clears and the comment shows as the latest, dated today')
  await box.fill('  Asked about the quote  ')
  await page.keyboard.press('Enter')
  await until(async () => (await texts(a.id)).length === 1, 'the comment is saved')
  assert.deepEqual(await texts(a.id), ['Asked about the quote'])
  assert.equal(await currentTitle(), a.title, 'still on the task')
  assert.equal((await propsOf(a.id)).status.value[0], 'inbox', 'not decided')
  assert.equal(await page.locator('[data-process-outcome]').count(), 0)
  await until(async () => (await box.inputValue()) === '', 'the box clears')
  assert.equal((await page.locator('[data-process-latest-label]').innerText()).trim(), short(today), 'my own comment names no one')
  assert.equal((await page.locator('[data-process-latest-text]').innerText()).trim(), 'Asked about the quote')

  step('a decision takes the typed text with it, in one save: Schedule… › Tomorrow; it is the latest when the task is shown again; one Undo takes both back')
  await box.fill('Will do it Friday')
  await click('[data-process-role="defer"]')
  await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
  await until(async () => (await currentTitle()) === b.title, 'on to B')
  await until(async () => (await propsOf(a.id)).status.value[0] === 'scheduled', 'A is scheduled')
  assert.equal(day((await propsOf(a.id)).dodate), plus(1))
  assert.deepEqual(await texts(a.id), ['Asked about the quote', 'Will do it Friday'])
  assert.equal(await box.inputValue(), '', 'the box is empty on the next card')
  await page.keyboard.press('ArrowLeft')
  await until(async () => (await currentTitle()) === a.title, 'back to A')
  assert.equal((await page.locator('[data-process-latest-text]').innerText()).trim(), 'Will do it Friday', 'the newest comment')
  await undo()
  await until(async () => (await propsOf(a.id)).status.value[0] === 'inbox', 'Undo puts the status back')
  await until(async () => (await texts(a.id)).length === 1, 'and takes the comment away')
  assert.deepEqual(await texts(a.id), ['Asked about the quote'])
  await until(async () => (await page.locator('[data-process-latest-text]').innerText()).trim() === 'Asked about the quote', 'the card shows the one before')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await currentTitle()) === b.title, 'on to B')

  step('leaving a card with text and no decision saves it alone: Escape leaves the box (the review stays), then the arrow')
  await box.fill('Parked for the weekend')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-process-mode]').count(), 1, 'Escape in the box does not pause the review')
  assert.equal(await box.evaluate((el) => el === document.activeElement), false, 'and blurs it')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await texts(b.id)).length === 1, 'B has the comment')
  assert.deepEqual(await texts(b.id), ['Parked for the weekend'])
  assert.equal((await propsOf(b.id)).status.value[0], 'inbox', 'no decision')
  assert.equal(await page.locator('[data-process-outcome]').count(), 0)
  await until(async () => (await currentTitle()) === c.title, 'on to the check-ins: C')

  step('a check-in with comments: the newest (another author, named, dated, three lines at most), the next step chip filled; widths and screenshots')
  const label = (await page.locator('[data-process-latest-label]').innerText()).trim()
  assert.equal(label, `${short(plus(-2))} · Ana Teste`)
  assert.equal(await callout.evaluate((el) => [getComputedStyle(el).borderLeftWidth, getComputedStyle(el).backgroundColor].join()), '0px,rgba(0, 0, 0, 0)', 'no stripe, no tinted box')
  const latest = page.locator('[data-process-latest-text]')
  assert.equal((await latest.innerText()).trim(), long.trim())
  const lines = await latest.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  assert(lines <= 3, `the comment shows ${lines} lines`)
  assert.match(await page.locator('[data-process-facts]').innerText(), /next step: Call the plumber/, 'the facts line says the next step')
  await openFacts()
  assert.equal(await page.locator('[data-process-field="nextstep"]').evaluate((el) => (el.querySelector('input, textarea')?.value ?? el.textContent).includes('Call the plumber')), true, 'the next step shows when it has one')
  // Chips above the callout, the callout above the box, the box above the Open page row.
  const order = await page.evaluate(() => ['[data-process-plan]', '[data-process-latest-comment]', '[data-process-comment]', '[data-process-open]'].map((s) => document.querySelector(s).getBoundingClientRect().top))
  assert.deepEqual([...order].sort((x, y) => x - y), order, `order of the card: ${order}`)
  await box.fill('Thursday works for me')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.equal(await page.locator('[data-process-card]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `card overflow at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('phone-card')
  await page.setViewportSize({ width: 1280, height: 800 })
  assert.equal(await box.inputValue(), 'Thursday works for me', 'the text stays across a resize')
  await shot('desktop-card')

  step('desktop: Done takes the typed text along; the Undo puts the status back and the comments as they were')
  await click('[data-process-role="done"]')
  await until(async () => (await currentTitle()) === d.title, 'on to D')
  await until(async () => (await propsOf(c.id)).status.value[0] === 'done', 'C is done')
  assert.deepEqual(await texts(c.id), ['Asked the landlord', long, 'Thursday works for me'])
  await undo()
  await until(async () => (await propsOf(c.id)).status.value[0] === 'next', 'Undo puts the status back')
  await until(async () => (await texts(c.id)).length === 2, 'and removes the comment')
  assert.deepEqual(await texts(c.id), ['Asked the landlord', long])

  step('D has no next step (no chip); key C writes a comment, Enter on a check-in is Keep as planned with it; Escape first')
  await openFacts()
  assert.equal(await page.locator('[data-process-field="nextstep"]').count(), 0)
  assert.equal(await page.locator('[data-key="C"]').count(), 0, 'no button has C')
  await page.keyboard.press('c')
  assert.equal(await box.evaluate((el) => el === document.activeElement), true, 'C focuses the box')
  assert.equal(await currentTitle(), d.title, 'and types no letter into anything else')
  await page.keyboard.type('Kept going with this')
  await page.keyboard.press('Enter')
  await until(async () => (await currentTitle()) === e.title, 'Keep moved on to E')
  await until(async () => day((await propsOf(d.id)).reviewed) === today, 'D reviewed today')
  assert.deepEqual(await texts(d.id), ['Kept going with this'])
  assert.equal((await propsOf(d.id)).status.value[0], 'next')
  assert.equal((await page.locator('[role=status]').innerText()).includes('Undo'), true)

  step('E: Pause with text saves it alone, and the review can be resumed')
  await page.keyboard.press('c')
  await page.keyboard.type('Before lunch')
  await click('[data-process-close]')
  await page.locator('[data-process-mode]').waitFor({ state: 'detached' })
  await until(async () => (await texts(e.id)).length === 1, 'E has the comment')
  assert.deepEqual(await texts(e.id), ['Before lunch'])
  assert.equal((await propsOf(e.id)).reviewed, undefined, 'not reviewed')
  await reviewButton.click()
  await until(async () => (await currentTitle()) === e.title, 'the review resumes on E')
  assert.equal(await box.inputValue(), '', 'the box starts empty')
  assert.equal((await page.locator('[data-process-latest-text]').innerText()).trim(), 'Before lunch')

  step('F: Back with text saves it too; blank text is nothing')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await currentTitle()) === f.title, 'on to F')
  await page.keyboard.press('c')
  await page.keyboard.type('Remember the receipts')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowLeft')
  await until(async () => (await currentTitle()) === e.title, 'back to E')
  await until(async () => (await texts(f.id)).length === 1, 'F has the comment')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await currentTitle()) === f.title, 'F again')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await currentTitle()) === g.title, 'on to G')
  assert.equal((await page.locator('[data-process-latest-label]').innerText()).trim(), short(plus(-7)))
  await page.keyboard.press('c')
  await page.keyboard.type('   ')
  await click('[data-process-reviewed]')
  await until(async () => day((await propsOf(g.id)).reviewed) === today, 'G kept')
  assert.deepEqual(await texts(g.id), ['Mine from last week'], 'blank text adds nothing')
  assert.deepEqual(errors, [])
  console.log(`Review comments checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-comments-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await ana?.dispose()
  await context.close()
  await browser?.close()
}
