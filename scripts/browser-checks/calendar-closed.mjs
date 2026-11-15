// Closed tasks on the Calendar page: Done and Dropped tasks are left out by default (month, week
// and day views), "Done and dropped tasks" in the Show menu brings them back, struck; the choice
// survives a reload and is no count in "N hidden". A task ticked on the calendar stays where it
// was, checked and struck, its checkbox undoing the tick, until the calendar is looked at afresh
// (another range, a reload); an open task is never affected.
//   node calendar-closed.mjs [chromium|webkit] [base]
// WebKit's OPFS replica in the test env can fail to open (SQLITE_CORRUPT, a known flake).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'UTC' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-calendar-closed-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|SQLITE_CORRUPT/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 12000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      const shot = path.join(tmpdir(), `vasta-calendar-closed-${engine}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      console.log('screenshot:', shot)
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const del = (id) => page.request.delete(`${base}/api/objects/${id}`, { headers }).catch(() => {})

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const status = (await get(`/api/types/${taskType.id}`)).properties.find((p) => p.id === 'status')
const closedIds = status.options.filter((o) => o.status === 'done').map((o) => o.id)
const doingId = status.options.find((o) => o.status === 'doing')?.id ?? status.options.find((o) => o.status === 'todo').id
if (!closedIds.length) throw new Error('the task type has no closed status')

// A month of its own, far from the test data.
const tag = `${engine}-${Date.now() % 100000}`
const dayOf = (n) => `2027-03-${String(n).padStart(2, '0')}`
const made = []
const task = async (name, day, statusId) => {
  const created = await post('/api/objects', { typeId: taskType.id, title: `CalClosed ${name} ${tag}`, props: { status: { kind: 'select', value: [statusId] }, due: { kind: 'date', value: { start: `${dayOf(day)}T00:00:00.000Z`, resolution: 'day' } } } })
  made.push(created)
  return created
}
const entry = (title, day) => page.locator(`[data-day="${dayOf(day)}"] [data-calendar-entry]`, { hasText: `${title} ${tag}` })
// The week's all-day chips sit above the day columns, outside their data-day.
const anywhere = (title) => page.locator('[data-calendar-entry]', { hasText: `${title} ${tag}` })
const shown = async (title, day) => (await entry(title, day).count()) > 0
const struck = async (title, day) => (await entry(title, day).first().locator('.line-through').count()) === 1
const apiStatus = async (object) => (await get(`/api/objects/${object.id}`)).props.status?.value?.[0]
const stored = () => page.evaluate(() => localStorage.getItem('vasta.calendar.showClosed'))
const openMenu = async () => {
  await page.getByRole('button', { name: /Show/ }).click()
  return page.getByLabel('Done and dropped tasks')
}
const miniTitle = (day) => page.locator('aside button[title]', { hasText: new RegExp(`^${day}$`) }).first().getAttribute('title')
const closeMenu = () => page.keyboard.press('Escape')
const month = (view = 'month', day = 10) => `${base}/calendar?view=${view}&date=${dayOf(day)}`

