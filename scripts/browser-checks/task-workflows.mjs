// Isolated task workflows, phone sizes, interruption, Undo, questions and view-scoped reviews.
// node task-workflows.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
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
const menu = (name) => page.locator('[role="menu"] button').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
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
    ] } : p).concat([{ id: 'nextstep', name: 'Next step', kind: 'text' }, { id: 'do', name: 'Do date', kind: 'date' }]),
    quickActions: { nextStepField: 'nextstep', deferField: 'do', deferStatus: 'scheduled', reviewEvery: 7, triageStatuses: ['inbox'] },
    views: [{ id: 'all', name: 'All tasks', layout: 'list' }, { id: viewId, name: 'On hold — due for review', layout: 'list', filter: { kind: 'group', operator: 'and', items: [
      { kind: 'filter', field: 'status', operator: 'is', value: { kind: 'literal', value: ['hold'] } }, { kind: 'filter', field: 'reviewDue', operator: 'is-checked' },
    ] } }],
  })
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()))
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
  await page.evaluate(({ spaceId, typeId, viewId }) => { localStorage.setItem('vasta.space', spaceId); localStorage.setItem(`vasta.view.${typeId}`, viewId) }, { spaceId: space.id, typeId: type.id, viewId })
  // The replica pulls the new space in the background: reopen the page until it has the type.
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-workflows]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the test space')

  step('phone entry, global queues independent of the saved view, and all phone widths')
  assert.equal(await page.locator('[data-process]').count(), 0)
  assert.equal(await page.locator('[data-tab-bar] [data-tab]').count(), 5)
  await click('[data-workflows]')
  assert.match(await page.locator('[data-start-triage]').innerText(), /2$/)
  assert.match(await page.locator('[data-start-review]').innerText(), /2$/)
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const overflowing = await page.locator('[data-workflow-chooser]').evaluate((el) => el.scrollWidth > el.clientWidth)
    assert.equal(overflowing, false, `chooser overflow at ${width}`)
    for (const selector of ['[data-start-triage]', '[data-start-review]']) assert((await page.locator(selector).boundingBox()).height >= 44)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-chooser.png`) })
  await click('[data-start-triage]')
  await until(async () => (await currentTitle()) === a.title, 'triage starts with oldest incoming')
  assert.equal(await page.locator('#app').evaluate((el) => el.inert), true)
  assert.equal(await page.locator('[data-process-reviewed]').count(), 0)
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    const box = await page.locator('[data-process-card]').boundingBox()
    assert(box.height > 160, `not enough reading space at ${width}: ${box.height}`)
    assert.equal(await page.locator('[data-process-mode]').evaluate((el) => el.scrollWidth > innerWidth), false)
    for (const selector of ['[data-process-more]', '[data-process-action="next-step"]']) assert((await page.locator(selector).boundingBox()).height >= 44)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-triage.png`) })

  step('next-step Save, failure/Retry in HTTP mode, and no false triage completion')
  await click('[data-process-action="next-step"]')
  await page.locator('#quick-ask-text').fill('Call the owner')
  if (process.env.MODE === 'json') {
    await page.route(`**/api/objects/${a.id}`, (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test save failure' }) }) : route.continue())
    await click('[data-ask-save]')
    await page.locator('[data-ask-error]').waitFor()
    assert.equal(await page.locator('#quick-ask-text').inputValue(), 'Call the owner')
    assert.equal((await page.locator('[data-ask-save]').innerText()).trim(), 'Retry')
    await page.unroute(`**/api/objects/${a.id}`)
  }
  await click('[data-ask-save]')
  await until(async () => (await propsOf(a.id)).nextstep?.value === 'Call the owner', 'next step saved')
  assert.match(await position.innerText(), /1 of 2/)
  assert.equal((await propsOf(a.id)).reviewed.value.start.slice(0, 10), yesterday)
  assert.equal(await page.locator('[data-process-outcome]').count(), 0)
  assert.match(await page.locator('[data-process-skip]').innerText(), /Skip/)

  step('status decision, Undo, then scheduling advances and counts only decisions')
  await click('[data-process-more]')
  await menu('Next')
  await until(async () => /2 of 2/.test(await position.innerText()), 'Next settles triage')
  await until(async () => (await propsOf(a.id)).status?.value[0] === 'next', 'status saved')
  await page.locator('[role=status] button').filter({ hasText: 'Undo' }).click()
  await until(async () => !(await propsOf(a.id)).status, 'undo restores incoming status')
  await click('[data-process-more]')
  await menu('Defer…')
  await page.locator('[data-defer-menu] button').filter({ hasText: /^Tomorrow$/ }).click()
  await click('[data-ask-save]')
  await page.locator('[data-process-end]').waitFor()
  assert.match(await page.locator('[data-process-summary]').innerText(), /Defer 1.*1 left for later/)
  await until(async () => (await propsOf(b.id)).status?.value[0] === 'scheduled', 'Defer placed task')
  await click('[data-process-review-skipped]')
  assert.match(await page.locator('[data-process-heading]').innerText(), /Triage incoming/)

  step('notes and reading position survive Pause, reload and details return')
  await click('[data-process-notes-toggle]')
  await page.locator('[data-process-text]').waitFor()
  await page.locator('[data-process-card]').evaluate((el) => el.scrollTop = 150)
  await click('[data-process-close]')
  assert.equal(await page.locator('#app').evaluate((el) => el.inert), false)
  await page.reload()
  await until(async () => /Resume\s+1 of 1/.test(await page.locator('[data-workflows]').innerText()), 'the phone button offers the paused session')
  await click('[data-workflows]')
  await click('[data-workflow-paused] [data-process-resume]')
  await until(async () => (await page.locator('[data-process-card]').evaluate((el) => el.scrollTop)) >= 149, 'restored scroll after reload')
  assert.equal(await page.locator('[data-process-notes-toggle]').getAttribute('aria-expanded'), 'true')
  await click('[data-process-open]')
  await page.waitForURL(`**/o/${a.id}`)
  await page.goBack()
  await page.locator('[data-process-mode]').waitFor()
  assert.equal(await currentTitle(), a.title)
  await until(async () => (await page.locator('[data-process-card]').evaluate((el) => el.scrollTop)) > 100, 'scroll after details return')
  await click('[data-process-close]')
  await click('[data-workflows]')
  await click('[data-process-end-session]')
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await until(async () => (await page.locator('[data-workflow-paused]').count()) === 0, 'end cleared only session')
  assert.equal((await propsOf(a.id)).nextstep.value, 'Call the owner')

  step('review excludes incoming and recent decisions; Keep as is preserves the plan')
  await click('[data-start-review]')
  await until(async () => (await currentTitle()) === c.title, 'first commitment')
  assert.match(await position.innerText(), /1 of 2/)
  await page.screenshot({ path: path.join(tmpdir(), `vasta-workflow-${engine}-review.png`) })
  await click('[data-process-reviewed]')
  await until(async () => (await currentTitle()) === d.title, 'next commitment')
  await until(async () => (await propsOf(c.id)).reviewed?.value.start.slice(0, 10) === today, 'review date saved')
  assert.equal((await propsOf(c.id)).status.value[0], 'next')
  await click('[data-process-skip]')
  await page.locator('[data-process-end]').waitFor()
  assert.match(await page.locator('[data-process-summary]').innerText(), /Reviewed 1.*1 left for later/)
  await click('[data-process-finish]')

  step('targeted review stays in More, with exact view scope and review-all')
  await page.locator('main header button[title="More"]').click()
  await click('[data-review-view]')
  assert.match(await page.locator('[data-workflow-chooser]').innerText(), /On hold — due for review/)
  assert.match(await page.locator('[data-process]').innerText(), /Review 1 task/)
  await click('[data-process]')
  await until(async () => (await currentTitle()) === d.title, 'targeted queue matches view')
  await click('[data-process-more]')
  await menu('Next step…')
  await page.locator('#quick-ask-text').fill('Revisit the plan')
  await click('[data-ask-save]')
  await until(async () => (await propsOf(d.id)).nextstep?.value === 'Revisit the plan', 'review edit saved')
  assert.match(await position.innerText(), /1 of 1/)
  await click('[data-process-reviewed]')
  await page.locator('[data-process-end]').waitFor()
  await click('[data-process-finish]')

  step('no incoming work is hidden by a recent targeted review; desktop header buttons')
  await page.setViewportSize({ width: 1280, height: 800 })
  // Triage waits: tinted with its count. Review is empty: grey, no count, and opens the chooser.
  const triageButton = page.locator('[data-workflow-triage]')
  const reviewButton = page.locator('[data-workflow-review]')
  await until(async () => /^Triage\s+1$/.test((await triageButton.innerText()).trim()), 'Triage shows its count')
  assert.equal((await reviewButton.innerText()).trim(), 'Review')
  assert.match(await triageButton.getAttribute('class'), /bg-accent\/12/)
  assert.match(await reviewButton.getAttribute('class'), /bg-hover/)
  await reviewButton.click()
  assert.match(await page.locator('[data-start-triage]').innerText(), /1$/)
  assert.match(await page.locator('[data-start-review]').innerText(), /0$/)
  assert(await page.locator('[data-start-review]').isDisabled())
  await page.keyboard.press('Escape')
  await page.locator('[data-workflow-chooser]').waitFor({ state: 'detached' })
  // A press on a waiting queue starts it at once.
  await triageButton.click()
  await until(async () => (await currentTitle()) === a.title, 'Triage starts from the header')
  await click('[data-process-close]')
  await until(async () => /Resume triage\s+1 of 1/.test(await triageButton.innerText()), 'the paused session is on its button')
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
