// The review of the current view in the test env ("Review this view…"). Desktop: the review by keys
// (D Done, → skip, ← back, S Scheduled asking a date), the end's counts (each task once), Escape;
// then the review counts only tasks not reviewed this week, "Review all" takes them all, R marks
// one reviewed, and a task's whole notes show (not the list's first 280 characters). Phone (390×844,
// touch): its button in full, full screen, a swipe left skipping, Done and Undo, the next step saved
// as a plan field (the review stays on the task; Later goes on), Pause and Resume from the one
// Review button (also after a reload), Open page and Back to the same task, the end's counts,
// Review skipped, End.
// Chromium sends real touches (CDP); WebKit gets touch-shaped events in the page and a faked
// `hover: none` (see phone-rows.mjs).
//   node review.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
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
  const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-')), options) : await browser.newContext(options)
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
const viewId = `${taskType.id}:review`
const status = found.properties.find((p) => p.id === 'status')
// A failed run of this check (or of the bulk one it replaced) may have left its additions on the type.
const original = {
  ...found,
  views: found.views.filter((v) => v.id !== viewId && v.id !== `${taskType.id}:bulk`),
  properties: found.properties.filter((p) => !['dodate', 'bulknext', 'reviewnext'].includes(p.id)).map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== 'scheduled') } : p)),
  quickActions: undefined,
}
const baseStatus = original.properties.find((p) => p.id === 'status')
await put(`/api/types/${taskType.id}`, {
  ...original,
  properties: [...original.properties.map((p) => (p.id === 'status' ? { ...baseStatus, options: [...baseStatus.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }] } : p)), { id: 'dodate', kind: 'date', name: 'Do date' }, { id: 'reviewnext', kind: 'text', name: 'Next step' }],
  // These are established commitments; incoming-task decisions are covered by task-workflows.mjs.
  quickActions: { triageStatuses: [], deferField: 'dodate', deferStatus: 'scheduled', nextStepField: 'reviewnext' },
  views: [{ id: viewId, name: 'Review cycle', layout: 'list', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `Review ${tag}` } }] } }, ...original.views],
})
const todo = status.options.find((o) => o.status === 'todo').id
const doneId = status.options.find((o) => o.status === 'done').id
const tasks = []
// Notes longer than the list's preview: the review shows them to the end.
const longNotes = { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${'Long notes. '.repeat(40)}The end of the notes ${tag}.` }] }] } }
for (const name of ['A', 'B', 'C', 'D', 'E']) tasks.push(await post('/api/objects', { typeId: taskType.id, title: `Review ${tag} ${name}`, props: { status: { kind: 'select', value: [todo] } }, content: longNotes }))
await sleep(1500)
const days = await page.evaluate(() => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = key(new Date())
  return { today, tomorrow: key(new Date(new Date(`${today}T12:00:00`).getTime() + 86400000)) }
})
const propsOf = async (id) => (await get(`/api/objects/${id}`)).props
const statusOf = async (id) => (await propsOf(id)).status?.value?.[0]
const dayOf = (value) => value?.value?.start?.slice(0, 10)
const dodateOf = async (id) => (await propsOf(id)).dodate?.value?.start?.slice(0, 10)
// A phone picks a view in the views sheet; a wider screen has tabs.
const openView = async () => {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  if (await page.locator('[data-view-picker]').count()) {
    await page.locator('[data-view-picker]').click()
    await page.locator('[data-view-option]', { hasText: /^\s*Review cycle\s*$/ }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: /^\s*Review cycle\s*$/ }).first().click()
  await page.locator(`main a[href="/o/${tasks[0].id}"]`).waitFor()
}
const openReviewChooser = async () => {
  await page.locator('main header button[title="More"]').click()
  await page.locator('[data-review-view]').click()
}
// The next step is a field of the plan on the review screen (no menu any more).
const nextStepInput = () => page.locator('[data-process-plan] div').filter({ has: page.locator('p', { hasText: /^Next step$/ }) }).locator('input, textarea').first()
const toast = () => page.locator('[role=status]')

try {
  // ---------------------------------------------------------------------------
  step('review: keys D (Done), → skip, ← back, S (Scheduled asks a date), to the end, its counts (each task once), Escape')
  await openView()
  await openReviewChooser()
  if (!/Review 5 tasks/.test(await page.locator('[data-process]').innerText())) throw new Error(`review button: ${await page.locator('[data-process]').innerText()}`)
  await page.locator('[data-process]').click()
  const position = page.locator('[data-process-position]')
  const titleNow = async () => (await page.locator('[data-process-title]').innerText()).trim()
  await until(async () => (await position.innerText()).startsWith('Check-in 1 of 5'), '1 of 5')
  const firstTitle = await titleNow()
  await page.keyboard.press('d')
  await until(async () => (await position.innerText()).startsWith('Check-in 2 of 5'), 'Done moved on')
  const doneTask = tasks.find((t) => t.title === firstTitle)
  await until(async () => (await statusOf(doneTask.id)) === doneId, 'key D ran Done')
  await page.keyboard.press('ArrowRight')
  await until(async () => (await position.innerText()).startsWith('Check-in 3 of 5'), '→ skipped')
  await page.keyboard.press('ArrowLeft')
  await until(async () => (await position.innerText()).startsWith('Check-in 2 of 5'), '← went back')
  const deferTitle = await titleNow()
  await page.keyboard.press('s')
  await page.locator('[data-defer-menu]').waitFor()
  await page.locator('[data-defer-menu] button', { hasText: /^Tomorrow$/ }).click()
  await page.locator('[data-defer-menu] [data-ask-save]').click()
  await until(async () => (await position.innerText()).startsWith('Check-in 3 of 5'), 'Scheduled moved on')
  await until(async () => (await dodateOf(tasks.find((t) => t.title === deferTitle).id)) === days.tomorrow, 'key S scheduled it for tomorrow')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.locator('[data-process-end]').waitFor()
  const summary = await page.locator('[data-process-summary]').innerText()
  if (!/Done 1/.test(summary) || !/Moved to Scheduled 1/.test(summary) || !/3 left for later/.test(summary)) throw new Error(`end summary: ${summary}`)
  await page.keyboard.press('Escape')
  await until(async () => (await page.locator('[data-process-mode]').count()) === 0, 'Escape closed it')
  // Closed at the end, the review is over: no Resume, a new review offered.
  await until(async () => (await page.locator('[data-process-resume]').count()) === 0, 'a finished review is not offered to resume')
  await openReviewChooser()

  step('review dates: the deferred task was reviewed today, so the review is of 3; Review all takes them; R marks one reviewed; whole notes')
  const deferred = tasks.find((t) => t.title === deferTitle)
  if (dayOf((await propsOf(deferred.id)).reviewed) !== days.today) throw new Error('Defer in a review did not mark the task reviewed')
  await until(async () => /Review 3 tasks/.test(await page.locator('[data-process]').innerText()), 'Review 3 tasks (one reviewed today, one done)')
  if (!/Review all 4/.test(await page.locator('[data-process-all]').innerText())) throw new Error(`review all: ${await page.locator('[data-process-all]').innerText()}`)
  await page.locator('[data-process-all]').click()
  await until(async () => (await position.innerText()).startsWith('Check-in 1 of 4'), 'Review all: 1 of 4')
  const reviewedTitle = await titleNow()
  const reviewedId = tasks.find((t) => t.title === reviewedTitle).id
  const statusBefore = await statusOf(reviewedId)
  await page.keyboard.press('r')
  await until(async () => (await position.innerText()).startsWith('Check-in 2 of 4'), 'R moved on')
  await until(async () => dayOf((await propsOf(reviewedId)).reviewed) === days.today, 'R set Last reviewed to today')
  if ((await statusOf(reviewedId)) !== statusBefore) throw new Error('Reviewed changed the status')
  if (!/^Reviewed/.test(await toast().innerText())) throw new Error(`notice: ${await toast().innerText()}`)
  await until(async () => (await page.locator('[data-process-text]').count()) === 1 && (await page.locator('[data-process-text]').innerText()).includes(`The end of the notes ${tag}.`), 'the whole notes in the review, shown without a toggle')
  await page.keyboard.press('Escape')
  await until(async () => (await page.locator('[data-process-mode]').count()) === 0, 'Escape closed it')
  // Back to "to do" for the phone's turn.
  for (const t of tasks) {
    const object = await get(`/api/objects/${t.id}`)
    await put(`/api/objects/${t.id}`, { ...object, props: { status: { kind: 'select', value: [todo] } } })
  }
  await context.close()

  // ---------------------------------------------------------------------------
  step('phone: Review this view in More; full-screen review; swipe left skips; Done moves on')
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
  await openReviewChooser()
  const entry = page.locator('[data-process]')
  await entry.waitFor()
  const entryBox = await entry.boundingBox()
  if (!entryBox || entryBox.x < 0 || entryBox.x + entryBox.width > 390 || entryBox.height < 44) throw new Error(`Review button not usable: ${JSON.stringify(entryBox)}`)
  if (!/Review 5 tasks/.test(await entry.innerText())) throw new Error(`review button: ${await entry.innerText()}`)
  await tap(entry)
  const dialog = await page.locator('[data-process-mode] [role=dialog]').boundingBox()
  if (dialog.width < 385 || dialog.height < 800) throw new Error(`process mode is not full screen: ${JSON.stringify(dialog)}`)
  const pos = page.locator('[data-process-position]')
  await until(async () => (await pos.innerText()).startsWith('Check-in 1 of'), 'process mode on the phone')
  const card = await page.locator('[data-process-card]').boundingBox()
  await touchAt(card.x + card.width - 40, card.y + 80, -260, 0, 8)
  await until(async () => (await pos.innerText()).startsWith('Check-in 2 of'), 'a swipe left skipped')
  // Keep (the status it has, To do), Schedule… and Done as buttons in the tray, In progress a link; no menu.
  const choices = await page.locator('[data-process-choice]').all()
  const roles = await page.locator('[data-process-role]').evaluateAll((els) => els.map((el) => el.dataset.processRole).join())
  if (roles !== 'schedule,done' || choices.length !== 3) throw new Error(`review choices: ${roles}, ${choices.length}`)
  if ((await page.locator('[data-process-links]').innerText()).replace(/\s+/g, ' ').trim() !== 'Move to In progress') throw new Error(`links: ${await page.locator('[data-process-links]').innerText()}`)
  for (const choice of choices) if ((await choice.boundingBox()).height < 44) throw new Error('a choice under 44px')
  if (await page.locator('[data-process-more]').count()) throw new Error('the review still has a menu')
  const doneTitle = (await page.locator('[data-process-title]').innerText()).trim()
  await tap(page.locator('[data-process-choice="' + doneId + '"]'))
  await until(async () => (await pos.innerText()).startsWith('Check-in 3 of'), 'Done moved on')
  const phoneDone = tasks.find((t) => t.title === doneTitle)
  await until(async () => (await statusOf(phoneDone.id)) === doneId, 'Done saved')
  // Undo takes the decision off again (the end counts it as skipped, not done); the place stays.
  await tap(toast().locator('button', { hasText: 'Undo' }))
  await until(async () => (await statusOf(phoneDone.id)) === todo, 'Done undone')
  if (!(await pos.innerText()).startsWith('Check-in 3 of')) throw new Error('Undo moved the review')

  step('phone: the next step is a plan field: saved in place, the review stays on the task; Later goes on')
  const stepTitle = (await page.locator('[data-process-title]').innerText()).trim()
  await nextStepInput().fill('Call the plumber')
  await nextStepInput().press('Enter')
  const stepTask = tasks.find((t) => t.title === stepTitle)
  await until(async () => (await propsOf(stepTask.id)).reviewnext?.value === 'Call the plumber', 'the next step saved')
  if (!(await pos.innerText()).startsWith('Check-in 3 of')) throw new Error(`the next step moved the review: ${await pos.innerText()}`)
  if ((await titleNow()) !== stepTitle) throw new Error('the next step left the task')
  if ((await page.locator('[data-process-outcome]').count()) !== 0) throw new Error('a next step counted as a decision')
  await tap(page.locator('[data-process-skip]'))
  await until(async () => (await pos.innerText()).startsWith('Check-in 4 of'), 'Later moved on')

  step('phone: Close keeps the place, also over a reload; Open details and Back return to the same task')
  await tap(page.locator('[data-process-close]'))
  // A phone's one Review button says the paused place; pressing it resumes.
  const reviewButton = page.locator('[data-review-tasks]')
  const pausedAt = async (at) => (await reviewButton.count()) === 1 && new RegExp(`Resume\\s+${at}`).test(await reviewButton.innerText())
  await until(() => pausedAt('4 of 5'), 'Resume 4 of 5')
  await openView()
  await until(() => pausedAt('4 of 5'), 'Resume after a reload')
  await tap(reviewButton)
  await until(async () => (await pos.innerText()).startsWith('Check-in 4 of 5'), 'resumed at 4 of 5')
  const openedTitle = (await page.locator('[data-process-title]').innerText()).trim()
  await tap(page.locator('[data-process-open]'))
  await page.waitForURL(/\/o\//)
  await page.goBack()
  await until(async () => (await page.locator('[data-process-mode]').count()) === 1 && (await pos.innerText()).startsWith('Check-in 4 of 5'), 'Back from the task returned to the review at 4 of 5')
  if ((await page.locator('[data-process-title]').innerText()).trim() !== openedTitle) throw new Error('Back returned to another task')

  step('phone: the end counts each task once; Review skipped; End forgets the review')
  await tap(page.locator('[data-process-skip]'))
  await tap(page.locator('[data-process-choice="doing"]'))
  await page.locator('[data-process-end]').waitFor()
  const phoneSummary = await page.locator('[data-process-summary]').innerText()
  // Left for later: the swiped one, the one whose Done was undone, the one with a next step, one more.
  if (!/Moved to In progress 1/.test(phoneSummary) || /Done/.test(phoneSummary) || !/4 left for later/.test(phoneSummary)) throw new Error(`end summary: ${phoneSummary}`)
  await tap(page.locator('[data-process-review-skipped]'))
  await until(async () => (await pos.innerText()).startsWith('Check-in 1 of 4'), 'a review of the 4 skipped')
  await tap(page.locator('[data-process-close]'))
  await page.locator('main header button[title="More"]').click()
  await page.locator('[data-workflows]').click()
  await tap(page.locator('[data-process-end-session]'))
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await until(async () => (await page.locator('[data-workflow-paused]').count()) === 0 && !/Resume/.test(await reviewButton.innerText()), 'End forgot the review')
  await phoneContext.close()

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll review checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-review-${engine}.png`)
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
    await put(`/api/types/${taskType.id}`, { ...now, views: original.views, properties: original.properties, quickActions: undefined }).catch(() => {})
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