try {
  const open = await task('Open', 10, doingId)
  const done = await task('Done', 11, closedIds[0])
  const dropped = closedIds[1] ? await task('Dropped', 12, closedIds[1]) : undefined
  const ticked = await task('Ticked', 15, doingId)
  await sleep(1500) // the replica pulls them
  await page.evaluate(() => localStorage.removeItem('vasta.calendar.showClosed'))

  step('month: closed tasks are left out by default, open ones shown')
  await page.goto(month())
  await until(() => shown('CalClosed Open', 10), 'the open task in the month', 20000)
  if (await shown('CalClosed Done', 11)) throw new Error('a done task is shown')
  if (dropped && (await shown('CalClosed Dropped', 12))) throw new Error('a dropped task is shown')
  if (await page.getByText(/\d+ hidden/).count()) throw new Error('the Show button counts something hidden')

  step('Show › Done and dropped tasks brings them back, struck; no "hidden" count; remembered')
  const box = await openMenu()
  if (await box.isChecked()) throw new Error('the choice is on by default')
  await box.check()
  await until(() => shown('CalClosed Done', 11), 'the done task')
  if (!(await struck('CalClosed Done', 11))) throw new Error('the done task is not struck')
  if (dropped) await until(() => shown('CalClosed Dropped', 12), 'the dropped task')
  if ((await stored()) !== '1') throw new Error(`stored ${await stored()}`)
  if (await page.getByText(/\d+ hidden/).count()) throw new Error('the choice counts as hidden')
  await closeMenu()

  step('it survives a reload')
  await page.reload()
  await until(() => shown('CalClosed Done', 11), 'the done task after a reload', 20000)
  if (!(await (await openMenu()).isChecked())) throw new Error('the box is not checked after a reload')
  await closeMenu()

  step('week and day views follow it; off again hides them there too')
  await page.goto(month('week'))
  await until(async () => (await anywhere('CalClosed Done').count()) === 1, 'the done task in the week')
  await until(async () => /task/.test((await miniTitle(11)) ?? ''), 'the small month marking the done task')
  await (await openMenu()).uncheck()
  await until(async () => (await anywhere('CalClosed Done').count()) === 0, 'the done task gone from the week')
  if ((await anywhere('CalClosed Open').count()) !== 1) throw new Error('the open task went with it')
  await until(async () => !/task/.test((await miniTitle(11)) ?? 'x'), 'the small month not marking the done task')
  if (!/task/.test((await miniTitle(10)) ?? '')) throw new Error('the small month lost the open task')
  await closeMenu()
  await page.goto(month('day', 11))
  await sleep(1500)
  if (await page.getByText(`CalClosed Done ${tag}`).count()) throw new Error('a done task on the day page')
  await page.goto(month('day', 10))
  await until(async () => (await page.getByText(`CalClosed Open ${tag}`).count()) > 0, 'the open task on the day page')
  if ((await stored()) !== '0') throw new Error(`stored ${await stored()}`)

  step('ticking a task: it stays checked and struck, its checkbox undoes it; another range drops it')
  await page.goto(month())
  await until(() => shown('CalClosed Ticked', 15), 'the task to tick')
  await entry('CalClosed Ticked', 15).locator('button[title="Mark as done"]').click()
  await until(async () => closedIds.includes(await apiStatus(ticked)), 'Done saved')
  await until(() => struck('CalClosed Ticked', 15), 'the ticked task struck')
  await sleep(1800) // past the background reload
  if (!(await shown('CalClosed Ticked', 15)) || !(await struck('CalClosed Ticked', 15))) throw new Error('the ticked task did not stay')
  await entry('CalClosed Ticked', 15).locator('button[title="Mark as to do"]').click()
  await until(async () => (await apiStatus(ticked)) === doingId, 'Undo saved')
  await until(async () => !(await struck('CalClosed Ticked', 15)), 'the task open again')
  await entry('CalClosed Ticked', 15).locator('button[title="Mark as done"]').click()
  await until(() => struck('CalClosed Ticked', 15), 'the ticked task struck again')
  await page.locator('button[title="Next (→)"]').click()
  await until(() => page.getByRole('heading', { name: /April 2027/ }).count(), 'April')
  await page.locator('button[title="Previous (←)"]').click()
  await until(() => shown('CalClosed Open', 10), 'March again')
  if (await shown('CalClosed Ticked', 15)) throw new Error('the ticked task came back after a fresh look')

  step('a reload also drops it')
  await entry('CalClosed Open', 10).locator('button[title="Mark as done"]').click()
  await until(() => struck('CalClosed Open', 10), 'the second task struck')
  await page.reload()
  await until(() => shown('CalClosed Open', 10).then((s) => !s), 'the task gone after a reload', 20000)

  if (problems.length) throw new Error(`problems:\n${problems.join('\n')}`)
  console.log('✓ calendar closed tasks check passed')
} finally {
  for (const object of made) await del(object.id)
  await page.evaluate(() => localStorage.removeItem('vasta.calendar.showClosed')).catch(() => {})
  await browser.close()
}
