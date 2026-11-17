// Back between pages on a phone (390×844, touch): a list comes back scrolled where it was left and
// a page opened starts at its top; an edge swipe (the page sees a touch start at the left edge just
// before Back) leaves the page and opens no side menu, while a swipe left on the open menu still
// closes it; the object sheet costs no history step to read and close (a task opened from Search or
// the row menu is in it too, and Back closes it); the place showing tapped again in the bottom bar adds no step for Back (Calendar goes
// back to today, a list to its top); the bottom bar's optional Menu opens the side menu.
//   node phone-history.mjs [chromium|webkit] [base]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-phone-history-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
// Known noise, not this check's; headless WebKit's replica storage sometimes fails to open (older than this check).
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|Failed to load resource|Working without a local replica: Error: SQLITE_CORRUPT/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
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
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()

const where = () => page.evaluate(() => location.pathname + location.search)
const steps = () => page.evaluate(() => history.length)
const scrolled = () => page.evaluate(() => document.querySelector('main').scrollTop)
const scrollTo = (top) => page.evaluate((top) => (document.querySelector('main').scrollTop = top), top)
/** A click in a list opens the task in the sheet; "Open full page" takes its place in history, so one Back returns to the list. */
const openFull = async (href) => {
  await page.locator(`main a[href="${href}"]`).first().click()
  await page.locator('[data-popup]').getByTitle('Open full page').click()
}
const drawerOpen = async () => (await page.locator('[data-drawer-backdrop]').count()) > 0
async function back() {
  await page.evaluate(() => history.back())
  await sleep(700)
}
/** Touches as the page sees a swipe: a start at `from`, the finger lifting at `to` (x, px). */
const swipe = (from, to) => page.evaluate(({ from, to }) => {
  const root = document.querySelector('main').closest('.flex.h-full.flex-col')
  const fire = (type, x) => {
    const event = new Event(type, { bubbles: true })
    const touches = [{ clientX: x, clientY: 450 }]
    Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? touches : [] })
    Object.defineProperty(event, 'changedTouches', { value: touches })
    root.dispatchEvent(event)
  }
  fire('touchstart', from)
  fire('touchend', to)
}, { from, to })

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const tasks = []
for (let i = 0; i < 40; i++) tasks.push(await post('/api/objects', { typeId: taskType.id, title: `PhoneHistory ${tag} ${String(i).padStart(2, '0')}` }))
const listPath = `/t/${taskType.id}`
await sleep(2000) // the replica pulls them

