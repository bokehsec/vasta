// Overdue in the test env (America/Toronto): the tasks that are late (a missed deadline, an unfinished
// plan, a repeating task at its current occurrence; not closed ones, not a deadline still ahead) are
// listed first on Today (the Day view of today) and on an agenda, each saying what is late ("Due Tue",
// "Planned Mon") with a one-tap "Move to today" that plans it for today, keeps the deadline and says so
// with Undo; another day has no Overdue; a task ticked there stays checked and struck; on a phone
// the button is 44px, nothing scrolls sideways and a long title keeps the row's width (SHOTS=<dir>).
//   node overdue.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:5[123]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
// WebKit has OPFS (the replica) only in a persistent profile.
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-overdue-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|Working without a local replica: Error: SQLITE_CORRUPT/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      await page.screenshot({ path: path.join(tmpdir(), `vasta-overdue-${engine}.png`) })
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const status = taskType.properties.find((p) => p.id === 'status')
const doneOption = status.options.find((o) => o.status === 'done').id

// Days as this browser sees them (the page's own clock and zone).
const dayAt = (offset) => page.evaluate((n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}, offset)
const today = await dayAt(0), tomorrow = await dayAt(1)
const value = (day, extra = {}) => ({ kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day', ...extra } })
const tag = `Overdue-${engine}-${Date.now() % 100000}`
const objects = []
const make = async (name, props) => {
  const o = await post('/api/objects', { typeId: taskType.id, title: `${tag} ${name}`, props })
  objects.push(o)
  return o
}
const stored = async (o) => (await get(`/api/objects/${o.id}`)).props
const missed = await make('Missed', { due: value(await dayAt(-3)) })
const unfinished = await make('Unfinished', { dodate: value(await dayAt(-1)), due: value(await dayAt(10)) })
await make('Ahead', { due: value(tomorrow) })
await make('Closed', { due: value(await dayAt(-5)), status: { kind: 'select', value: [doneOption] } })
// Late on both dates, with a long title: on a phone the title keeps the row's width, the badges go under it.
await make('Both late home insurance renewal paperwork and quotes', { dodate: value(await dayAt(-4)), due: value(await dayAt(-2)) })
const weekly = await make('Weekly', { due: value(await dayAt(-14), { rrule: 'FREQ=WEEKLY;COUNT=6' }) })
const query = await post('/api/objects', {
  typeId: bundle.types.find((t) => t.system === 'query').id,
  title: `Agenda ${tag}`,
  query: { typeIds: [taskType.id], layout: 'agenda', agenda: { days: 3 }, filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: tag } }] } },
})
const host = await post('/api/objects', {
  typeId: bundle.types.find((t) => t.system === 'page').id,
  title: `Home ${tag}`,
  content: { body: { type: 'doc', content: [{ type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }, { type: 'paragraph' }] } },
})
await sleep(1500) // the replica pulls them

const overdue = page.locator('[data-overdue]')
const row = (name) => overdue.locator('[data-overdue-row]', { hasText: `${tag} ${name}` })
const move = (name) => row(name).getByRole('button', { name: 'Move to today' })
const noticeWith = (text) => page.locator('[role=status]', { hasText: text })
const undo = () => page.locator('[role=status]').getByRole('button', { name: 'Undo' }).click()
const dateOnly = (v) => v?.value?.start.slice(0, 10)

/** What the Overdue section holds, for one surface: the late tasks, none of the others. */
async function lists(what) {
  await until(async () => (await row('Missed').count()) === 1, `${what}: the missed deadline`)
  for (const name of ['Unfinished', 'Weekly']) if ((await row(name).count()) !== 1) throw new Error(`${what}: ${name} is not listed`)
  for (const name of ['Ahead', 'Closed']) if (await page.locator('[data-overdue-row]', { hasText: `${tag} ${name}` }).count()) throw new Error(`${what}: ${name} is listed`)
  const text = async (name) => (await row(name).innerText()).replace(/\s+/g, ' ')
  if (!/Due \w+/.test(await text('Missed')) || /Planned/.test(await text('Missed'))) throw new Error(`${what}: Missed says: ${await text('Missed')}`)
  if (!/Planned \w+/.test(await text('Unfinished'))) throw new Error(`${what}: Unfinished says: ${await text('Unfinished')}`)
  if (!/Due \w+/.test(await text('Weekly'))) throw new Error(`${what}: Weekly says: ${await text('Weekly')}`)
}

