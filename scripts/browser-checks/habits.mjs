// Habit progress in the test env: a daily habit, one on Mon/Wed/Fri, one 3 times a week and a paused
// one, with check-ins over the last weeks; then the Habits page: the weekly habit's "x of 3 this
// week" on Today, a day off faded in the Tracker, the Progress tab's headline and rows (checked
// against core's habitReport), the range switch kept on reload, and (on 5184, the built app) the
// same numbers after reloading offline. SHOTS=<dir> saves light and dark screenshots; PHONE=1 a 390px width (Today left out).
// The Tracker's own progress is checked too: the charts and the range are picked in Type settings
// (kept on the type, so they survive a reload), the place (above, beside, off) in its menu.
//   node habits.mjs [chromium|webkit] [base]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
import { addDays, habitReport, mondayOf } from '../../packages/core/src/index.ts'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
// Any 518x loopback port is a test env (5183/5184 the standard one; another may hold them).
if (!/^http:\/\/127\.0\.0\.1:518[3-9]$/.test(base)) throw new Error(`not the test env: ${base}`)
// The built app is served by the API server itself; a dev one by Vite (its page loads /@vite/client).
const built = !(await (await fetch(base)).text()).includes('/@vite/client')
const timezoneId = 'America/Toronto'

const options = { viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, locale: 'en-US', timezoneId }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-habits-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|404|TextSelection endpoint|due to access control checks|SQLITE_CORRUPT|Importing a module script failed|VUE_ROUTER_R0010|router.onError|Failed to fetch|ERR_INTERNET_DISCONNECTED|WebKit encountered an internal error|network/i.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => !/Importing a module script failed/.test(e.message) && problems.push(`pageerror: ${e.message}`))
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
  { title: 'Swim', props: { paused: { kind: 'checkbox', value: true }, ...done(week(2, 0)) } },
]
const habits = []
for (const spec of specs) habits.push(await post('/api/objects', { typeId: habitType.id, ...spec, title: process.env.PHONE ? `${spec.title} ${tag}` : spec.title }))

await page.evaluate((id) => localStorage.setItem('vasta.space', id), space.id)
await page.reload()
await page.waitForSelector('nav', { state: 'attached' })
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
await page.evaluate(() => {
  localStorage.removeItem('vasta.habit-progress.layout')
  localStorage.removeItem('vasta.habit-progress.place')
})
await page.goto(`${base}/t/${habitType.id}`)
if (process.env.PHONE) {
  await until(() => main.locator('[data-habit-row]', { hasText: 'Stretch' }).count(), 'the phone rows')
  const ticks = await main.locator('[data-habit-row]', { hasText: 'Stretch' }).locator('i[title*="day off"]').count()
  if (!ticks) throw new Error('no day-off tick for Mon/Wed/Fri')
  if (await main.locator('table').count()) throw new Error('a table on the phone')
} else {
  await until(() => main.locator('tr', { hasText: 'Stretch' }).count(), 'the Tracker')
  const stretchCells = main.locator('tr', { hasText: 'Stretch' }).locator('td')
  const faded = await stretchCells.evaluateAll((cells) => cells.filter((c) => c.querySelector('.opacity-40')).length)
  if (!faded) throw new Error('no faded day for Mon/Wed/Fri')
}