try {
  step('a list scrolled down, a task opened from it starts at its top, Back returns to the same place')
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => (await where()).startsWith(listPath), 'the Tasks list')
  await page.locator(`main a[href="/o/${tasks[39].id}"]`).first().waitFor()
  await scrollTo(1200)
  const left = await scrolled()
  if (left < 1000) throw new Error(`the list is too short to scroll: ${left}`)
  const visible = await page.evaluate(() => {
    const top = document.querySelector('main').getBoundingClientRect().top
    return [...document.querySelectorAll('main a[href^="/o/"]')].find((a) => a.getBoundingClientRect().top > top + 40)?.getAttribute('href')
  })
  await openFull(visible)
  await until(async () => (await where()).startsWith('/o/'), 'the task page')
  await sleep(500)
  if ((await scrolled()) !== 0) throw new Error(`the task page opened scrolled: ${await scrolled()}`)
  await back()
  await until(async () => (await where()).startsWith(listPath), 'Back to the list')
  await until(async () => Math.abs((await scrolled()) - left) <= 2, `the list back at ${left} (is ${await scrolled()})`, 4000)

  step('an edge swipe: the page sees the touch, then Back; it leaves the task and opens no side menu')
  await openFull(visible)
  await until(async () => (await where()).startsWith('/o/'), 'the task page')
  await sleep(500)
  await swipe(4, 300)
  if (await drawerOpen()) throw new Error('a swipe from the left edge opened the side menu')
  await back()
  await until(async () => (await where()).startsWith(listPath), 'the edge swipe went back to the list')
  if (await drawerOpen()) throw new Error('the side menu is open after the edge swipe')

  step('a swipe left on the open side menu still closes it')
  await page.locator('[data-top-menu]').click()
  await page.locator('[data-drawer-backdrop]').waitFor()
  await swipe(250, 100)
  await until(async () => !(await drawerOpen()), 'the swipe left closes the side menu')

  step('the object sheet: reading three tasks (closed by X, Escape and a tap outside) costs no step; one Back leaves the list')
  await page.locator('[data-tab="Home"]').click()
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => (await where()).startsWith(listPath), 'the Tasks list, reached inside the app')
  const listAt = await where()
  const position = () => page.evaluate(() => history.state.position)
  const startAt = await position()
  const rows = page.locator('main a[href^="/o/"]')
  const sheet = page.locator('[data-popup]')
  const read = async (index, close) => {
    await rows.nth(index).click()
    await sheet.waitFor()
    if ((await position()) !== startAt + 1) throw new Error(`opening the sheet took ${(await position()) - startAt} steps`)
    await close()
    await until(async () => (await sheet.count()) === 0, 'the sheet closed')
    await sleep(400)
    if ((await position()) !== startAt || (await where()) !== listAt) throw new Error(`closing the sheet left step ${await position()} (${await where()}), not the list at ${startAt}`)
  }
  await read(0, () => sheet.getByTitle('Close').click())
  await read(1, () => page.keyboard.press('Escape'))
  await read(2, () => page.mouse.click(195, 20))
  await back()
  await until(async () => !(await where()).startsWith(listPath), 'one Back left the list (the sheet did not come back)')
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => (await where()).startsWith(listPath), 'the Tasks list again')

  step('the sheet is also where Search and the row menu open a task; Back closes it and stays')
  const listNow = await where()
  await page.locator('[data-tab="Search"]').click()
  await page.locator('input[placeholder="Search or create…"]').fill(`PhoneHistory ${tag} 05`)
  await page.locator('[data-bottom-sheet-backdrop], .fixed button', { hasText: `PhoneHistory ${tag} 05` }).first().click()
  await sheet.waitFor()
  if (!(await where()).startsWith(listPath) || !(await where()).includes('popup=')) throw new Error(`a Search result did not open in the sheet: ${await where()}`)
  await back()
  await until(async () => (await sheet.count()) === 0 && (await where()) === listNow, 'Back closed the sheet from Search')
  const row = page.locator(`main a[href="/o/${tasks[5].id}"]`).first()
  await row.waitFor()
  const box = await row.boundingBox()
  await row.dispatchEvent('contextmenu', { clientX: 100, clientY: box.y + box.height / 2 })
  await page.locator('[data-menu-sheet] button', { hasText: /^\s*Open\s*$/ }).click()
  await sheet.waitFor()
  await back()
  await until(async () => (await sheet.count()) === 0 && (await where()) === listNow, 'Back closed the sheet from the row menu')

  step('Tasks tapped on Tasks: to the top, no step for Back')
  await scrollTo(800)
  let before = await steps()
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => (await scrolled()) === 0, 'the list scrolled to its top')
  if ((await steps()) !== before || !(await where()).startsWith(listPath)) throw new Error(`Tasks again added a step or left: ${await where()}`)

  step('Home tapped on the start page: no step for Back')
  await page.locator('[data-tab="Home"]').click()
  await until(async () => (await where()) !== '/' && !(await where()).startsWith(listPath), 'the start page')
  await sleep(800)
  const home = await where()
  before = await steps()
  await page.locator('[data-tab="Home"]').click()
  await sleep(800)
  if ((await steps()) !== before || (await where()) !== home) throw new Error(`Home again added a step or moved: ${await where()}`)

  step('Calendar tapped on another day: back to today, no step for Back')
  await page.locator('[data-tab="Calendar"]').click()
  await until(async () => (await where()).startsWith('/calendar'), 'the calendar')
  await page.locator('main button[title^="Next"], main button[aria-label^="Next"]').first().click()
  await until(async () => (await where()).includes('date='), 'another day')
  before = await steps()
  await page.locator('[data-tab="Calendar"]').click()
  await until(async () => (await where()) === '/calendar', 'Calendar again goes to today')
  if ((await steps()) !== before) throw new Error('Calendar again added a step')

  step('Menu in the bottom bar opens the side menu')
  // Headless WebKit stalls on Settings (as in page-width.mjs): there the choice is stored and the app reloaded.
  const me = (await get('/api/auth/me')).id
  if (engine === 'webkit') {
    await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { 'phone-menu': ['home', 'tasks', 'inbox', 'calendar', 'menu'] } } })
    await page.reload()
    await page.waitForSelector('main', { timeout: 30000 })
  } else {
    await page.locator('[data-top-menu]').click()
    await page.locator('[data-drawer] a[href="/settings"]').click()
    await until(async () => (await where()) === '/settings' && !(await drawerOpen()), 'Settings')
    await page.locator('[aria-label="Remove Search"]').click()
    await page.locator('[aria-label="Add phone menu item"]').selectOption('menu')
  }
  await page.locator('[data-tab="Menu"]').click()
  await page.locator('[data-drawer-backdrop]').waitFor()
  await back()
  await until(async () => !(await drawerOpen()), 'Back closes the side menu')
  await page.request.put(`${base}/api/auth/me`, { headers, data: { preferences: { 'phone-menu': null } } })

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll phone-history checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-phone-history-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  for (const task of tasks) await page.request.delete(`${base}/api/objects/${task.id}`, { headers }).catch(() => {})
  await browser.close()
}
