// Back on a phone (390×844, touch) with something open over the page: the row menu (a submenu
// first steps back to the menu), a quick action's question (Defer), the Filters sheet, the side
// menu, Review tasks and its chooser, and Quick capture (its text kept as the draft) each close, and the page
// and its address stay; with nothing open Back leaves the page as before. A sheet's grabber pulled
// down closes it, a small pull springs back. Quick capture saves with no connection (the replica
// takes it; not in MODE=json, where it needs the server).
//   node phone-back.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const json = process.env.MODE === 'json'

const options = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-phone-back-')), options)
const browser = launched ?? context
if (json) await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
// Known noise, not this check's (as in phone-rows), and the failed requests while offline.
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|Failed to load resource|Load failed|Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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

/** The browser's Back (as the edge swipe does), then time for the router to put the entry back. */
async function back() {
  await page.evaluate(() => history.back())
  await sleep(700)
}
const where = () => page.evaluate(() => location.pathname + location.search)
const gone = (selector, what) => until(async () => (await page.locator(selector).count()) === 0, what)
async function stays(selector, what) {
  await sleep(400)
  if ((await page.locator(selector).count()) === 0) throw new Error(what)
}
/** Pull a sheet's grabber down by `dy` px over `ms` (a mouse drag: pointer events, as a finger gives). */
async function pull(dy, ms) {
  const box = await page.locator('[data-sheet-grabber]').first().boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = Math.max(2, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps)
    await sleep(16)
  }
  await sleep(150) // let go after a pause: judged by distance, not as a flick
  await page.mouse.up()
}

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const task = await post('/api/objects', { typeId: taskType.id, title: `PhoneBack ${tag}` })
const listPath = `/t/${taskType.id}`
const row = page.locator(`main a[href="/o/${task.id}"]`).first()
const menuSheet = '[data-menu-sheet]'
const askSheet = '[data-quick-ask-sheet]'
const sheet = '[data-sheet]'
await sleep(1500) // the replica pulls it

