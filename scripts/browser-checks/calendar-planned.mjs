// Calendar task plans/deadlines, completion feedback, safe repeats and explicit linked dates; a plan and
// deadline of one day are one chip with both badges, the after-deadline mark, dragging moves the plan.
// Isolated seeded apps only: node calendar-planned.mjs [chromium|webkit] [base]; MODE=json.
import { chromium, webkit } from 'playwright'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const engine = process.argv[2] ?? 'chromium', base = process.argv[3] ?? 'http://127.0.0.1:5383'
if (!/^http:\/\/127\.0\.0\.1:5[123]8[34]$/.test(base)) throw new Error('test app only')
const options = { viewport: { width: 1400, height: 1100 }, timezoneId: 'America/Toronto', locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-calendar-plan-webkit-')), options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
await context.addInitScript(() => { localStorage.setItem('vasta.calendar.panel', '0'); localStorage.removeItem('vasta.calendar.showClosed'); localStorage.removeItem('vasta.calendar.hidden') })
const page = context.pages()[0] ?? await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
async function request(method, url, data) {
  const r = await page.request[method](base + url, { headers, ...(data ? { data } : {}) })
  if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`)
  return r.status() === 204 ? undefined : r.json()
}
const get = url => request('get', url), put = (url, data) => request('put', url, data), post = (url, data) => request('post', url, data)
async function until(fn, label, timeout = 15000) {
  const start = Date.now()
  for (;;) { if (await fn()) return; if (Date.now() - start > timeout) throw new Error('timed out: ' + label); await page.waitForTimeout(150) }
}
const shots = fileURLToPath(new URL('../../handoffs/calendar-mockups/implemented/', import.meta.url))
mkdirSync(shots, { recursive: true })
const day = n => `2027-03-${n}`, dateValue = n => ({ kind: 'date', value: { start: day(n) + 'T00:00:00.000Z', resolution: 'day' } })
const tag = `CalPlan-${engine}-${Date.now()}`, objects = []
let original
const entry = name => page.locator('[data-calendar-entry]', { hasText: tag + ' ' + name })
const section = id => page.locator(`[data-task-section="${id}"]`)
const go = async (n = 15) => { await page.goto(`${base}/calendar?view=day&date=${day(n)}`); await until(async () => (await entry(n === 15 ? 'Planned' : 'Deadline').count()) > 0, 'calendar entries') }
const stored = async o => (await get('/api/objects/' + o.id)).props
try {
  await page.goto(base)
  await page.fill('#login-username', 'tester'); await page.fill('#login-password', 'test-password'); await page.click('button[type=submit]'); await page.waitForSelector('nav')
  const space = (await get('/api/spaces'))[0], bundle = await get(`/api/spaces/${space.id}`)
  original = await get('/api/types/' + bundle.types.find(t => t.system === 'task').id)
  const status = original.properties.find(p => p.id === 'status'), open = status.options.find(o => o.status === 'todo').id, done = status.options.find(o => o.status === 'done').id
  // The plan is the date with the plan role (here "work", in place of the built-in Do date); Check back is a plain date.
  const type = { ...original, properties: [...original.properties.filter(p => p.id !== 'work' && p.id !== 'checkback' && p.role !== 'plan'), { id: 'work', name: 'Do date', kind: 'date', role: 'plan' }, { id: 'checkback', name: 'Check back', kind: 'date' }].map(p => p.id === 'status' ? { ...p, options: [...p.options.filter(o => o.id !== 'drop'), { id: 'drop', label: 'Dropped', status: 'done' }] } : p), quickActions: undefined }
  await put('/api/types/' + type.id, type)
  async function make(name, props) { const o = await post('/api/objects', { typeId: type.id, title: tag + ' ' + name, props: { status: { kind: 'select', value: [open] }, ...props } }); objects.push(o); return o }
  const planned = await make('Planned', { work: dateValue(15), due: dateValue(22) })
  const planOnly = await make('PlanOnly', { work: dateValue(15) }), same = await make('SameDay', { work: dateValue(15), due: dateValue(15) })
  await make('Deadline', { work: dateValue(22), due: dateValue(15) })
  await make('Done', { work: dateValue(15), status: { kind: 'select', value: [done] } })
  await make('Dropped', { work: dateValue(15), status: { kind: 'select', value: ['drop'] } })
  await make('Checkback', { checkback: dateValue(15) })
  await make('Reviewed', { reviewed: dateValue(15) })
  const repeat = await make('Repeat', { work: dateValue(15), due: { ...dateValue(15), value: { ...dateValue(15).value, rrule: 'FREQ=WEEKLY;COUNT=3' } } })
  await go()
  console.log('• groups, open controls, matching-slot deduplication and non-work dates')
  assert.equal(await section('planned').locator('[data-calendar-entry]').count(), 4)
  assert.equal(await section('due').locator('[data-calendar-entry]').count(), 1)
  assert.equal(await entry('SameDay').count(), 1)
  assert.equal(await entry('Done').count(), 0); assert.equal(await entry('Dropped').count(), 0)
  assert.equal(await page.getByRole('button', { name: /Reschedule/ }).count(), 0)
  assert.match(await entry('Planned').innerText(), /Due by.*22/)
  assert.equal(await entry('Planned').locator('button[title="Mark as done"]').count(), 1)
  assert.equal(await entry('PlanOnly').locator('button[title="Mark as done"]').count(), 1)
  assert.match(await section('due').innerText(), /Planned after deadline/)
  assert.equal(await entry('Checkback').locator('button[title="Mark as done"]').count(), 0)
  assert.match(await entry('Checkback').innerText(), /Check back/)
  // The Last reviewed day (set by every status change) is bookkeeping, not a calendar entry.
  assert.equal(await entry('Reviewed').count(), 0)
  await page.screenshot({ path: path.join(shots, `calendar-planned-${engine}-desktop.png`), fullPage: true })
  console.log('• plan-only completion is retained, then undone in place')
  await entry('PlanOnly').locator('button[title="Mark as done"]').click()
  await until(async () => (await stored(planOnly)).status.value[0] === done, 'plan-only saved Done')
  await until(async () => (await section('completed').getByText(tag + ' PlanOnly').count()) === 1, 'Completed section')
  await page.waitForTimeout(700)
  await entry('PlanOnly').locator('button[title="Mark as to do"]').click()
  await until(async () => (await stored(planOnly)).status.value[0] === open, 'reopened plan')
  await until(async () => (await section('planned').getByText(tag + ' PlanOnly').count()) === 1, 'plan restored')
  console.log('• repeating combined slot completes only current occurrence and undoes it')
  await entry('Repeat').locator('button[title="Mark as done"]').click()
  await until(async () => (await stored(repeat)).due.value.start.startsWith(day(22)), 'repeat advanced')
  await until(async () => (await section('completed').getByText(tag + ' Repeat').count()) === 1, 'repeat completion retained')
  await entry('Repeat').locator('button[title="Mark as to do"]').click()
  await until(async () => (await stored(repeat)).due.value.start.startsWith(day(15)), 'repeat undone')
  console.log('• closed tasks and Tasks filter')
  await page.getByRole('button', { name: /^Show(?:\s+\d+\s+hidden)?$/ }).click(); await page.getByLabel('Done and dropped tasks').check(); await page.keyboard.press('Escape')
  await until(async () => (await section('completed').getByText(tag + ' Done', { exact: true }).count()) === 1, 'closed Done')
  assert.equal(await section('dropped').getByText(tag + ' Dropped', { exact: true }).count(), 1)
  await page.getByRole('button', { name: /^Show(?:\s+\d+\s+hidden)?$/ }).click(); await page.getByLabel('Tasks', { exact: true }).uncheck(); await page.keyboard.press('Escape')
  await until(async () => await entry('Planned').count() === 0, 'plan hidden with Tasks')
  assert.equal(await entry('Deadline').count(), 0)
  await page.getByRole('button', { name: /^Show(?:\s+\d+\s+hidden)?$/ }).click(); await page.getByLabel('Tasks', { exact: true }).check(); await page.keyboard.press('Escape')
  console.log('• changing deadline keeps plan; a deadline before the plan offers "Also plan for", which is explicit')
  await page.goto(`${base}/o/${same.id}`); await page.waitForSelector('textarea[data-large-text]')
  const dueRow = page.locator('.vasta-prop-row', { has: page.locator('.vasta-prop-name', { hasText: /^\s*Due\s*$/ }) })
  await dueRow.getByRole('button').first().click()
  const input = page.locator('[data-overlay] input[type=date]').first()
  await input.fill(day(22)); await input.dispatchEvent('change')
  await until(async () => (await stored(same)).due.value.start.startsWith(day(22)), 'deadline changed')
  assert.ok((await stored(same)).work.value.start.startsWith(day(15)))
  // A deadline after the plan has nothing to pull in.
  assert.equal(await page.locator('[data-move-related-date]').count(), 0)
  await input.fill(day(10)); await input.dispatchEvent('change')
  await until(async () => (await stored(same)).due.value.start.startsWith(day(10)), 'deadline moved before the plan')
  assert.ok((await stored(same)).work.value.start.startsWith(day(15)))
  assert.match(await page.locator('[data-move-related-date]').innerText(), /Also plan for.*10/)
  await page.locator('[data-move-related-date]').click()
  await until(async () => (await stored(same)).work.value.start.startsWith(day(10)), 'explicit plan move')
  await page.keyboard.press('Escape'); await go()
  assert.equal(await entry('SameDay').count(), 0)
  assert.equal((await stored(same)).status.value[0], open)
  await go(22)
  assert.equal(await entry('SameDay').count(), 0)
  assert.equal(await entry('Repeat').locator('button[title="Mark as done"]').count(), 0)
  console.log('• month: one chip per task per day with both badges, the after-deadline mark, a drag moves the plan and a deadline asks first')
  const monthSame = await make('MonthSame', { work: dateValue(16), due: dateValue(16) })
  await make('MonthLate', { work: dateValue(20), due: dateValue(17) })
  const monthDrag = await make('MonthDrag', { work: dateValue(18), due: dateValue(25) })
  await page.goto(`${base}/calendar?view=month&date=2027-03-01`)
  const chips = name => page.locator('[data-day] [data-calendar-entry]', { hasText: tag + ' ' + name })
  await until(async () => (await chips('MonthSame').count()) === 1, 'one chip for a plan and deadline of the same day')
  const sameText = await chips('MonthSame').innerText()
  assert.match(sameText, /Planned/); assert.match(sameText, /Due/)
  assert.equal(await chips('MonthLate').count(), 2)
  assert.equal(await chips('MonthLate').locator('[data-after-deadline]').count(), 2)
  assert.equal(await chips('MonthDrag').locator('[data-after-deadline]').count(), 0)
  const drag = async (from, to) => {
    const a = await from.boundingBox(), b = await page.locator(`[data-day="${day(to)}"]`).first().boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 8, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 8)
    await page.mouse.up()
  }
  const plannedChip = () => chips('MonthDrag').filter({ hasText: 'Planned' })
  const dueChip = () => chips('MonthDrag').filter({ hasText: 'Due' })
  await drag(plannedChip(), 19)
  await until(async () => (await stored(monthDrag)).work.value.start.startsWith(day(19)), 'the plan moved')
  assert.ok((await stored(monthDrag)).due.value.start.startsWith(day(25)))
  await page.locator('[role=status]', { hasText: /Planned for / }).waitFor()
  await drag(dueChip(), 26)
  await page.getByText('Move the deadline?').waitFor()
  await page.locator('form', { hasText: 'Move the deadline?' }).locator('button', { hasText: /^\s*Move deadline\s*$/ }).click()
  await until(async () => (await stored(monthDrag)).due.value.start.startsWith(day(26)), 'the deadline moved after asking')
  assert.ok((await stored(monthDrag)).work.value.start.startsWith(day(19)))
  await page.locator('[role=status]', { hasText: /Deadline moved to / }).locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await stored(monthDrag)).due.value.start.startsWith(day(25)), 'Undo put the deadline back')
  assert.equal(monthSame.id.length > 0, true)
  console.log('• phone layout, no row action clutter, completion and Undo')
  await page.setViewportSize({ width: 390, height: 844 }); await go(); await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: path.join(shots, `calendar-planned-${engine}-phone-dark.png`), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await entry('PlanOnly').locator('button[title="Mark as done"]').click()
  await until(async () => (await stored(planOnly)).status.value[0] === done, 'phone completion')
  await entry('PlanOnly').locator('button[title="Mark as to do"]').click()
  await until(async () => (await stored(planOnly)).status.value[0] === open, 'phone Undo')
  assert.deepEqual(errors, [])
  console.log(`✓ calendar planned/deadline check passed (${engine}${process.env.MODE === 'json' ? ', HTTP' : ''})`)
} catch (e) {
  await page.screenshot({ path: path.join(shots, `calendar-planned-${engine}-failure.png`), fullPage: true }).catch(() => {})
  throw e
} finally {
  for (const o of objects) await page.request.delete(`${base}/api/objects/${o.id}`, { headers }).catch(() => {})
  if (original) await put('/api/types/' + original.id, original).catch(() => {})
  await (launched ?? context).close()
}
