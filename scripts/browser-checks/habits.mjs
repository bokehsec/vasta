// Habit progress in the test env: a daily habit, one on Mon/Wed/Fri, one 3 times a week and a paused
// one (a pause with a first day), with check-ins over the last weeks; then the Habits page: the weekly
// habit's "x of 3 this week" on Today, a day off faded in the Tracker (a "3 a week" habit never shows
// a missed day), the Progress tab's headline and rows (checked against core's habitReport), the range
// switch kept on reload, its chart choice (a trend line or a calendar, the same two in the Tracker's
// Display menu) and each habit's weeks, settings saved with the old chart ids read as the nearest of
// the two, Pause and Resume on a habit's page, the habit page's "last 4 weeks" matching the report,
// past days fixed with the phone day picker and a habit's two-week sheet, Done / Not done choices
// on long press, and (on 5184, the built app) the same numbers
// after reloading offline. SHOTS=<dir> saves light and dark screenshots; PHONE=1 a 390px width (Today left out).
// The Tracker's own progress is checked too: where it shows (above, beside, off), the chart and
// the range are picked in its Display menu (kept with the account, so they survive a reload).
//   node habits.mjs [chromium|webkit] [base]
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testArgs, testContext } from './test-env.mjs'
import { addDays, habitReport, mondayOf } from '../../packages/core/src/index.ts'

const { engine, base } = testArgs()
// The built app is served by the API server itself; a dev one by Vite (its page loads /@vite/client).
const built = !(await (await fetch(base)).text()).includes('/@vite/client')
const timezoneId = 'America/Toronto'