try {
  step('Today starts with Overdue: a missed deadline, an unfinished plan, a repeating task at its current occurrence')
  await page.goto(`${base}/calendar?view=day&date=${today}`)
  await lists('Today')
  const order = await page.locator('main h2, main [data-overdue]').first().evaluate((el) => el.hasAttribute('data-overdue'))
  if (!order) throw new Error('Overdue is not the first section of Today')

  step('another day has no Overdue')
  await page.goto(`${base}/calendar?view=day&date=${tomorrow}`)
  await page.getByText(`${tag} Ahead`).waitFor()
  if (await overdue.count()) throw new Error('Overdue shows on another day')
  await page.goto(`${base}/calendar?view=day&date=${today}`)
  await lists('Today again')

  step('Move to today plans it for today and keeps the deadline; the row still says what is late; Undo puts it back')
  await move('Missed').click()
  await until(async () => dateOnly((await stored(missed)).dodate) === today, 'the plan set to today')
  if (dateOnly((await stored(missed)).due) !== await dayAt(-3)) throw new Error('the deadline moved')
  await noticeWith(/Planned for today/).waitFor()
  await until(async () => (await move('Missed').count()) === 0, 'no second Move once planned for today')
  if (!(await row('Missed').count())) throw new Error('the row left while the deadline is still missed')
  await undo()
  await until(async () => !(await stored(missed)).dodate, 'Undo removed the plan')
  await until(async () => (await move('Missed').count()) === 1, 'Move to today is back')

  step('an unfinished plan leaves Overdue once moved to today, and shows in Planned for this day; Undo')
  await move('Unfinished').click()
  await until(async () => dateOnly((await stored(unfinished)).dodate) === today, 'the plan moved to today')
  if (dateOnly((await stored(unfinished)).due) !== await dayAt(10)) throw new Error('the deadline moved')
  await until(async () => (await row('Unfinished').count()) === 0, 'the row left Overdue')
  await until(async () => (await page.locator('[data-task-section="planned"]', { hasText: `${tag} Unfinished` }).count()) === 1, 'planned for today')
  await undo()
  await until(async () => dateOnly((await stored(unfinished)).dodate) === await dayAt(-1), 'Undo put the plan back')
  await until(async () => (await row('Unfinished').count()) === 1, 'listed again')

  step('a repeating task: its plan moves to today, the series stays')
  await move('Weekly').click()
  await until(async () => dateOnly((await stored(weekly)).dodate) === today, 'the plan set to today')
  const rule = (await stored(weekly)).due.value
  if (rule.rrule !== 'FREQ=WEEKLY;COUNT=6' || dateOnly({ value: rule }) !== await dayAt(-14)) throw new Error('the series changed')
  await undo()
  await until(async () => !(await stored(weekly)).dodate, 'Undo removed it')

  step('a task ticked here stays, checked and struck, until you leave')
  await row('Missed').locator('button[title="Mark as done"]').click()
  await until(async () => (await stored(missed)).status?.value.includes(doneOption), 'saved as done')
  await sleep(800)
  await until(async () => (await row('Missed').locator('button[title="Mark as to do"]').count()) === 1 && (await row('Missed').locator('.line-through').count()) > 0, 'checked and struck in place')
  if (await move('Missed').count()) throw new Error('a done task offers Move to today')
  await row('Missed').locator('button[title="Mark as to do"]').click()
  await until(async () => !(await stored(missed)).status?.value.includes(doneOption), 'reopened')

  step('an agenda: Overdue above the days, the same rows; the query’s filter applies')
  await page.goto(`${base}/o/${host.id}`)
  await lists('the agenda')
  const above = await page.evaluate(() => {
    const agenda = document.querySelector('[data-agenda]')
    return agenda.firstElementChild.hasAttribute('data-overdue') && !agenda.querySelector('section[data-agenda-day] [data-overdue]')
  })
  if (!above) throw new Error('Overdue is not above the days')
  await move('Missed').click()
  await until(async () => dateOnly((await stored(missed)).dodate) === today, 'the agenda’s Move to today')
  await until(async () => (await page.locator(`section[data-agenda-day="${today}"] [data-calendar-entry]`, { hasText: `${tag} Missed` }).count()) >= 1, 'planned under today in the agenda')
  await undo()
  await until(async () => !(await stored(missed)).dodate, 'Undo in the agenda')

  step('a phone: Move to today is 44px, nothing scrolls sideways')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/calendar?view=day&date=${today}`)
  await lists('the phone')
  const box = await move('Missed').boundingBox()
  if (box.height < 43.5) throw new Error(`Move to today is ${box.height}px tall`)
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('the page scrolls sideways')
  await page.goto(`${base}/o/${host.id}`)
  await lists('the agenda on a phone')
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('the agenda scrolls sideways')
  // The title's block (title, type and badges), not its widest wrapped line.
  const title = await row('Both late').locator('.font-medium').first().evaluate((el) => el.parentElement.getBoundingClientRect())
  if (process.env.SHOTS) await overdue.screenshot({ path: path.join(process.env.SHOTS, `overdue-phone-${engine}.png`) })
  if (title.width < 200) throw new Error(`a long title is squeezed to ${Math.round(title.width)}px on a phone`)
} finally {
  for (const id of [host.id, query.id, ...objects.map((o) => o.id)]) await page.request.delete(`${base}/api/objects/${id}`, { headers }).catch(() => {})
}

if (problems.length) {
  console.log(`console problems:\n  ${problems.join('\n  ')}`)
  throw new Error('console problems')
}
console.log('OK')
await browser.close()
