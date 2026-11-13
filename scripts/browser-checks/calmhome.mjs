// A calm home page in the test env, in a space of its own that opens on a page: that start page puts
// its icon beside the title and hides the tags row and the "Add property" line while they are empty
// (Tags and Property in the hover buttons reach them; another page looks as it did); an Agenda shows
// all-day events as chips and timed ones as rows, with tasks due as rows that line up; a compact
// query with nothing to show disappears with the heading above it (not a full one, not one with
// results, not while its settings are open); list rows show this year's dates without the year.
// The agenda's events are added to the calendar feed in the browser (a subscribed calendar needs a
// public feed URL), so the replica is turned off: the calendar then comes from the server.
//   node calmhome.mjs [chromium|webkit] [base]        SHOTS=<dir>: pictures of the start page and the other page
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 1000 }, locale: 'en-US', timezoneId: 'UTC' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-calmhome-')), options)
const browser = launched ?? context
await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
// (WebKit reports a request cut short by leaving the page as an error "due to access control checks".)
page.on('pageerror', (e) => !/due to access control checks/.test(e.message) && problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-calmhome-${engine}.png`)
      await page.screenshot({ path: shot })
      console.log('screenshot:', shot)
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const shot = async (name) => process.env.SHOTS && (await page.screenshot({ path: path.join(process.env.SHOTS, `calmhome-${engine}-${name}.png`) }))
const fail = (message) => {
  throw new Error(message)
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => (await page.request.put(`${base}${url}`, { headers, data })).json()

// The browser runs in UTC (above), so its days are the UTC ones.
const dayAt = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const today = dayAt(0)
const tomorrow = dayAt(1)
const year = new Date().getUTCFullYear()
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00.000Z`).getUTCDay()]

const tag = `${engine}-${Date.now() % 100000}`
const LONG = `Remembrance Day assembly and early dismissal for every grade ${tag}`
const NO_RESULTS = 'No objects match this query.'

// Events of a subscribed calendar, added to what the server answers for the calendar's range.
const external = (key, title, day, start, end) => ({
  key,
  kind: 'external',
  sourceId: 'fake-feed',
  title,
  start: start ?? `${day}T00:00:00.000Z`,
  ...(end ? { end } : {}),
  allDay: !start,
  startDay: day,
  endDay: day,
})
const events = [
  external('f1', `No school ${tag}`, today),
  external('f2', LONG, today),
  external('f3', `Dentist ${tag}`, today, `${today}T23:00:00.000Z`, `${today}T23:45:00.000Z`),
  external('f4', `Holiday ${tag}`, tomorrow),
]
await page.route(/\/api\/spaces\/[^/]+\/calendar\?/, async (route) => {
  const response = await route.fetch()
  const data = await response.json()
  data.entries.push(...events.filter((e) => e.startDay >= route.request().url().match(/from=([\d-]+)/)[1] && e.startDay <= route.request().url().match(/to=([\d-]+)/)[1]))
  await route.fulfill({ response, json: data })
})

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

// A space of its own, so what it opens on and the types it changes touch nothing else.
const space = await post('/api/spaces', { name: `Calm ${tag}` })
const bundle = await get(`/api/spaces/${space.id}`)
const typeOf = (system) => bundle.types.find((t) => t.system === system)
const pageType = typeOf('page')
const taskType = typeOf('task')
const queryType = typeOf('query')
await page.evaluate((id) => localStorage.setItem('vasta.space', id), space.id)

const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const heading = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const embed = (objectId, display) => ({ type: 'objectEmbed', attrs: { objectId, display } })
const titleFilter = (operator, value) => ({ kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator, value: { kind: 'literal', value } }] })
const due = (start, resolution) => ({ due: { kind: 'date', value: { start, resolution } } })
const newTask = (title, props) => post('/api/objects', { typeId: taskType.id, title, spaceId: space.id, props })
const newQuery = (title, query) => post('/api/objects', { typeId: queryType.id, title, spaceId: space.id, query: { typeIds: [taskType.id], ...query } })

