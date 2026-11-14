// The Agenda layout in the test env: a query shown as an agenda in a page (day sections from today,
// all-day rows, timed rows with their time, the line for now, a task's checkbox, a day with nothing)
// and its settings (days), then a type view as an agenda with its date field. Dragging an entry to
// another day moves its date (a task's due, an event's own field), keeping the time of day, and
// the notice's Undo puts it back.
// Subscribed calendars need a feed URL the test env does not have, so they are not covered here
// (lib/agenda.test.ts is).
//   node agenda.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'UTC' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-agenda-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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
      const shot = path.join(tmpdir(), `vasta-agenda-${engine}.png`)
      await page.screenshot({ path: shot })
      console.log('screenshot:', shot)
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => (await page.request.put(`${base}${url}`, { headers, data })).json()

// The browser runs in UTC (above), so its days are the UTC ones.
const dayAt = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const today = dayAt(0)
const tomorrow = dayAt(1)
const day = (key) => page.locator(`section[data-agenda-day="${key}"]`)
const days = () => page.locator('section[data-agenda-day]').count()
const entry = (key, title) => day(key).locator('[data-calendar-entry]', { hasText: title })
/** Drag an entry onto another day's section, as a mouse would (lib/calendar-drag.ts). */
async function dragTo(from, toSection) {
  const a = await from.boundingBox()
  const b = await toSection.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 8, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 8)
  await page.mouse.up()
}

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const doneOption = taskType.properties.find((p) => p.id === 'status').options.find((o) => o.status === 'done').id

const tag = `${engine}-${Date.now() % 100000}`
const due = (start, resolution) => ({ due: { kind: 'date', value: { start, resolution } } })
const newTask = (title, props) => post('/api/objects', { typeId: taskType.id, title, props })
const early = await newTask(`Early ${tag}`, due(`${today}T00:01:00.000Z`, 'time'))
const late = await newTask(`Late ${tag}`, due(`${today}T23:30:00.000Z`, 'time'))
const allDay = await newTask(`All day ${tag}`, due(`${today}T00:00:00.000Z`, 'day'))
const nextDay = await newTask(`Tomorrow ${tag}`, due(`${tomorrow}T10:00:00.000Z`, 'time'))
const other = await newTask(`Other ${tag}`, due(`${today}T12:00:00.000Z`, 'time'))
const queryType = bundle.types.find((t) => t.system === 'query')
// The tag tells these tasks from the seed's; `other` is one the filter leaves out.
const titleFilter = (operator, value) => ({ kind: 'filter', field: 'title', operator, value: { kind: 'literal', value } })
const query = await post('/api/objects', {
  typeId: queryType.id,
  title: `Agenda ${tag}`,
  query: {
    typeIds: [taskType.id],
    layout: 'agenda',
    agenda: { days: 3 },
    filter: { kind: 'group', operator: 'and', items: [titleFilter('contains', tag), titleFilter('not-contains', 'Other')] },
  },
})
const host = await post('/api/objects', {
  typeId: bundle.types.find((t) => t.system === 'page').id,
  title: `Home ${tag}`,
  content: { body: { type: 'doc', content: [{ type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }, { type: 'paragraph' }] } },
})
await sleep(1500) // the replica pulls them