try {
  step('a list opened from Home, so Back has somewhere to go')
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => (await where()).startsWith(listPath), 'the Tasks list')
  await row.waitFor()
  const list = await where()

  step('Back with the row menu open closes it; the list stays')
  const openMenu = async () => {
    const box = await row.boundingBox()
    await row.dispatchEvent('contextmenu', { clientX: 100, clientY: box.y + box.height / 2 })
    await page.locator(menuSheet).waitFor()
  }
  await openMenu()
  await back()
  await gone(menuSheet, 'Back closes the row menu')
  if ((await where()) !== list) throw new Error(`Back with the row menu open left the list: ${await where()}`)

  const submenu = page.locator(`${menuSheet} [aria-haspopup=menu]`).first()
  await openMenu()
  if (await submenu.count()) {
    step('Back in a submenu steps back to the menu, a second Back closes it')
    await submenu.click()
    await page.locator('[data-menu-back]').waitFor()
    await back()
    await gone('[data-menu-back]', 'Back leaves the submenu')
    await stays(menuSheet, 'Back in a submenu closed the whole menu')
    await back()
    await gone(menuSheet, 'the second Back closes the menu')
  } else await back()

  step('Back with Defer asking closes the question, saves nothing; the list stays')
  await openMenu()
  await page.locator(`${menuSheet} button`, { hasText: /^\s*Defer…\s*$/ }).click()
  await page.locator(askSheet).waitFor()
  await back()
  await gone(askSheet, 'Back closes the Defer sheet')
  if ((await where()) !== list) throw new Error(`Back with Defer open left the list: ${await where()}`)
  if ((await get(`/api/objects/${task.id}`)).props.due?.value) throw new Error('Back deferred the task')

  step('the Filters sheet: Back closes it; the grabber pulled a little springs back, pulled far closes it')
  await page.locator('[data-filters-button]').click()
  await page.locator(sheet).waitFor()
  await back()
  await gone(sheet, 'Back closes the Filters sheet')
  if ((await where()) !== list) throw new Error(`Back with Filters open left the list: ${await where()}`)
  await page.locator('[data-filters-button]').click()
  await page.locator(sheet).waitFor()
  await pull(30, 300)
  await stays(sheet, 'a small pull on the grabber closed the sheet')
  const transform = await page.locator(sheet).evaluate((el) => el.style.transform)
  if (transform) throw new Error(`the sheet did not spring back: ${transform}`)
  await pull(220, 300)
  await gone(sheet, 'pulling the grabber down closes the sheet')

  step('the row menu and Defer close by the grabber too')
  await openMenu()
  await pull(220, 300)
  await gone(menuSheet, 'pulling the row menu down closes it')
  await openMenu()
  await page.locator(`${menuSheet} button`, { hasText: /^\s*Defer…\s*$/ }).click()
  await page.locator(askSheet).waitFor()
  await pull(220, 300)
  await gone(askSheet, 'pulling the Defer sheet down closes it')

  step('Back with the side menu open closes it; the list stays')
  await page.locator('[data-top-menu]').click()
  await page.locator('[data-drawer-backdrop]').waitFor()
  await back()
  await gone('[data-drawer-backdrop]', 'Back closes the side menu')
  if ((await where()) !== list) throw new Error(`Back with the side menu open left the list: ${await where()}`)

  step('Review tasks: Back closes its chooser (from ⋯), then the review itself (paused, the button says Resume); the list stays')
  const chooser = async () => {
    await page.locator('main header button[title="More"]').click()
    await page.locator('[data-workflows]').click()
    await page.locator('[data-start-review]').waitFor()
  }
  await chooser()
  await back()
  await gone('[data-start-review]', 'Back closes the Review tasks chooser')
  if ((await where()) !== list) throw new Error(`Back with the chooser open left the list: ${await where()}`)
  await chooser()
  await page.locator('[data-start-review]').click()
  await page.locator('[data-process-mode]').waitFor()
  await back()
  await gone('[data-process-mode]', 'Back closes the review')
  if ((await where()) !== list) throw new Error(`Back in the review left the list: ${await where()}`)
  await until(async () => /Resume/.test(await page.locator('[data-review-tasks]').innerText()), 'the Review button offers Resume')
  await page.locator('[data-review-tasks]').click()
  await page.locator('[data-process-mode]').waitFor()
  await back()
  await gone('[data-process-mode]', 'Back closes the resumed review')

  step('Back with Quick capture open closes it and keeps the text as the draft')
  await page.locator('[data-capture-button]').click()
  const field = page.locator('[role=dialog][aria-label="Quick capture"] textarea').first()
  await field.fill(`Draft ${tag}`)
  await back()
  await gone('[role=dialog][aria-label="Quick capture"]', 'Back closes Quick capture')
  if ((await where()) !== list) throw new Error(`Back with Quick capture open left the list: ${await where()}`)
  await page.locator('[data-capture-button]').click()
  if ((await field.inputValue()) !== `Draft ${tag}`) throw new Error(`the draft was not kept: "${await field.inputValue()}"`)

  if (!json) {
    step('with no connection, Quick capture saves on this device (no code error)')
    await context.setOffline(true)
    await field.fill(`Offline ${tag}`)
    await page.locator('button', { hasText: /^\s*Save capture\s*$/ }).click()
    await gone('[role=dialog][aria-label="Quick capture"]', 'the offline capture saved and closed')
    await context.setOffline(false)
    await until(async () => (await get(`/api/spaces/${space.id}/search?q=${encodeURIComponent(`Offline ${tag}`)}&limit=5`)).length || (await get(`/api/spaces/${space.id}/inbox?today=${new Date().toISOString().slice(0, 10)}`)).items?.some((i) => JSON.stringify(i.content).includes(`Offline ${tag}`)), 'the offline capture reached the server', 20000)
  } else {
    await page.locator('[role=dialog][aria-label="Quick capture"] button', { hasText: /^\s*Cancel\s*$/ }).first().click()
  }

  step('with nothing open, Back leaves the list as before')
  await back()
  await until(async () => !(await where()).startsWith(listPath), 'Back leaves the list')

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll phone-back checks passed for ${engine}${json ? ' (MODE=json)' : ''}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-phone-back-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  await context.setOffline(false).catch(() => {})
  await page.request.delete(`${base}/api/objects/${task.id}`, { headers }).catch(() => {})
  await browser.close()
}