const made = []
try {
  // Tasks the queries find: one due today (a row in the agenda); A, B and C for the list rows: this year, this year with a time, last year.
  const agendaTask = await newTask(`Pay fee ${tag}`, due(`${today}T00:00:00.000Z`, 'day'))
  const thisYear = await newTask(`Dates ${tag} A`, due(`${year}-03-14T00:00:00.000Z`, 'day'))
  const thisYearTimed = await newTask(`Dates ${tag} B`, due(`${year}-03-14T14:30:00.000Z`, 'time'))
  const lastYear = await newTask(`Dates ${tag} C`, due(`${year - 1}-03-14T00:00:00.000Z`, 'day'))
  made.push(agendaTask, thisYear, thisYearTimed, lastYear)

  const emptyQuery = await newQuery(`Nothing ${tag}`, { layout: 'list', filter: titleFilter('contains', `no-such-task-${tag}`) })
  const filledQuery = await newQuery(`Some ${tag}`, { layout: 'list', filter: titleFilter('contains', `Pay fee ${tag}`) })
  const agendaQuery = await newQuery(`Agenda ${tag}`, { layout: 'agenda', agenda: { days: 3, calendars: true }, filter: titleFilter('contains', `Pay fee ${tag}`) })
  const listQuery = await newQuery(`Dates ${tag}`, { layout: 'list', list: { fields: ['due'] }, filter: titleFilter('contains', `Dates ${tag}`) })
  made.push(emptyQuery, filledQuery, agendaQuery, listQuery)

  const home = await post('/api/objects', {
    typeId: pageType.id,
    spaceId: space.id,
    title: `Home ${tag}`,
    icon: { kind: 'emoji', value: '🏠' },
    content: {
      body: {
        type: 'doc',
        content: [
          para('Above everything'),
          heading(`Heads up ${tag}`),
          embed(emptyQuery.id, 'compact'),
          heading(`Next ${tag}`),
          embed(filledQuery.id, 'compact'),
          heading(`Full ${tag}`),
          embed(emptyQuery.id, 'embed'),
          heading(`Agenda ${tag}`),
          embed(agendaQuery.id, 'compact'),
          para('Below everything'),
        ],
      },
    },
  })
  const other = await post('/api/objects', { typeId: pageType.id, spaceId: space.id, title: `Other ${tag}`, icon: { kind: 'emoji', value: '📎' } })
  made.push(home, other)
  await put(`/api/spaces/${space.id}`, { opensOn: { kind: 'object', id: home.id } })

  const visible = (locator) => locator.evaluateAll((els) => els.some((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)))
  const box = async (locator) => (await locator.first().boundingBox()) ?? fail(`no box for ${locator}`)
  const tile = page.locator('button[title="Change icon"]')
  const title = page.locator('textarea[data-large-text]')
  const header = page.locator('[class*="group/header"]').first()
  const addTags = page.locator('button', { hasText: /^\s*Add tags\s*$/ })
  const addProperty = page.locator('button', { hasText: /Add property to / })

  step('another page: the 64px icon above the title, the tags row and "Add property" as before')
  await page.goto(`${base}/o/${other.id}`)
  await title.waitFor()
  const big = await box(tile)
  const otherTitle = await box(title)
  await shot('other')
  if (Math.round(big.width) !== 64 || Math.round(big.height) !== 64) fail(`the icon is ${big.width}×${big.height}, not 64×64`)
  if (big.y + big.height > otherTitle.y) fail('the icon is not above the title')
  if ((await addTags.count()) !== 1) fail('no "Add tags" on another page')
  if ((await addProperty.count()) !== 1) fail('no "Add property" on another page')
  await header.hover()
  if ((await header.locator('button', { hasText: /^\s*(Tags|Property)\s*$/ }).count()) !== 0) fail('Tags/Property buttons on another page')

  step('the start page: a 40px icon tile left of the title, on its row')
  await page.goto(`${base}/o/${home.id}`)
  await title.waitFor()
  const small = await box(tile)
  const homeTitle = await box(title)
  if (Math.round(small.width) !== 40 || Math.round(small.height) !== 40) fail(`the tile is ${small.width}×${small.height}, not 40×40`)
  if (small.x + small.width > homeTitle.x + 1) fail('the tile is not left of the title')
  const offset = Math.abs(small.y + small.height / 2 - (homeTitle.y + homeTitle.height / 2))
  if (offset > 3) fail(`the tile is ${offset}px off the title's centre`)

  step('the start page: no tags row, no "Add property" line')
  await shot('start')
  if (await visible(addTags)) fail('"Add tags" shows on the start page')
  if (await visible(addProperty)) fail('"Add property" shows on the start page')

  step('the icon tile still opens the icon picker')
  await tile.click()
  await page.locator('button', { hasText: /^\s*Remove\s*$/ }).waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')

  step('Tags and Property show next to Icon/Cover on hover, and open the same popovers')
  await header.hover()
  const tagsButton = header.locator('button', { hasText: /^\s*Tags\s*$/ })
  const propertyButton = header.locator('button', { hasText: /^\s*Property\s*$/ })
  await until(async () => (await tagsButton.count()) === 1 && (await propertyButton.count()) === 1, 'Tags and Property in the header')
  await until(async () => (await tagsButton.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === '1', 'the hover group shown')
  await tagsButton.click()
  await page.locator('input[placeholder="Search…"]').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await header.hover()
  await propertyButton.click()
  await page.locator('input[placeholder="Property name"]').waitFor({ timeout: 5000 })

  step('adding a property brings the line back and Property leaves the header')
  await page.locator('input[placeholder="Property name"]').fill(`Mood ${tag}`)
  await page.locator('button', { hasText: /^\s*Add property\s*$/ }).click()
  await until(async () => (await visible(addProperty)) && !(await propertyButton.count()), 'the "Add property" line back')
  if (!(await page.locator('.vasta-prop-name', { hasText: `Mood ${tag}` }).count())) fail('the new property has no row')

  step('a tagged start page keeps its tags row')
  const tagObject = await post('/api/objects', { typeId: typeOf('tag').id, spaceId: space.id, title: `calm-${tag}` })
  made.push(tagObject)
  await put(`/api/objects/${home.id}`, { ...(await get(`/api/objects/${home.id}`)), tagIds: [tagObject.id] })
  await page.goto(`${base}/o/${home.id}`)
  await title.waitFor()
  await until(async () => (await page.getByText(`calm-${tag}`).count()) > 0, 'the tag on the page')
  await header.hover()
  if (await tagsButton.count()) fail('a Tags button although the page has tags')
  await put(`/api/objects/${home.id}`, { ...(await get(`/api/objects/${home.id}`)), tagIds: [] })

  step('compact queries: with results it shows; with none it and its heading are gone; a full one stays')
  await page.goto(`${base}/o/${home.id}`)
  const doc = page.locator('.vasta-doc').first()
  const text = (t) => doc.getByText(t, { exact: false })
  await until(async () => (await visible(text(`Pay fee ${tag}`))) && (await doc.locator('[data-empty]').count()) === 1, 'the results and the empty one')
  if (!(await visible(page.locator('.vasta-doc h2', { hasText: `Next ${tag}` })))) fail('the heading above a compact query with results is hidden')
  if (await visible(page.locator('.vasta-doc h2', { hasText: `Heads up ${tag}` }))) fail('the heading above the empty compact query shows')
  if (await visible(doc.locator('[data-empty]'))) fail('the empty compact query shows')
  // The full embed's own "No objects match" is the one allowed to show: exactly one is visible.
  const shown = await text(NO_RESULTS).evaluateAll((els) => els.filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).length)
  if (shown !== 1) fail(`${shown} "${NO_RESULTS}" show, not just the full embed's`)
  if (!(await visible(page.locator('.vasta-doc h2', { hasText: `Full ${tag}` })))) fail('the heading above a full embed is hidden')
  if (!(await visible(doc.getByText('Above everything'))) || !(await visible(doc.getByText('Below everything')))) fail('a paragraph went with it')

  step('the empty compact query comes back while its settings are open, and goes again when done')
  await doc.locator('[data-node-view-wrapper]:has([data-empty])').evaluate((el) => el.dispatchEvent(new CustomEvent('vasta-query', { detail: 'edit' })))
  const done = doc.locator('button', { hasText: /^\s*Done\s*$/ })
  await until(async () => visible(done), 'the settings open')
  if (!(await visible(page.locator('.vasta-doc h2', { hasText: `Heads up ${tag}` })))) fail('the heading stayed hidden while the settings are open')
  await done.click()
  await until(async () => !(await visible(page.locator('.vasta-doc h2', { hasText: `Heads up ${tag}` }))), 'hidden again')

  step('an agenda in a compact embed: all-day events are chips, timed ones rows')
  const today_ = page.locator(`section[data-agenda-day="${today}"]`)
  await until(async () => (await today_.locator('[data-agenda-chips] [data-calendar-entry]').count()) === 2, 'two chips under today')
  const chips = today_.locator('[data-agenda-chips] [data-calendar-entry]')
  const chipTitles = (await chips.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
  if (!chipTitles.some((t) => t.includes(`No school ${tag}`)) || !chipTitles.some((t) => t.includes(`Remembrance Day`))) fail(`chips: ${chipTitles.join(' | ')}`)
  const rows = today_.locator('[data-calendar-entry]:not([data-agenda-chips] *)')
  const rowTexts = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
  if (rowTexts.length !== 2) fail(`rows under today: ${rowTexts.join(' | ')}`)
  const task = rows.filter({ hasText: `Pay fee ${tag}` })
  const dentist = rows.filter({ hasText: `Dentist ${tag}` })
  if ((await dentist.count()) !== 1 || !(await dentist.textContent()).replace(/\s+/g, ' ').trim().startsWith('11:00 PM')) fail(`the timed event is not a row with its time: ${rowTexts.join(' | ')}`)
  if (/All day/.test(await today_.innerText())) fail('the words "All day" still show')
  if ((await task.locator('button[title="Mark as done"]').count()) !== 1) fail('the task due today lost its checkbox')
  if ((await chips.locator('button').count()) !== 0) fail('a chip has a checkbox')
  if (!(await visible(page.locator('section[data-agenda-day] [data-agenda-now]')))) fail('the line for now is gone')
  if (!(await page.locator(`section[data-agenda-day="${dayAt(2)}"]`).innerText()).includes('Nothing planned')) fail('"Nothing planned" is gone')

  await shot('agenda')
  step('chips and rows line up: the chip’s icon and the rows’ icons, the task’s title and the timed title')
  const iconX = async (locator) => (await box(locator.locator('svg, img, span.iconify').first())).x
  const chipX = await iconX(chips.first())
  const rowX = await iconX(dentist)
  if (Math.abs(chipX - rowX) > 1.5) fail(`the chip’s icon is at ${chipX}, the rows’ at ${rowX}`)
  const titleX = async (locator, t) => (await box(locator.locator('span.font-medium', { hasText: t }))).x
  const a = await titleX(task, `Pay fee ${tag}`)
  const b = await titleX(dentist, `Dentist ${tag}`)
  if (Math.abs(a - b) > 1.5) fail(`the task’s title is at ${a}, the timed event’s at ${b}`)

  step('a long title is cut short at about 16rem, with the whole in its tooltip')
  const long = chips.filter({ hasText: 'Remembrance Day' })
  const wide = await box(long)
  if (wide.width > 16 * 16 + 2) fail(`the long chip is ${wide.width}px wide`)
  if (!(await long.locator('span.truncate').evaluate((el) => el.scrollWidth > el.clientWidth))) fail('the long title is not cut with an ellipsis')
  if (!((await long.getAttribute('title')) ?? '').includes(LONG)) fail('the full title is not in the tooltip')
  const wideChips = await Promise.all((await chips.all()).map(async (c) => (await box(c)).y))
  if (wideChips.some((y) => Math.abs(y - wideChips[0]) > 40)) fail('chips are not in one row')

  step('a chip opens the same details a row would')
  await chips.filter({ hasText: `No school ${tag}` }).click()
  await until(async () => (await page.locator('body > div', { hasText: `No school ${tag}` }).filter({ hasText: 'Start notes' }).count()) > 0 || (await page.locator('body > div .font-semibold', { hasText: `No school ${tag}` }).count()) > 0, 'the details')
  await page.keyboard.press('Escape')
  await dentist.click()
  await until(async () => (await page.locator('body > div .font-semibold', { hasText: `Dentist ${tag}` }).count()) > 0, 'a row’s details')
  await page.keyboard.press('Escape')

  step('the calendar’s month view still shows the all-day event as before')
  await page.goto(`${base}/calendar?view=month`)
  await until(async () => (await page.locator('[data-calendar-entry]', { hasText: `No school ${tag}` }).count()) >= 1, 'the all-day event in the month')
  if (await page.locator('[data-agenda-chips]').count()) fail('agenda chips on the calendar')

  step('list rows: this year’s dates without the year, with the time when there is one; other years as before')
  await page.goto(`${base}/o/${listQuery.id}`)
  const row = (t) => page.locator('a', { hasText: t })
  await until(async () => (await row(`Dates ${tag} C`).count()) === 1 && (await row(`Dates ${tag} B`).count()) === 1, 'the list rows')
  const rowText = async (t) => (await row(t).first().innerText()).replace(/\s+/g, ' ')
  const day = `${weekday(`${year}-03-14`)} Mar 14`
  if (!(await rowText(`Dates ${tag} A`)).includes(day) || (await rowText(`Dates ${tag} A`)).replace(tag, '').includes(String(year))) fail(`this year’s date: ${await rowText(`Dates ${tag} A`)}`)
  if (!(await rowText(`Dates ${tag} B`)).includes(`${day}, 2:30 PM`)) fail(`the date with a time: ${await rowText(`Dates ${tag} B`)}`)
  if (!(await rowText(`Dates ${tag} C`)).includes(`Mar 14, ${year - 1}`)) fail(`last year’s date: ${await rowText(`Dates ${tag} C`)}`)
  if ((await rowText(`Dates ${tag} C`)).includes(`${weekday(`${year - 1}-03-14`)} Mar`)) fail('last year’s date lost its form')
} finally {
  await page.goto(`${base}/settings`).catch(() => {}) // a page that no longer shows what is deleted
  for (const object of made) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
  await page.request.delete(`${base}/api/spaces/${space.id}`, { headers }).catch(() => {})
}

if (problems.length) console.log(`console problems:\n  ${problems.join('\n  ')}`)
else console.log('no console problems')
console.log('OK')
await browser.close()