let eventType
try {
  step('a query as an agenda in a page: three days from today')
  await page.goto(`${base}/o/${host.id}`)
  await until(async () => (await days()) === 3, 'three day sections')
  const headings = await page.locator('section[data-agenda-day] h3').allTextContents()
  if (!/^Today · \w{3} \w{3} \d+$/.test(headings[0].trim())) throw new Error(`first heading: ${headings[0]}`)
  if (!/^Tomorrow · \w{3} \w{3} \d+$/.test(headings[1].trim())) throw new Error(`second heading: ${headings[1]}`)
  if (!/^\w{3} \w{3} \d+$/.test(headings[2].trim())) throw new Error(`third heading: ${headings[2]}`)

  step('today: the all-day row, then the timed rows in order with their times; the other task is not here')
  await until(async () => (await entry(today, `All day ${tag}`).count()) === 1, 'the all-day task under today')
  await until(async () => (await entry(today, `Late ${tag}`).count()) === 1, 'the late task under today')
  const rows = await day(today).locator('[data-calendar-entry]').allTextContents()
  const order = rows.map((r) => r.replace(/\s+/g, ' ').trim())
  if (!order[0].includes(`All day ${tag}`) || !order[1].includes(`Early ${tag}`) || !order[2].includes(`Late ${tag}`)) throw new Error(`order: ${order.join(' | ')}`)
  // (The task's title is "All day …": the row's time column is empty, so the title comes first.)
  if (!order[0].startsWith(`All day ${tag}`)) throw new Error(`the all-day row has no empty time column: ${order[0]}`)
  if (!order[1].startsWith('12:01 AM') || !order[2].startsWith('11:30 PM')) throw new Error(`times: ${order.join(' | ')}`)
  if (await page.locator('[data-calendar-entry]', { hasText: `Other ${tag}` }).count()) throw new Error('a task the filter excludes showed')
  if (order.length !== 3) throw new Error(`today has ${order.length} items, not 3: ${order.join(' | ')}`)

  step('the line for now sits among today’s rows; what is over is faded')
  await until(async () => (await day(today).locator('[data-agenda-now]').count()) === 1, 'the now line')
  const minutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes()
  if (minutes > 2 && minutes < 1438) {
    // Early (00:01) is over and Late (23:30) is not, unless the check ran in the first or last minutes of the day.
    if (!(await day(today).locator('[data-past]').filter({ hasText: `Early ${tag}` }).count())) throw new Error('the early task is not faded')
    if (minutes < 23 * 60 + 29 && (await day(today).locator('[data-past]').filter({ hasText: `Late ${tag}` }).count())) throw new Error('the late task is faded')
    const lineY = (await day(today).locator('[data-agenda-now]').boundingBox()).y
    const earlyY = (await entry(today, `Early ${tag}`).boundingBox()).y
    const lateY = (await entry(today, `Late ${tag}`).boundingBox()).y
    if (!(earlyY < lineY && lineY < lateY) && minutes < 23 * 60 + 29) throw new Error(`the line is not between the rows: ${earlyY} ${lineY} ${lateY}`)
  }

  step('tomorrow: a timed row; the day after: nothing planned')
  await until(async () => (await entry(tomorrow, `Tomorrow ${tag}`).count()) === 1, 'the task under tomorrow')
  if (!(await entry(tomorrow, `Tomorrow ${tag}`).textContent()).replace(/\s+/g, ' ').trim().startsWith('10:00 AM')) throw new Error('tomorrow’s time')
  if (!(await day(dayAt(2)).textContent()).includes('Nothing planned')) throw new Error('the third day is not empty')

  step('tick a task’s checkbox: marked done in place and saved')
  await entry(tomorrow, `Tomorrow ${tag}`).locator('button[title="Mark as done"]').click()
  await until(async () => (await get(`/api/objects/${nextDay.id}`)).props.status?.value.includes(doneOption), 'the task saved as done')
  await until(async () => (await entry(tomorrow, `Tomorrow ${tag}`).locator('button[title="Mark as to do"]').count()) === 1, 'the checkbox shows it done')
  if (!(await entry(tomorrow, `Tomorrow ${tag}`).locator('.line-through').count())) throw new Error('the title is not struck through')

  step('drag an all-day task to another day: its due date moves with it')
  await dragTo(entry(today, `All day ${tag}`), day(tomorrow))
  await until(async () => (await get(`/api/objects/${allDay.id}`)).props.due?.value?.start === `${tomorrow}T00:00:00.000Z`, 'the due date moved to tomorrow, still all-day')
  await until(async () => (await entry(tomorrow, `All day ${tag}`).count()) === 1, 'the row moved to tomorrow')
  if ((await entry(today, `All day ${tag}`).count()) !== 0) throw new Error('the row is still under today')

  step('the query’s settings: Agenda is a layout; sort and group are gone; Days set to one')
  await page.locator('button', { hasText: 'Edit query' }).click()
  await page.waitForSelector('button[title="Agenda"]')
  if (await page.locator('label', { hasText: 'Sort by' }).count()) throw new Error('Sort by shows for an agenda')
  if (await page.locator('label', { hasText: 'Group by' }).count()) throw new Error('Group by shows for an agenda')
  await page.locator('button', { hasText: /^\s*Agenda\s*$/ }).click()
  await page.locator('select[aria-label="Days"]').selectOption('1')
  await until(async () => (await get(`/api/objects/${query.id}`)).query.agenda?.days === 1, 'days saved on the query')
  await until(async () => (await days()) === 1, 'one day section')
  if (await page.locator('section[data-agenda-day] h3', { hasText: 'Tomorrow' }).count()) throw new Error('Tomorrow is still shown')
  if (!(await get(`/api/objects/${query.id}`)).query.filter) throw new Error('the filter was lost')
  await page.keyboard.press('Escape')

  step('a type view as an agenda: the date field is chosen from the type’s date properties')
  const eventNew = await post('/api/types', { spaceId: space.id, name: `Event ${tag}`, pluralName: `Events ${tag}` })
  eventType = await put(`/api/types/${eventNew.id}`, {
    ...eventNew,
    properties: [{ id: 'when', kind: 'date', name: 'When' }, { id: 'until', kind: 'date', name: 'Until' }],
    views: [{ id: `${eventNew.id}:all`, name: 'All', layout: 'agenda', agenda: { days: 2 } }],
  })
  await post('/api/objects', { typeId: eventType.id, title: `Deadline ${tag}`, props: { until: { kind: 'date', value: { start: `${tomorrow}T00:00:00.000Z`, resolution: 'day' } } } })
  const concert = await post('/api/objects', { typeId: eventType.id, title: `Concert ${tag}`, props: { when: { kind: 'date', value: { start: `${tomorrow}T20:00:00.000Z`, resolution: 'time' } } } })
  await sleep(1500)
  await page.goto(`${base}/t/${eventType.id}`)
  await until(async () => (await days()) === 2, 'two day sections on the type page')
  await until(async () => (await entry(tomorrow, `Concert ${tag}`).count()) === 1 && (await entry(tomorrow, `Deadline ${tag}`).count()) === 1, 'both events under tomorrow')
  if (await page.locator('button', { hasText: /^\s*Group/ }).count()) throw new Error('Group shows for an agenda view')
  await page.locator('button', { hasText: 'Options' }).click()
  const fields = await page.locator('select[aria-label="Date field"] option').allTextContents()
  if (fields.join() !== 'Any date,Date,When,Until') throw new Error(`date fields: ${fields}`)
  await page.locator('select[aria-label="Date field"]').selectOption('when')
  await until(async () => (await get(`/api/types/${eventType.id}`)).views[0].agenda?.field === 'when', 'the date field saved on the view')
  await until(async () => (await entry(tomorrow, `Deadline ${tag}`).count()) === 0 && (await entry(tomorrow, `Concert ${tag}`).count()) === 1, 'only the chosen field’s entries')

  step('drag a timed entry to another day: its own field moves, keeping its time of day')
  await dragTo(entry(tomorrow, `Concert ${tag}`), day(today))
  await until(async () => (await get(`/api/objects/${concert.id}`)).props.when?.value?.start === `${today}T20:00:00.000Z`, 'When moved to today, still at 20:00')
  await until(async () => (await entry(today, `Concert ${tag}`).count()) === 1, 'the concert moved to today')
  if ((await entry(tomorrow, `Concert ${tag}`).count()) !== 0) throw new Error('the concert is still under tomorrow')

  step('the drop says where it went, and Undo puts the time back')
  const moved = page.locator('[role=status]', { hasText: /Moved to \w{3}, \w{3} \d+/ })
  await moved.waitFor()
  await moved.locator('button', { hasText: 'Undo' }).click()
  await until(async () => (await get(`/api/objects/${concert.id}`)).props.when?.value?.start === `${tomorrow}T20:00:00.000Z`, 'When back on tomorrow at 20:00')
  await until(async () => (await entry(tomorrow, `Concert ${tag}`).count()) === 1 && (await entry(today, `Concert ${tag}`).count()) === 0, 'the concert is back under tomorrow')
} finally {
  for (const id of [host.id, query.id, early.id, late.id, allDay.id, nextDay.id, other.id]) await page.request.delete(`${base}/api/objects/${id}`, { headers })
  if (eventType) {
    for (const o of await get(`/api/types/${eventType.id}/objects`).catch(() => [])) await page.request.delete(`${base}/api/objects/${o.id}`, { headers })
    await page.request.delete(`${base}/api/types/${eventType.id}`, { headers })
  }
}

if (problems.length) console.log(`console problems:\n  ${problems.join('\n  ')}`)
else console.log('no console problems')
console.log('OK')
await browser.close()
