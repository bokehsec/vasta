// Isolated Review tasks: the one button, the combined queue (new, then check-ins), the status choices,
// Keep, Later, Undo, questions, the end, interruption, view-scoped reviews, phone sizes.
// node task-workflows.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica
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
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-workflow-')), options) : await browser.newContext(options)
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
let space
try {
  // Log in and make the data before the app first loads, so the replica's first sync has the space.
  await post('/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await post('/api/spaces', { name: `Workflow check ${engine} ${Date.now()}` })
  const bundle = await get(`/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  const viewId = 'held'
  type = await put(`/api/types/${type.id}`, {
    ...type,
    properties: type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'hold', label: 'On hold' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' },
    ] } : p).concat([{ id: 'nextstep', name: 'Next step', kind: 'text' }]),
    // The type's own Defer sets the Do date (the built-in plan date) and the Scheduled status.
    quickActions: { nextStepField: 'nextstep', reviewEvery: 7, triageStatuses: ['inbox'], actions: [
      { id: 'done', name: 'Mark done', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['done'] } } }] },
      { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }, { field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['scheduled'] } } }] },
      { id: 'drop', name: 'Drop', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['drop'] } } }] },
      { id: 'next-step', name: 'Next step', changes: [{ field: 'nextstep', value: { kind: 'ask' } }] },
    ] },
    views: [{ id: 'all', name: 'All tasks', layout: 'list', sort: [{ field: 'createdAt', direction: 'asc' }] }, { id: viewId, name: 'On hold — due for review', layout: 'list', filter: { kind: 'group', operator: 'and', items: [
      { kind: 'filter', field: 'status', operator: 'is', value: { kind: 'literal', value: ['hold'] } }, { kind: 'filter', field: 'reviewDue', operator: 'is-checked' },
    ] } }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const date = (day) => ({ kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } })
  const make = (title, status, reviewed) => post('/api/objects', { typeId: type.id, title, props: { ...(status ? { status: { kind: 'select', value: [status] } } : {}), ...(reviewed ? { reviewed: date(reviewed) } : {}) }, content: { body: { type: 'doc', content: Array.from({ length: 18 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Context ${i + 1}: enough information to understand this commitment and decide what happens next.` }] })) } } })
  const a = await make('A long incoming task title that must wrap on a small phone without pushing its actions off the screen', undefined, yesterday)
  const b = await make('B incoming', 'inbox', today)
  const c = await make('C commitment', 'next')
  const d = await make('D parked commitment', 'hold')
  await make('E recently reviewed', 'next', today)
  await make('F finished', 'done')
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  await page.request.put(`${base}/api/auth/me`, { headers: { 'x-requested-with': 'vasta' }, data: { preferences: { [`type/${type.id}/last-view`]: 'all' } } })
  await page.evaluate((spaceId) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId)), space.id)
  await page.reload({ waitUntil: 'networkidle' })
  // The replica pulls the new space in the background: reopen the page until it has the type.
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone: one Review button with the count, no Triage/Review buttons; the chooser sits in the ⋯ menu')
  assert.equal(await page.locator('[data-process]').count(), 0)
  assert.equal(await page.locator('[data-tab-bar] [data-tab]').count(), 5)
  assert.equal(await page.locator('[data-workflow-triage], [data-workflow-review]').count(), 0)
  assert.equal(await page.locator('[data-review-tasks]').count(), 1)
  assert.match((await page.locator('[data-review-tasks]').innerText()).replace(/\s+/g, ' ').trim(), /^Review 4$/)
  const entry = await page.locator('[data-review-tasks]').boundingBox()
  assert(entry.height >= 44 && entry.x >= 0 && entry.x + entry.width <= 390, `Review button: ${JSON.stringify(entry)}`)
  await page.locator('main header button[title="More"]').click()
  await click('[data-workflows]')
  const startText = (await page.locator('[data-start-review]').innerText()).replace(/\s+/g, ' ')
  assert.match(startText, /2 new · 2 check-ins/)
  assert.match(startText, /4$/)
  assert.equal(await page.locator('[data-start-triage]').count(), 0)
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    assert.equal(await page.locator('[data-workflow-chooser]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `chooser overflow at ${width}`)
    assert((await page.locator('[data-start-review]').boundingBox()).height >= 44)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-chooser.png`) })
  await click('[data-start-review]')
  await until(async () => (await currentTitle()) === a.title, 'the review starts with the oldest new task')
  assert.equal(await page.locator('#app').evaluate((el) => el.inert), true)
  assert.equal((await page.locator('[data-process-heading]').innerText()).trim(), 'Review tasks')
  assert.equal((await position.innerText()).trim(), 'New 1 of 2')
  assert.equal(await page.locator('[data-process-reviewed]').count(), 0, 'a new task has no Keep')
  assert.equal(await page.locator('[data-process-more], [data-process-notes-toggle]').count(), 0)
  // Four buttons, none highlighted (a new task has no status of its own to keep); the rest are links.
  assert.deepEqual(await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => `${el.dataset.processRole}:${el.dataset.processChoice}`)), ['next:next', 'defer:scheduled', 'done:done', 'drop:drop'])
  assert.deepEqual(await page.locator('[data-process-links] [data-process-choice]').evaluateAll((els) => els.map((el) => el.dataset.processChoice)), ['hold'])
  assert.equal(new Set(await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))).size, 1, 'no button highlighted on a new task')
  assert.match(await page.locator('[data-process-skip]').innerText(), /Later/)
  assert.match(await page.locator('[data-process-text]').innerText(), /Context 18:/, 'the notes are shown in full')
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const box = await page.locator('[data-process-card]').boundingBox()
    assert(box.height > 160, `not enough reading space at ${width}: ${box.height}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.equal(await page.locator('[data-process-card]').evaluate((el) => el.scrollWidth > el.clientWidth), false, `card overflow at ${width}`)
    for (const selector of ['[data-process-choice]', '[data-process-skip]']) for (const button of await page.locator(selector).all()) assert((await button.boundingBox()).height >= 44, `${selector} under 44px at ${width}`)
    // The plan: two fields to a row, in the scroll area.
    const fields = await page.locator('[data-process-plan] > div').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
    assert(fields.length >= 4 && fields[0] === fields[1], `plan is not two to a row at ${width}: ${fields}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-new.png`) })

  step('the next step is a plan field: saved in place, the review stays on the task and records nothing')
  const nextStep = page.locator('[data-process-plan] div').filter({ has: page.locator('p', { hasText: /^Next step$/ }) }).locator('input, textarea').first()
  await nextStep.fill('Call the owner')
  await nextStep.press('Enter')
  await until(async () => (await propsOf(a.id)).nextstep?.value === 'Call the owner', 'next step saved')
  assert.equal((await position.innerText()).trim(), 'New 1 of 2')
  assert.equal((await propsOf(a.id)).reviewed.value.start.slice(0, 10), yesterday)
  assert.equal(await page.locator('[data-process-outcome]').count(), 0)

  step('a status choice settles a new task and moves on; Undo restores it; the notice names the move')
  await click('[data-process-choice="next"]')
  await until(async () => /^New 2 of 2/.test(await position.innerText()), 'a status settles the new task')
  await until(async () => (await propsOf(a.id)).status?.value[0] === 'next', 'status saved')
  assert.match(await page.locator('[role=status]').innerText(), /Moved to Next/)
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => !(await propsOf(a.id)).status, 'undo restores the incoming status')
  assert.equal(await currentTitle(), b.title, 'Undo does not move the review')

  step('Defer… (the type\'s own Defer, setting Scheduled) asks a date; Tomorrow saves at once; failure/Retry in HTTP mode; then on to the check-ins')
  await click('[data-process-choice="scheduled"]')
  if (process.env.MODE === 'json') {
    await page.route(`**/api/objects/${b.id}`, (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test save failure' }) }) : route.continue())
    await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
    await page.locator('[data-ask-error]').waitFor()
    assert.equal((await page.locator('[data-ask-save]').innerText()).trim(), 'Retry')
    await page.unroute(`**/api/objects/${b.id}`)
    await click('[data-ask-save]')
  } else await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
  await until(async () => (await propsOf(b.id)).status?.value[0] === 'scheduled', 'Defer placed the task in Scheduled')
  assert.equal((await propsOf(b.id)).dodate.value.start.slice(0, 10), tomorrow)
  await until(async () => (await currentTitle()) === c.title, 'on to the first check-in')
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 2')

  step('a check-in: its status is pressed, Keep names it, Keep records Reviewed and leaves the plan')
  // The status it has is Keep (highlighted), never a button of its own; Next is not a link either.
  assert.equal(await page.locator('[data-process-choice="next"]').count(), 0)
  assert.deepEqual(await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.dataset.processRole)), ['defer', 'done', 'drop'])
  assert.notEqual(await page.locator('[data-process-reviewed]').evaluate((el) => getComputedStyle(el).backgroundColor), await page.locator('[data-process-role="done"]').evaluate((el) => getComputedStyle(el).backgroundColor))
  assert.match(await page.locator('[data-process-links]').innerText(), /Move to\s+On hold/)
  assert.match(await page.locator('[data-process-reviewed]').innerText(), /Keep in Next/)
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-checkin.png`) })
  await click('[data-process-reviewed]')
  await until(async () => (await currentTitle()) === d.title, 'next check-in')
  await until(async () => (await propsOf(c.id)).reviewed?.value.start.slice(0, 10) === today, 'review date saved')
  assert.equal((await propsOf(c.id)).status.value[0], 'next')
  assert.equal((await position.innerText()).trim(), 'Check-in 2 of 2')

  step('Later records nothing; the end counts moves, Reviewed and what was left; Review skipped starts again with the right counts')
  await click('[data-process-skip]')
  await page.locator('[data-process-end]').waitFor()
  const summary = await page.locator('[data-process-summary]').innerText()
  assert.match(summary, /Defer 1/)
  assert.match(summary, /Reviewed 1/)
  assert.match(summary, /2 left for later/, 'the undone task and the one left for later')
  assert.equal((await propsOf(d.id)).status.value[0], 'hold')
  await click('[data-process-review-skipped]')
  assert.match(await page.locator('[data-process-heading]').innerText(), /Review tasks/)
  assert.equal((await position.innerText()).trim(), 'New 1 of 1', 'the skipped new task, counted apart')
  assert.equal(await currentTitle(), a.title)

  step('the full text and reading position survive Pause, reload and the page return; Resume from the one button')
  await page.locator('[data-process-card]').evaluate((el) => el.scrollTop = 150)
  await click('[data-process-close]')
  assert.equal(await page.locator('#app').evaluate((el) => el.inert), false)
  await until(async () => /Resume\s+1 of 2/.test(await page.locator('[data-review-tasks]').innerText()), 'the button offers the paused session')
  await page.reload()
  await until(async () => /Resume\s+1 of 2/.test(await page.locator('[data-review-tasks]').innerText()), 'the paused session after a reload')
  await click('[data-review-tasks]')
  await until(async () => (await page.locator('[data-process-card]').evaluate((el) => el.scrollTop)) >= 149, 'restored scroll after reload')
  assert.match(await page.locator('[data-process-text]').innerText(), /Context 18:/)
  await click('[data-process-open]')
  await page.waitForURL(`**/o/${a.id}`)
  await page.goBack()
  await page.locator('[data-process-mode]').waitFor()
  assert.equal(await currentTitle(), a.title)
  await until(async () => (await page.locator('[data-process-card]').evaluate((el) => el.scrollTop)) > 100, 'scroll after details return')
  await click('[data-process-close]')

  step('⋯ › Review tasks… shows the paused block; End session forgets only the session')
  await page.locator('main header button[title="More"]').click()
  await click('[data-workflows]')
  assert.match(await page.locator('[data-workflow-paused]').innerText(), /1 of 2/)
  assert.match(await page.locator('[data-start-review]').innerText(), /Start a new review/)
  await click('[data-process-end-session]')
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await until(async () => (await page.locator('[data-workflow-paused]').count()) === 0, 'end cleared the session')
  assert.equal((await propsOf(a.id)).nextstep.value, 'Call the owner')
  await page.keyboard.press('Escape')
  await page.locator('[data-workflow-chooser]').waitFor({ state: 'detached' })
  await until(async () => /^Review\s+2$/.test((await page.locator('[data-review-tasks]').innerText()).trim()), 'the button counts the new task and the check-in left')

  step('a closing status ends the task: Dropped is named as it is; a decided task offers Next; Later is counted')
  await click('[data-review-tasks]')
  assert.equal((await position.innerText()).trim(), 'New 1 of 1')
  await click('[data-process-choice="drop"]')
  await until(async () => (await propsOf(a.id)).status?.value[0] === 'drop', 'Dropped saved')
  assert.match(await page.locator('[role=status]').innerText(), /Dropped/)
  assert.doesNotMatch(await page.locator('[role=status]').innerText(), /Moved to/)
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 1')
  await click('[data-process-back]')
  assert.match(await page.locator('[data-process-outcome]').innerText(), /Dropped/)
  assert.match(await page.locator('[data-process-skip]').innerText(), /Next/)
  await click('[data-process-skip]')
  await click('[data-process-skip]')
  await page.locator('[data-process-end]').waitFor()
  assert.match(await page.locator('[data-process-summary]').innerText(), /^Dropped 1 · 1 left for later$/)
  await click('[data-process-finish]')

  step('view review uses the same incoming/check-in routine with exact scope; its Keep and plan field work')
  await click('[data-view-picker]')
  await page.locator('[data-view-option]', { hasText: /^\s*On hold — due for review\s*$/ }).click()
  await page.locator('main header button[title="More"]').click()
  await click('[data-review-view]')
  assert.match(await page.locator('[data-workflow-chooser]').innerText(), /On hold — due for review/)
  assert.match(await page.locator('[data-process]').innerText(), /Review 1 task/)
  await click('[data-process]')
  await page.locator('[data-process-mode]').waitFor()
  assert.match(await page.locator('[data-process-heading]').innerText(), /Review tasks/)
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 1')
  await until(async () => (await currentTitle()) === d.title, 'targeted queue matches view')
  await page.locator('[data-process-plan] div').filter({ has: page.locator('p', { hasText: /^Next step$/ }) }).locator('input, textarea').first().fill('Revisit the plan')
  await page.locator('[data-process-plan] div').filter({ has: page.locator('p', { hasText: /^Next step$/ }) }).locator('input, textarea').first().press('Enter')
  await until(async () => (await propsOf(d.id)).nextstep?.value === 'Revisit the plan', 'review edit saved')
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 1')
  await click('[data-process-reviewed]')
  await page.locator('[data-process-end]').waitFor()
  await click('[data-process-finish]')

  step('desktop: one Review button; nothing to review opens the chooser; a waiting task starts it at once')
  await page.setViewportSize({ width: 1280, height: 800 })
  const reviewButton = page.locator('[data-review-tasks]')
  assert.equal(await reviewButton.count(), 1)
  assert.equal(await page.locator('[data-workflow-triage], [data-workflow-review]').count(), 0)
  // Nothing waits: grey, no count, and a press opens the chooser, which says why.
  await until(async () => (await reviewButton.innerText()).trim() === 'Review', 'Review without a count')
  assert.match(await reviewButton.getAttribute('class'), /bg-hover/)
  await reviewButton.click()
  assert.match(await page.locator('[data-start-review]').innerText(), /Nothing to review/)
  assert(await page.locator('[data-start-review]').isDisabled())
  await page.keyboard.press('Escape')
  await page.locator('[data-workflow-chooser]').waitFor({ state: 'detached' })
  // A check-in (long unreviewed) and a new task wait: tinted, counted, a press starts the review.
  // Made through the API as new tasks: the replica pulls them, and nothing it holds is overwritten.
  await page.locator('main [role=button]', { hasText: /^\s*All tasks\s*$/ }).click()
  const g = await make('G newest incoming')
  const h = await make('H old commitment', 'next', '2020-01-01')
  await until(async () => /^Review\s+2$/.test((await reviewButton.innerText()).trim()), 'Review 2')
  assert.match(await reviewButton.getAttribute('class'), /bg-accent\/12/)
  await reviewButton.click()
  await page.locator('[data-process-mode]').waitFor()
  assert.equal((await position.innerText()).trim(), 'New 1 of 1')
  assert.equal(await currentTitle(), g.title)
  // The choices sit under the task, centred; the plan beside it.
  const choices = await page.locator('[data-process-choices]').boundingBox()
  const side = await page.locator('[data-process-side]').boundingBox()
  assert(choices.x + choices.width <= side.x + 1 && choices.y > 500, `choices under the task: ${JSON.stringify(choices)}`)
  const row = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.right]))
  assert(Math.abs((row[0][0] - choices.x) - (choices.x + choices.width - row.at(-1)[1])) < 4, 'the row is centred')
  assert.equal(await page.locator('[data-process-role]').count(), 4)
  assert.match(await page.locator('[data-process-plan]').innerText(), /Status/)
  assert.equal(await page.locator('[data-process-reviewed]').count(), 0)
  assert.match(await page.locator('[data-process-skip]').innerText(), /Decide later/)
  assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false)

  step('desktop keys: N for Next, ← goes back, → is later, Esc pauses, Resume on the button, K keeps; the notice clears the buttons')
  await page.keyboard.press('n')
  await until(async () => (await propsOf(g.id)).status?.value[0] === 'next', 'key 1 placed it in Next')
  assert.equal((await position.innerText()).trim(), 'Check-in 1 of 1')
  assert.equal(await currentTitle(), h.title)
  assert.match(await page.locator('[data-process-reviewed]').innerText(), /Keep in Next/)
  const notice = await page.locator('[role=status]').boundingBox()
  assert(notice.y + notice.height <= (await page.locator('[data-process-choices]').boundingBox()).y + 1, 'Undo sits above the buttons')
  await page.keyboard.press('ArrowLeft')
  assert.match(await page.locator('[data-process-outcome]').innerText(), /Moved to Next/)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await page.locator('[data-process-mode]').waitFor({ state: 'detached' })
  await until(async () => /Resume review\s+2 of 2/.test(await reviewButton.innerText()), 'the paused session is on the button')
  await reviewButton.click()
  await page.locator('[data-process-mode]').waitFor()
  await page.keyboard.press('k')
  await until(async () => (await propsOf(h.id)).reviewed?.value.start.slice(0, 10) === today, 'K kept it')
  await page.locator('[data-process-end]').waitFor()
  assert.match(await page.locator('[data-process-summary]').innerText(), /Moved to Next 1 · Reviewed 1/)
  await page.keyboard.press('Escape')
  await page.locator('[data-process-mode]').waitFor({ state: 'detached' })
  // A finished review is not offered to resume.
  await until(async () => (await reviewButton.innerText()).trim() === 'Review', 'no Resume after a finished review')
  // Any status change counts as reviewed, wherever it is made: Done on the task's page (saved at once, awaited), and
  // a rename leaves the date alone. (The replica uses this device's day, the server the user's: allow either side of midnight.)
  step('a status changed on the task page marks it reviewed; a rename does not')
  const day = (value) => value?.value.start.slice(0, 10)
  const near = (value) => [yesterday, today, tomorrow].includes(day(value))
  const k = await make('K finished on its page', 'next')
  await put(`/api/objects/${k.id}`, { ...(await get(`/api/objects/${k.id}`)), title: 'K renamed' })
  assert.equal((await propsOf(k.id)).reviewed, undefined, 'a rename is not a review')
  await page.goto(`${base}/o/${k.id}`)
  await page.locator('[data-quick-actions] [data-action="done"]').click()
  await until(async () => (await propsOf(k.id)).status?.value[0] === 'done', 'Done saved')
  assert(near((await propsOf(k.id)).reviewed), 'Done marked it reviewed')
  await page.locator('[role=status]').filter({ hasText: /Done/ }).getByRole('button', { name: 'Undo' }).click()
  await until(async () => (await propsOf(k.id)).status?.value[0] === 'next', 'Undo put the status back')
  assert.equal((await propsOf(k.id)).reviewed, undefined, 'Undo put the review day back too')
  assert.deepEqual(errors, [])
  console.log(`Task workflow checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-failure.png`) }).catch(() => {})
  throw error
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
