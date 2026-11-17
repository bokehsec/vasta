// Task review follows the current view/search/Mine, with an explicit whole-space sweep.
// node review-scope.mjs [chromium|webkit] [base]   MODE=json: HTTP; default: replica
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
assert(/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base), 'Use an isolated test environment')
const options = { viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto', hasTouch: true }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit'
  ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-review-scope-')), options)
  : await browser.newContext(options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
async function request(method, route, data) {
  const response = await page.request[method](`${base}${route}`, { headers, data })
  assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`)
  return response.status() === 204 ? undefined : response.json()
}
const until = async (check, name) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${name}`)
}
const clean = (text) => text.replace(/\s+/g, ' ').trim()
const click = (s) => page.locator(s).click()
const title = () => page.locator('[data-process-title]').innerText()
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('vasta.review')))
const more = () => page.locator('main header button[title="More"]').click()
async function pickView(name) {
  if (await page.locator('[data-view-picker]').count()) {
    await click('[data-view-picker]')
    await page.locator('[data-view-option]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
  } else await page.locator('main [role=button]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
}
let space
try {
  await request('post', '/api/auth/login', { username: 'tester', password: 'test-password' })
  const me = await request('get', '/api/auth/me')
  space = await request('post', '/api/spaces', { name: `Review scope ${engine} ${Date.now()}` })
  const members = await request('post', `/api/spaces/${space.id}/members`, { username: 'anatest', role: 'editor' })
  const ana = members.find((m) => m.username === 'anatest')
  let type = (await request('get', `/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
  const filter = (area) => ({ kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'area', operator: 'is', value: { kind: 'literal', value: [area] } }] })
  type = await request('put', `/api/types/${type.id}`, {
    ...type,
    properties: type.properties.map((p) => p.id === 'status' ? { ...p, options: [
      { id: 'inbox', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' },
      { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' },
    ] } : p).concat([{ id: 'area', name: 'Area', kind: 'select', options: [{ id: 'work', label: 'Work' }, { id: 'personal', label: 'Personal' }] }]),
    quickActions: { reviewEvery: 7, triageStatuses: ['inbox'] },
    views: [
      { id: 'work', name: 'Work', layout: 'list', filter: filter('work'), sort: [{ field: 'title', direction: 'desc' }] },
      { id: 'personal', name: 'Personal', layout: 'list', filter: filter('personal') },
      { id: 'table', name: 'Table', layout: 'table', filter: filter('work') },
      { id: 'board', name: 'Board', layout: 'kanban', filter: filter('work') },
      { id: 'agenda', name: 'Agenda', layout: 'agenda', filter: filter('work') },
    ],
  })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
  const make = (title, area, status, mine = true, reviewed) => request('post', '/api/objects', {
    typeId: type.id, title,
    props: {
      area: { kind: 'select', value: [area] }, assignee: { kind: 'person', value: [mine ? me.id : ana.userId] },
      ...(status ? { status: { kind: 'select', value: [status] } } : {}),
      ...(reviewed ? { reviewed: { kind: 'date', value: { start: `${reviewed}T00:00:00.000Z`, resolution: 'day' } } } : {}),
    },
  })
  const incoming = await make('Confirm launch checklist', 'work', 'inbox', true, today)
  const commitment = await make('Review onboarding copy', 'work', 'next')
  const recent = await make('Send the weekly update', 'work', 'next', true, today)
  const closed = await make('Finished work', 'work', 'done')
  const other = await make('Check design handoff', 'work', 'inbox', false)
  const outside = await make('Book a dentist appointment', 'personal', undefined, true, today)
  await page.goto(base, { waitUntil: 'networkidle' })
  // The last view and Mine are the account's, the last space this device's.
  await page.request.put(`${base}/api/auth/me`, { headers: { 'x-requested-with': 'vasta' }, data: { preferences: { [`type/${type.id}/last-view`]: 'work', [`type/${type.id}/mine`]: true } } })
  await page.evaluate((spaceId) => {
    localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(spaceId))
    localStorage.removeItem('vasta.review')
  }, space.id)
  await page.reload({ waitUntil: 'networkidle' })
  await until(async () => {
    await page.goto(`${base}/t/${type.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the replica has the task type')
  const reviewButton = page.locator('[data-review-tasks]')
  const scopeTitle = () => reviewButton.getAttribute('title')
  const count = async (n) => until(async () => clean(await reviewButton.innerText()) === `Review ${n}`, `Review ${n}`)
  await count(2)
  assert.equal(await scopeTitle(), 'Work · Mine', 'the button names its view scope')

  console.log('Review snapshots this view: incoming first, even if reviewed today; recently reviewed and closed stay out')
  await reviewButton.click()
  assert.equal(await title(), incoming.title, 'incoming precedes a check-in sorted ahead of it in the view')
  assert.equal((await saved()).kind, 'tasks')
  assert.equal((await saved()).scope, 'view')
  assert.equal((await saved()).newCount, 1)
  assert.deepEqual((await saved()).ids, [incoming.id, commitment.id])
  assert.equal(await page.locator('[data-process-reviewed]').count(), 0, 'incoming has no Keep')
  // A member/space refresh may replace the current space object without changing its id.
  // It must not pause a review in progress (including when another tab changes another space).
  const extra = await request('post', '/api/spaces', { name: 'Unrelated review-scope check' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    assert.equal(await page.locator('[data-process-mode]').count(), 1, 'background space refresh keeps the review open')
    assert.equal(await title(), incoming.title)
  } finally {
    await request('delete', `/api/spaces/${extra.id}`, { name: extra.name })
  }
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(await page.locator('[data-process-mode]').count(), 1, 'deleting an unrelated space keeps the review open')
  await click('[data-process-choice="next"]')
  await until(async () => await title() === commitment.title, 'placing incoming advances within the frozen queue')
  assert.deepEqual((await saved()).ids, [incoming.id, commitment.id])
  await page.locator('[role=status]').getByRole('button', { name: 'Undo', exact: true }).click()
  await until(async () => (await request('get', `/api/objects/${incoming.id}`)).props.status.value[0] === 'inbox', 'Undo restores incoming')
  assert.equal(await title(), commitment.title)
  await click('[data-process-close]')
  await pickView('Personal')
  assert.equal(await scopeTitle(), 'Resume Work · Mine', 'the paused session keeps its original scope name')
  await page.reload()
  await until(async () => /Resume/.test(await reviewButton.innerText()), 'paused session after reload')
  await reviewButton.click()
  assert.equal(await title(), commitment.title, 'switching views and reload preserve the old queue and position')
  assert.equal((await saved()).scopeLabel, 'Work · Mine')
  await click('[data-process-close]')
  await more()
  await click('[data-review-view]')
  await click('[data-start-review]')
  await page.getByRole('button', { name: 'Start new session', exact: true }).click()
  await until(async () => await title() === outside.title, 'a new review uses Personal')
  assert.deepEqual((await saved()).ids, [outside.id])
  await click('[data-process-skip]')
  await click('[data-process-finish]')
  await pickView('Work')
  await count(2)

  console.log('Search changes the scope and count; a zero-result view still offers the full sweep')
  const search = page.locator('input[placeholder="Filter…"]')
  await search.fill('onboarding')
  await count(1)
  assert.match(await scopeTitle(), /Search: “onboarding”/)
  await reviewButton.click()
  assert.deepEqual((await saved()).ids, [commitment.id])
  await click('[data-process-skip]')
  await click('[data-process-finish]')
  await search.fill('no matching task')
  await until(async () => clean(await reviewButton.innerText()) === 'Review', 'empty current view')
  assert.match(await scopeTitle(), /Work · Mine/)
  await reviewButton.click()
  assert(await page.locator('[data-start-review]').isDisabled())
  assert.match(await page.locator('[data-review-none]').innerText(), /Work · Mine/)
  assert.match(await page.locator('[data-start-space]').innerText(), /4$/)
  await page.keyboard.press('Escape')
  await more()
  assert.match(await page.locator('[data-review-all]').innerText(), /4$/)
  await click('[data-review-all]')
  const full = await saved()
  assert.equal(full.scope, 'space')
  assert.equal(full.scopeLabel, `All tasks in ${space.name}`)
  assert.deepEqual(new Set(full.ids), new Set([incoming.id, commitment.id, other.id, outside.id]))
  assert(!full.ids.includes(recent.id) && !full.ids.includes(closed.id))
  for (let i = 0; i < 4; i++) await click('[data-process-skip]')
  await click('[data-process-finish]')
  await search.fill('')
  await count(2)

  console.log('Phone scope, visible Mine chip, review options and touch targets fit 320–430px')
  if (process.env.SHOTS) { mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `review-scope-${engine}-desktop.png`) }) }
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.locator('[data-review-mine]').waitFor()
    assert.match(await scopeTitle(), /Work · Mine/)
    assert.equal(await page.locator('#app').evaluate((el) => el.scrollWidth > innerWidth), false, `page overflow at ${width}`)
    for (const selector of ['[data-review-tasks]', '[data-review-mine]']) assert((await page.locator(selector).boundingBox()).height >= 44)
    await more()
    assert((await page.locator('[data-review-all]').boundingBox()).height >= 44)
    assert.equal(await page.locator('[data-review-all]').evaluate((el) => el.scrollWidth > el.clientWidth), false)
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await click('[data-review-mine]')
  await count(3)
  assert.equal(await page.locator('[data-review-mine]').count(), 0)
  await click('[data-filters-button]')
  await click('[data-filters-mine]')
  await click('[data-filters-done]')
  await count(2)
  await reviewButton.click()
  assert.equal(await page.locator('[data-process-scope]').innerText(), 'Work · Mine')
  await click('[data-process-skip]')
  await click('[data-process-skip]')
  await click('[data-process-finish]')
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(process.env.SHOTS, `review-scope-${engine}-phone.png`) })
    await more()
    await page.screenshot({ path: path.join(process.env.SHOTS, `review-scope-${engine}-phone-menu.png`) })
    await page.keyboard.press('Escape')
  }

  console.log('Lists, tables and boards share scope; explicitly labelled full sweeps on Metrics and Agenda')
  for (const name of ['Table', 'Board']) {
    await pickView(name)
    await count(2)
    await reviewButton.click()
    assert.deepEqual(new Set((await saved()).ids), new Set([incoming.id, commitment.id]))
    await click('[data-process-skip]')
    await click('[data-process-skip]')
    await click('[data-process-finish]')
  }
  for (const name of ['Metrics', 'Agenda']) {
    await pickView(name)
    await until(async () => clean(await reviewButton.innerText()) === 'Review all 4', `explicit full sweep on ${name}`)
    assert.match(await scopeTitle(), /All tasks in/)
  }
  assert.deepEqual(errors, [])
  console.log(`Review scope checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} catch (e) {
  await page.screenshot({ path: path.join(tmpdir(), `vasta-review-scope-${engine}-failure.png`) }).catch(() => {})
  throw e
} finally {
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}`, { headers, data: { name: space.name } }).catch(() => {})
  await context.close()
  await browser?.close()
}