const options = { viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, locale: 'en-US', timezoneId, serviceWorkers: built ? 'allow' : 'block' }
const context = await testContext(engine, options)
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
const failedRequests = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|404|TextSelection endpoint|Service Worker registration blocked by Playwright|due to access control checks|VUE_ROUTER_R0010|router.onError|Failed to fetch|ERR_INTERNET_DISCONNECTED|WebKit encountered an internal error|network/i.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-habits-${engine}.png`)
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
const text = async (locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { state: 'attached', timeout: 30000 })
await page.waitForURL((url) => url.pathname !== '/')
// Let the start page finish before a later reload can cancel its mounted-hook request.
await page.locator('main h1:visible').first().waitFor()
await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
// A replica run must actually use its local copy, rather than silently pass on HTTP fallback.
await page.goto(`${base}/settings`)
await until(async () => (await page.locator('#device').textContent().catch(() => ''))?.includes(process.env.MODE === 'json' ? 'Turned off on this browser' : 'Keeps a copy of your spaces'), 'the requested data mode')

// Today as the browser sees it; weeks of check-ins before it.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const monday = mondayOf(today)
const week = (back, ...days) => days.map((d) => addDays(monday, -7 * back + d))
const done = (days) => Object.fromEntries(days.map((d) => [`done:${d}`, { kind: 'checkbox', value: true }]))

const tag = `${engine}-${Date.now() % 100000}`
// A phone has no sidebar to switch spaces: it uses the first space (its other habits are counted too).
const space = process.env.PHONE ? (await get('/api/spaces'))[0] : await post('/api/spaces', { name: `Habits ${tag}` })
const habitType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'habit')
if (!habitType.properties.some((p) => p.id === 'perweek' && p.name === 'Times a week')) throw new Error('no Times a week field')
// A phone runs in the first space, where an earlier run may have left its charts on the habit type.
await put(`/api/types/${habitType.id}`, { ...habitType, habits: undefined })
const specs = [
  { title: 'Read', props: done([...week(2, 0, 1), ...week(1, 0, 1, 2, 3, 4, 5, 6)]) },
  { title: 'Stretch', props: { days: { kind: 'select', value: ['mon', 'wed', 'fri'] }, ...done(week(1, 0, 2)) } },
  { title: 'Gym', props: { perweek: { kind: 'number', value: 3 }, ...done([...week(2, 0), ...week(1, 0, 2, 4)]) } },
  { title: 'Swim', props: { [`pause:${week(2, 1)[0]}`]: { kind: 'text', value: '' }, ...done(week(2, 0)) } },
]
const habits = []
for (const spec of specs) habits.push(await post('/api/objects', { typeId: habitType.id, ...spec, title: process.env.PHONE ? `${spec.title} ${tag}` : spec.title }))

await page.evaluate((id) => localStorage.setItem(Object.keys(localStorage).find((k) => /^vasta\.device\..+\.last-space$/.test(k)), JSON.stringify(id)), space.id)
await page.reload()
await page.waitForSelector('nav', { state: 'attached' })
await page.locator('main h1:visible').first().waitFor()
await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
await until(async () => {
  if (await page.locator('aside').getByText(`Habits ${tag}`).count()) return true
  if (process.env.PHONE) return true
  await page.locator('aside button[title="Spaces and account"]').click()
  const item = page.locator('[role=menu]').getByText(`Habits ${tag}`)
  if (await item.count()) await item.click()
  else await page.keyboard.press('Escape')
  await sleep(500)
  return false
}, 'the space open', 30000)

const main = page.locator('main')
// On a phone the space is not switched (no sidebar): the type's page opens it by id, Today would not.
if (!process.env.PHONE) {
  step('Today: the weekly habit says how many this week')
  await page.goto(`${base}/day/${today}`)
  await until(async () => / of 3 this week/.test(await text(main)), '"x of 3 this week" on Today')
}

step('Tracker: a day off is faded (phone: a row per habit)')
await page.goto(`${base}/t/${habitType.id}`)
if (process.env.PHONE) {
  await until(() => main.locator('[data-habit-row]', { hasText: 'Stretch' }).count(), 'the phone rows')
  const ticks = await main.locator('[data-habit-row]', { hasText: 'Stretch' }).locator('i[title*="day off"]').count()
  if (!ticks) throw new Error('no day-off tick for Mon/Wed/Fri')
  if (await main.locator('table').count()) throw new Error('a table on the phone')
  // "3 a week" asks for no day in particular: none of its days is missed (phone rows); a paused one shows paused.
  if (await main.locator('[data-habit-row]', { hasText: 'Gym' }).locator('i[data-state="missed"]').count()) throw new Error('a missed day on a 3 a week habit')
  if (!(await main.locator('[data-habit-row]', { hasText: 'Swim' }).locator('i[data-state="paused"]').count())) throw new Error('no paused days on the paused habit')
} else {
  await until(() => main.locator('tr', { hasText: 'Stretch' }).count(), 'the Tracker')
  const stretchCells = main.locator('tr', { hasText: 'Stretch' }).locator('td')
  const faded = await stretchCells.evaluateAll((cells) => cells.filter((c) => c.querySelector('.opacity-40')).length)
  if (!faded) throw new Error('no faded day for Mon/Wed/Fri')
}

step('Tracker progress: calendar above by default, matching the report')
const listed4 = (await get(`/api/types/${habitType.id}/objects`)).filter((h) => !h.deletedAt)
const report4 = habitReport(listed4, 4, today)
const pct4 = report4.total.expected ? `${Math.round((report4.total.done / report4.total.expected) * 100)}%` : '—'
await until(async () => (await main.locator('[data-progress-summary][data-layout="above"][data-chart="calendar"]').count()) === 1, 'the calendar above')
await until(async () => (await text(main.locator('[data-progress-summary] [data-progress-headline]'))).startsWith(`${pct4} over the last 4 weeks ${report4.total.done} of ${report4.total.expected} done`), `headline ${pct4}`)
// The charts and range are personal choices in the Tracker's Display menu (beside Filter),
// never shared fields in Type settings.
await page.goto(`${base}/t/${habitType.id}?settings=1`)
await until(() => page.getByRole('button', { name: 'Save', exact: true }).count(), 'Type settings')
if (await page.locator('[data-habit-progress-settings]').count()) throw new Error('progress still in Type settings')
await page.goto(`${base}/t/${habitType.id}`)
await until(async () => (await main.locator('[data-progress-summary]').count()) === 1, 'back on the Tracker')
const progressSettings = async (...selectors) => {
  await page.locator('[data-progress-menu]').click()
  for (const selector of selectors) await page.locator(`[data-progress-options] ${selector}`).click()
  await page.keyboard.press('Escape')
  await until(async () => !(await page.locator('[data-progress-options]').count()), 'the progress menu closed')
}
for (const chart of ['line', 'calendar']) {
  await progressSettings(`[data-chart="${chart}"]`)
  await until(async () => (await main.locator(`[data-progress-summary][data-layout="above"][data-chart="${chart}"]`).count()) === 1, `above ${chart}`)
  if (process.env.SHOTS && chart === 'line') {
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-strip-line${process.env.PHONE ? '-phone' : ''}.png`) })
    await page.locator('[data-progress-menu]').click()
    await sleep(400)
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-progress-menu${process.env.PHONE ? '-phone' : ''}.png`) })
    await page.keyboard.press('Escape')
    await until(async () => !(await page.locator('[data-progress-options]').count()), 'the progress menu closed')
  }
}
// Exactly two charts to pick from.
await page.locator('[data-progress-menu]').click()
if ((await page.locator('[data-progress-options] [data-chart]').count()) !== 2) throw new Error('not exactly two charts in the menu')
await page.keyboard.press('Escape')
await until(async () => !(await page.locator('[data-progress-options]').count()), 'the progress menu closed')
await progressSettings('[data-place="beside"]')
await until(async () => (await main.locator('[data-progress-summary][data-layout="beside"][data-chart="calendar"]').count()) === 1, 'the column beside')
for (const chart of ['line', 'calendar']) {
  await progressSettings(`[data-chart="${chart}"]`)
  await until(async () => (await main.locator(`[data-progress-summary][data-layout="beside"][data-chart="${chart}"]`).count()) === 1, `beside ${chart}`)
}
if ((await main.locator('[data-progress-summary]').count()) !== 1) throw new Error('above and beside both shown')
await until(async () => (await text(main.locator('[data-progress-summary] [data-progress-headline]'))).startsWith(`${pct4} over the last 4 weeks`), 'beside headline')
await page.keyboard.press('Escape')
if (process.env.SHOTS) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await sleep(300)
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-panel${process.env.PHONE ? '-phone' : ''}-${theme}.png`), fullPage: true })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