step('Tracker progress: day strip above by default, matching the report')
const listed4 = (await get(`/api/types/${habitType.id}/objects`)).filter((h) => !h.deletedAt)
const report4 = habitReport(listed4, 4, today)
const pct4 = report4.total.expected ? `${Math.round((report4.total.done / report4.total.expected) * 100)}%` : '—'
await until(async () => (await main.locator('[data-progress-strip][data-chart="days"]').count()) === 1, 'the day strip')
await until(async () => (await text(main.locator('[data-progress-strip] [data-progress-headline]'))).startsWith(`${pct4} over the last 4 weeks ${report4.total.done} of ${report4.total.expected} done`), `strip headline ${pct4}`)
// The place is the Tracker's menu; the charts and the range are Type settings, saved on the type.
const menu = async (selector) => {
  if (!(await page.locator('[data-progress-options]').isVisible().catch(() => false))) await main.locator('[data-progress-menu]').click()
  await page.locator(`[data-progress-options] ${selector}`).click()
}
const progressSettings = async (selector) => {
  await page.goto(`${base}/t/${habitType.id}?settings=1`)
  await page.locator(`[data-habit-progress-settings] ${selector}`).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => !(await page.locator('[data-habit-progress-settings]').count()), 'the settings saved')
}
for (const chart of ['weeks', 'meters', 'habits', 'days']) {
  await progressSettings(`[data-chart-picker="strip"] [data-chart="${chart}"]`)
  await until(async () => (await main.locator(`[data-progress-strip][data-chart="${chart}"]`).count()) === 1, `strip ${chart}`)
}
await menu('[data-place="beside"]')
await until(async () => (await main.locator('[data-progress-panel][data-chart="calendar"]').count()) === 1, 'the panel')
for (const chart of ['weeks', 'line', 'counts', 'calendar']) {
  await progressSettings(`[data-chart-picker="panel"] [data-chart="${chart}"]`)
  await until(async () => (await main.locator(`[data-progress-panel][data-chart="${chart}"]`).count()) === 1, `panel ${chart}`)
}
if (await main.locator('[data-progress-strip]').count()) throw new Error('strip and panel both shown')
await until(async () => (await text(main.locator('[data-progress-panel] [data-progress-headline]'))) === pct4, 'panel headline')
await page.keyboard.press('Escape')
if (process.env.SHOTS) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await sleep(300)
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-panel${process.env.PHONE ? '-phone' : ''}-${theme}.png`), fullPage: true })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

step('Tracker progress: the range is a Type setting too')
const report8 = habitReport(listed4, 8, today)
const pct8 = report8.total.expected ? `${Math.round((report8.total.done / report8.total.expected) * 100)}%` : '—'
await progressSettings('[data-weeks="8"]')
await until(async () => (await text(main.locator('[data-progress-panel] [data-progress-headline]'))) === pct8, `panel headline ${pct8}`)

await page.reload()
await until(async () => (await main.locator('[data-progress-panel][data-chart="calendar"]').count()) === 1, 'the panel kept on reload')
await menu('[data-place="off"]')
await until(async () => !(await main.locator('[data-progress-panel], [data-progress-strip]').count()), 'progress off')
await menu('[data-place="above"]')
await until(async () => (await main.locator('[data-progress-strip][data-chart="days"]').count()) === 1, 'back to the day strip')
await page.keyboard.press('Escape')
if (process.env.SHOTS) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await sleep(300)
    await page.screenshot({ path: path.join(process.env.SHOTS, `habits-strip${process.env.PHONE ? '-phone' : ''}-${theme}.png`), fullPage: true })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

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
    const want = `${row.total.done} of ${row.total.expected} ${pct(row.total)}`
    await until(async () => (await text(main.locator('[data-progress-row]', { hasText: title }))).endsWith(want), `${title}: ${want}`)
  }
  if (report.total.done !== report.habits.filter((r) => !r.paused).reduce((s, r) => s + r.total.done, 0)) throw new Error('paused habit in the total')
  console.log(`  ${weeks} weeks: ${pct(report.total)} (${report.total.done} of ${report.total.expected})`)
}
await page.locator('[data-range="4"]').click()
await checkNumbers(4)
const rows = await main.locator('[data-progress-row]').allTextContents()
if (!process.env.PHONE && (!rows.at(-1).includes('Swim') || !rows.at(-1).includes('paused'))) throw new Error('paused habit not last')
if (!process.env.PHONE && !rows.some((r) => r.includes('3 a week'))) throw new Error('no "3 a week" goal')
await until(() => page.locator('svg[aria-label="Share done each week"] path').count(), 'the weekly bars')

step('range: 13 weeks, kept on reload')
await page.locator('[data-range="13"]').click()
await checkNumbers(13)
await page.reload()
await until(async () => (await page.locator('[data-range="13"]').getAttribute('aria-pressed').catch(() => null)) === 'true', '13 weeks kept')
await checkNumbers(13)

if (process.env.SHOTS) {
  await page.screenshot({ path: path.join(process.env.SHOTS, `habits-progress${process.env.PHONE ? '-phone' : ''}-light.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await sleep(300)
  await page.screenshot({ path: path.join(process.env.SHOTS, `habits-progress${process.env.PHONE ? '-phone' : ''}-dark.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

if (built) {
  step('offline reload: the same numbers from the device')
  const report = await expectFor(13)
  await sleep(1500)
  await context.setOffline(true)
  await page.reload()
  await page.waitForSelector('nav', { state: 'attached', timeout: 30000 })
  await checkNumbers(13, report)
  await context.setOffline(false)
}

if (problems.length) {
  console.log(problems.join('\n'))
  throw new Error('console problems')
}
if (process.env.PHONE) for (const h of habits) await page.request.delete(`${base}/api/objects/${h.id}`, { headers })
console.log('ok')
await browser.close()