step('Tracker progress: the range, from the same menu')
const report8 = habitReport(listed4, 8, today)
const pct8 = report8.total.expected ? `${Math.round((report8.total.done / report8.total.expected) * 100)}%` : '—'
await progressSettings('[data-weeks="8"]')
await until(async () => (await text(main.locator('[data-progress-summary] [data-progress-headline]'))).startsWith(`${pct8} over the last 8 weeks`), `headline ${pct8}`)

await page.reload()
await until(async () => (await main.locator('[data-progress-summary][data-layout="beside"][data-chart="calendar"]').count()) === 1, 'the column kept on reload')
await progressSettings('[data-place="off"]')
await until(async () => !(await main.locator('[data-progress-summary]').count()), 'progress off')
await progressSettings('[data-place="above"]')
await until(async () => (await main.locator('[data-progress-summary][data-layout="above"][data-chart="calendar"]').count()) === 1, 'back to the calendar above')
// What the menu saved is the person's own choice, kept with their account (every device of theirs); the type is not edited.
await until(async () => {
  const saved = ((await get('/api/auth/me')).preferences ?? {})[`type/${habitType.id}/habits`]
  return saved?.place === 'above' && saved?.chart === 'calendar' && saved?.weeks === 8
}, 'the progress settings in the account')
if (await page.getByText('did not take').count()) throw new Error('the server refused a change')
if (process.env.SHOTS) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await sleep(300)
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-strip${process.env.PHONE ? '-phone' : ''}-${theme}.png`), fullPage: true })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

step('Type settings: a draft opened earlier saves only its own fields, not a view added meanwhile')
await page.goto(`${base}/t/${habitType.id}?settings=1`)
await until(() => page.getByRole('button', { name: 'Save', exact: true }).count(), 'Type settings draft')
const latestType = await get(`/api/types/${habitType.id}`)
await put(`/api/types/${habitType.id}`, { ...latestType, views: [...latestType.views, { id: `${habitType.id}:meanwhile`, name: 'Meanwhile', layout: 'list' }] })
await page.getByLabel('Name', { exact: true }).fill(`${latestType.name} edited`)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await until(async () => (await get(`/api/types/${habitType.id}`)).name === `${latestType.name} edited`, 'name saved')
if (!(await get(`/api/types/${habitType.id}`)).views.some((v) => v.id.endsWith(':meanwhile'))) throw new Error('Type settings overwrote a view added meanwhile')
await put(`/api/types/${habitType.id}`, { ...(await get(`/api/types/${habitType.id}`)), views: latestType.views })
// The Display choice is personal: forget it, so the type's own (starting) settings show. First let
// this device send what it still holds (a reload can cut a send short; it goes again at the start),
// or that newer pick would rightly come back over the server's.
await until(async () => page.evaluate(() => Object.entries(localStorage).every(([name, raw]) => !name.startsWith('vasta.account.') || !Object.keys(JSON.parse(raw).pending ?? {}).length)), 'preferences sent')
await put('/api/auth/me', { preferences: { [`type/${habitType.id}/habits`]: null } })
await page.goto(`${base}/t/${habitType.id}`)

step('Settings saved with the old chart ids read as the nearest of the two')
const oldType = await get(`/api/types/${habitType.id}`)
await put(`/api/types/${habitType.id}`, { ...oldType, habits: { place: 'above', strip: 'days', panel: 'counts', report: 'weeks', weeks: 8 } })
await until(async () => (await main.locator('[data-progress-summary][data-layout="above"][data-chart="calendar"]').count()) === 1, 'old strip "days" shown as the calendar')
await put(`/api/types/${habitType.id}`, { ...oldType, habits: { place: 'beside', strip: 'days', panel: 'counts', report: 'weeks', weeks: 8 } })
await until(async () => (await main.locator('[data-progress-summary][data-layout="beside"][data-chart="line"]').count()) === 1, 'old panel "counts" shown as the trend line')
await put(`/api/types/${habitType.id}`, { ...oldType, habits: { place: 'above', chart: 'calendar', weeks: 8 } })
await until(async () => (await main.locator('[data-progress-summary][data-layout="above"][data-chart="calendar"]').count()) === 1, 'back to the calendar')

step('Progress: headline and rows match the report')
const pick = async (name) => {
  if (process.env.PHONE) {
    await page.locator('[data-view-picker]').click()
    await page.locator('[data-view-option]', { hasText: name }).click()
  } else await page.getByRole('button', { name, exact: true }).click()
}
await pick('Progress')
const expectFor = async (weeks) => {
  const listed = (await get(`/api/types/${habitType.id}/objects`)).filter((h) => !h.deletedAt)
  return habitReport(listed, weeks, today)
}
const pct = (t) => (t.expected ? `${Math.round((t.done / t.expected) * 100)}%` : '—')
async function checkNumbers(weeks, known) {
  const report = known ?? (await expectFor(weeks))
  const headline = `${pct(report.total)} ${report.total.done} of ${report.total.expected} done over ${weeks} weeks`
  await until(async () => (await text(main.locator('[data-progress-headline]')).catch(() => '')).startsWith(headline), `headline "${headline}"`)
  for (const row of report.habits) {
    const title = habits.find((h) => h.id === row.id)?.title
    if (!title) continue
    // A phone leaves out the "x of y" column (room for each habit's weeks): just the percent.
    const want = process.env.PHONE ? ` ${pct(row.total)}` : `${row.total.done} of ${row.total.expected} ${pct(row.total)}`
    await until(async () => (await text(main.locator('[data-progress-row]', { hasText: title }))).endsWith(want), `${title}: ${want}`)
  }
  if (report.total.done !== report.habits.reduce((s, r) => s + r.total.done, 0)) throw new Error('the total is not the sum of the habits')
  console.log(`  ${weeks} weeks: ${pct(report.total)} (${report.total.done} of ${report.total.expected})`)
}
await page.locator('[data-range="4"]').click()
await checkNumbers(4)
const rows = await main.locator('[data-progress-row]').allTextContents()
if (!process.env.PHONE && (!rows.at(-1).includes('Swim') || !rows.at(-1).includes('paused'))) throw new Error('paused habit not last')
if (!process.env.PHONE && !rows.some((r) => r.includes('3 a week'))) throw new Error('no "3 a week" goal')
await until(() => main.locator('[data-report-chart][data-chart="calendar"] [data-habit-days]').count(), 'the calendar')

step('range: 13 weeks, the person\'s own choice, kept on reload')
await page.locator('[data-range="13"]').click()
await checkNumbers(13)
// The switch is the Tracker's range too: kept with the account, for the Tracker and every device of theirs.
const mine = async () => ((await get('/api/auth/me')).preferences ?? {})[`type/${habitType.id}/habits`]
await until(async () => (await mine())?.weeks === 13, 'the range saved in the account')
if ((await get(`/api/types/${habitType.id}`)).habits?.weeks === 13) throw new Error('the range was saved on the type')
await page.reload()
await until(async () => (await page.locator('[data-range="13"]').getAttribute('aria-pressed').catch(() => null)) === 'true', '13 weeks kept')
await checkNumbers(13)

step('Progress: the chart is picked on the tab and saved in the account')
if (!(await main.locator('[data-progress-row] [data-habit-weeks] rect').count())) throw new Error('no weeks column')
if ((await page.locator('[data-chart-picker="progress"] [data-chart]').count()) !== 2) throw new Error('not exactly two charts')
for (const chart of ['line', 'calendar']) {
  await page.locator(`[data-chart-picker="progress"] [data-chart="${chart}"]`).click()
  await until(async () => (await main.locator(`[data-report-chart][data-chart="${chart}"]`).count()) === 1, `report chart ${chart}`)
  await until(async () => (await mine())?.chart === chart, `chart ${chart} saved in the account`)
  if (process.env.SHOTS) await main.locator('[data-habit-progress]').screenshot({ path: path.join(process.env.SHOTS, `habits-report-${chart}${process.env.PHONE ? '-phone' : ''}.png`) })
}
if (await page.getByText('did not take').count()) throw new Error('the server refused a change')

if (process.env.SHOTS) {
  await page.screenshot({ path: path.join(process.env.SHOTS, `habits-progress${process.env.PHONE ? '-phone' : ''}-light.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await sleep(300)
  await page.screenshot({ path: path.join(process.env.SHOTS, `habits-progress${process.env.PHONE ? '-phone' : ''}-dark.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

step('A habit page: Pause and Resume, and the same last-4-weeks number')
const read = habits.find((h) => h.title.startsWith('Read'))
await page.goto(`${base}/o/${read.id}`)
await page.locator('[data-habit-pauses]').waitFor()
const readRow = (await expectFor(4)).habits.find((r) => r.id === read.id)
await until(async () => (await text(main)).includes(`Last 4 weeks ${pct(readRow.total)}`), `the habit page says last 4 weeks ${pct(readRow.total)}`)
await page.locator('[data-habit-pause]').click()
await until(async () => (await get(`/api/objects/${read.id}`)).props[`pause:${today}`]?.value === '', 'pause saved from today')
await page.locator('[data-habit-resume]').click()
// A pause that began today never was.
await until(async () => !(`pause:${today}` in (await get(`/api/objects/${read.id}`)).props), 'resumed')

if (process.env.PHONE) {
  step('Phone: pick a past day, check it from the row, then return to today')
  await page.goto(`${base}/t/${habitType.id}?view=__tracker`)
  const row = main.locator('[data-habit-row]', { hasText: `Stretch ${tag}` })
  await until(() => row.count(), 'the phone row for Stretch')
  const stretch = habits.find((h) => h.title.startsWith('Stretch'))
  const picker = main.locator('[data-habit-rows] [data-habit-days]')
  const todayPick = picker.locator(`[data-habit-day="${today}"]`)
  if ((await todayPick.getAttribute('aria-pressed')) !== 'true') throw new Error('today not initially selected')
  const inView = await todayPick.evaluate((el) => {
    const cell = el.getBoundingClientRect()
    const strip = el.parentElement.getBoundingClientRect()
    return cell.left >= strip.left && cell.right <= strip.right + 1
  })
  if (!inView) throw new Error('today not initially visible')
  const missed = row.locator(`i[data-state="missed"]:not([data-day="${today}"])`)
  const day = await missed.first().getAttribute('data-day')
  await picker.locator(`[data-habit-day="${day}"]`).click()
  await row.locator('[data-habit-row-check]').click()
  await until(async () => (await get(`/api/objects/${stretch.id}`)).props[`done:${day}`]?.value === true, `${day} saved from the phone row`)
  const shots = async (name) => {
    if (!process.env.SHOTS) return
    for (const theme of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
      await sleep(300)
      await page.screenshot({ path: path.join(process.env.SHOTS, `habits-phone-${name}-${theme}.png`), fullPage: true })
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
  }
  await shots('past-day')
  await page.getByRole('button', { name: 'Back to today', exact: true }).click()
  await until(async () => (await todayPick.getAttribute('aria-pressed')) === 'true', 'back to today')
  if ((await row.locator('[data-habit-row-check]').getAttribute('aria-pressed')) !== 'false') throw new Error('the row check did not return to today')

  step('Phone: tap the ticks and check another past day in the sheet')
  await row.locator('[data-habit-ticks]').click()
  const sheet = page.locator('[data-habit-sheet]')
  await sheet.waitFor()
  if ((await sheet.locator('[data-habit-day]').count()) !== 14) throw new Error('not fourteen sheet checks')
  const cell = sheet.locator(`[data-state="missed"]:not([data-habit-day="${today}"])`).first()
  const sheetDay = await cell.getAttribute('data-habit-day')
  await cell.click()
  await until(async () => (await get(`/api/objects/${stretch.id}`)).props[`done:${sheetDay}`]?.value === true, `${sheetDay} saved from the sheet`)
  await shots('sheet')

  step('Phone: long press offers Done / Not done and cancel without a number field')
  const plainCell = sheet.locator(`[data-habit-day="${day}"]`)
  const press = () => plainCell.dispatchEvent('contextmenu')
  const dialog = page.locator('form', { hasText: /Done on/ })
  await press()
  await dialog.waitFor()
  if (await dialog.locator('input').count()) throw new Error('plain habit still asks for a number')
  await dialog.getByRole('button', { name: 'Not done', exact: true }).click()
  await until(async () => (await get(`/api/objects/${stretch.id}`)).props[`done:${day}`]?.value !== true, `${day} cleared from the choices`)
  await press()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  if ((await get(`/api/objects/${stretch.id}`)).props[`done:${day}`]?.value === true) throw new Error('cancel changed the day')
  if (!(await sheet.isVisible())) throw new Error('the sheet closed with the choices')
  await press()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await until(async () => (await get(`/api/objects/${stretch.id}`)).props[`done:${day}`]?.value === true, `${day} saved with Done`)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await sheet.waitFor({ state: 'detached' })
}

if (built) {
  step('offline reload: the same numbers from the device')
  const report = await expectFor(13)
  await page.goto(`${base}/t/${habitType.id}?view=__progress`)
  await checkNumbers(13, report)
  await sleep(1500)
  await context.setOffline(true)
  await page.reload()
  await page.waitForSelector('nav', { state: 'attached', timeout: 30000 })
  await checkNumbers(13, report)
  await context.setOffline(false)
}

if (problems.length) {
  console.log(problems.join('\n'))
  console.log(failedRequests.join('\n'))
  throw new Error('console problems')
}
if (process.env.PHONE) for (const h of habits) await page.request.delete(`${base}/api/objects/${h.id}`, { headers })
await context.close()
console.log('ok')
