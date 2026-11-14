// The phone shell (390×844, touch): the bottom bar (Home, Tasks, Inbox, Calendar, Search; the one
// you are on marked) and the Capture button above it; the side menu above both, its last row
// reachable; the top bar without Search, with the menu and, on an object's page, Back beside it; a
// popover as a sheet along the bottom with rows 44px high; the long-press menu as a sheet whose
// submenu slides in with a Back row; a tap on a sheet's dimmed area closes it without reaching the
// page underneath; the view picker's sheet; a task's fields folded into one line that opens; the
// last row clear of the bar; and on a desktop none of it.
//   node phone-shell.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const W = 390
const H = 844
const options = { viewport: { width: W, height: H }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-phone-shell-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
// Known noise, not this check's: WebKit's dev server chunk loads (and the route error they cause), linkify's late scheme warning.
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|Importing a module script failed|Uncaught error during route navigation|linkifyjs: already initialized/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const status = taskType.properties.find((p) => p.id === 'status')
const made = []
for (let i = 0; i < 14; i++) made.push(await post('/api/objects', { typeId: taskType.id, title: `Shell ${tag} ${String(i).padStart(2, '0')}`, props: { status: { kind: 'select', value: [status.options[0].id] } } }))
await sleep(1500)
const task = made[0]
const tabBar = page.locator('[data-tab-bar]')
const tab = (name) => tabBar.locator(`[data-tab="${name}"]`)
const bottomOf = async (locator) => {
  const box = await locator.boundingBox()
  return box.y + box.height
}

try {
  step('the bottom bar: five places, the one you are on marked; Search opens the palette')
  await page.goto(`${base}/inbox`)
  await tabBar.waitFor()
  const labels = (await tabBar.locator('[data-tab]').allInnerTexts()).map((t) => t.trim())
  if (labels.join() !== 'Home,Tasks,Inbox,Calendar,Search') throw new Error(`tabs: ${labels}`)
  if ((await tab('Inbox').getAttribute('aria-current')) !== 'page') throw new Error('Inbox not marked as the place you are on')
  for (const t of await tabBar.locator('[data-tab]').all()) if ((await t.boundingBox()).height < 44) throw new Error('a tab is under 44px')
  await tab('Tasks').click()
  await page.waitForURL(new RegExp(`/t/${taskType.id}`))
  await until(async () => (await tab('Tasks').getAttribute('aria-current')) === 'page', 'Tasks marked')
  await tab('Calendar').click()
  await page.waitForURL(/\/calendar/)
  await tab('Search').click()
  const search = page.getByPlaceholder('Search or create…')
  await search.waitFor()
  if (parseFloat(await search.evaluate((el) => getComputedStyle(el).fontSize)) < 16) throw new Error('the search box is under 16px (iOS zooms in)')
  await page.keyboard.press('Escape')

  step('Capture sits above the bar and opens quick capture')
  const capture = page.locator('[data-capture-button]')
  if ((await bottomOf(capture)) > (await tabBar.boundingBox()).y) throw new Error('Capture overlaps the bar')
  await capture.click()
  await until(async () => (await page.locator('[role=dialog]').count()) > 0, 'quick capture open')
  await page.keyboard.press('Escape')

  step('the side menu opens above the bar and Capture; its last row can be tapped; a tap outside closes it')
  await page.goto(`${base}/inbox`)
  await tabBar.waitFor()
  const barBox = await tabBar.boundingBox()
  const captureBox = await capture.boundingBox()
  await page.locator('[data-top-menu]').click()
  const drawer = page.locator('[data-drawer]')
  await until(async () => ((await drawer.boundingBox())?.x ?? -999) >= -1, 'the side menu slid in')
  await sleep(300)
  // What is on top at a point (document.elementFromPoint): the drawer or its backdrop, never the bar or Capture.
  const topAt = (x, y) =>
    page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py)
      return el?.closest('[data-tab-bar]') ? 'bar' : el?.closest('[data-capture-button]') ? 'capture' : el?.closest('[data-drawer]') ? 'drawer' : el?.closest('[data-drawer-backdrop]') ? 'backdrop' : 'other'
    }, [x, y])
  const barSpot = await topAt(W - 30, barBox.y + barBox.height / 2)
  if (barSpot !== 'backdrop') throw new Error(`the bar is not under the backdrop: ${barSpot}`)
  const captureSpot = await topAt(captureBox.x + captureBox.width / 2, captureBox.y + captureBox.height / 2)
  if (captureSpot !== 'backdrop') throw new Error(`Capture is not under the backdrop: ${captureSpot}`)
  const overBar = await topAt(100, barBox.y + barBox.height / 2)
  if (overBar !== 'drawer') throw new Error(`the bar covers the side menu: ${overBar}`)
  const trash = drawer.locator('a[title="Trash"]')
  const trashBox = await trash.boundingBox()
  if (trashBox.y + trashBox.height > H + 1) throw new Error('the side menu footer is off the screen')
  const trashSpot = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('a')?.getAttribute('title'), [trashBox.x + trashBox.width / 2, trashBox.y + trashBox.height / 2])
  if (trashSpot !== 'Trash') throw new Error(`the footer's Trash link is not hit-testable (got ${trashSpot})`)
  await page.touchscreen.tap(W - 20, 200)
  await until(async () => (await page.locator('[data-drawer-backdrop]').count()) === 0, 'a tap outside closes the side menu')

  step('the top bar: no Search on a phone; the menu stays, and Back joins it on an object page')
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main [data-view-picker]').waitFor()
  if ((await page.locator('header button[title^="Search"]').count()) !== 0) throw new Error('Search is still in the top bar')
  if ((await page.locator('[data-top-back]').count()) !== 0) throw new Error('Back on a list page')
  if ((await page.locator('[data-top-menu]').count()) !== 1) throw new Error('no menu button on a list page')
  await page.getByPlaceholder('Filter…').fill(`Shell ${tag}`)
  await page.locator(`main a[href="/o/${task.id}"]`).first().click()
  await page.waitForURL(new RegExp(`/o/${task.id}`))
  const menuBox = await page.locator('[data-top-menu]').boundingBox()
  const backBox = await page.locator('[data-top-back]').boundingBox()
  if (!menuBox || !backBox || menuBox.x > 8 || backBox.x < menuBox.x + menuBox.width - 1) throw new Error(`menu and Back not side by side, menu first: ${JSON.stringify([menuBox, backBox])}`)
  if (menuBox.width < 44 || backBox.width < 44) throw new Error('a top-bar button is under 44px')
  await page.locator('[data-top-back]').click()
  await page.waitForURL(new RegExp(`/t/${taskType.id}`))

  step('the view picker: one button, the views in a sheet')
  const picker = page.locator('[data-view-picker]')
  await picker.click()
  const options = page.locator('[data-view-option]')
  await until(async () => (await options.count()) >= 1, 'views listed')
  await options.filter({ hasText: /^\s*All\s*$/ }).click()
  await until(async () => (await picker.innerText()).includes('All'), 'the picker says All')
  await page.getByPlaceholder('Filter…').fill(`Shell ${tag}`)

  step('a popover is a sheet along the bottom, its rows 44px high')
  await page.locator('main button').filter({ hasText: /^\s*(List|Table)\s*$/ }).first().click()
  const sheet = page.locator('[data-sheet]')
  await sheet.waitFor()
  if (Math.abs((await bottomOf(sheet)) - H) > 2) throw new Error('the popover is not at the bottom')
  const rowHeight = await sheet.locator('button.w-full').first().evaluate((el) => el.getBoundingClientRect().height)
  if (rowHeight < 44) throw new Error(`sheet rows are ${rowHeight}px`)
  // A tap on the dimmed area closes the sheet and does not reach what is under the finger (the menu
  // button up top: reached, it would open the side menu).
  const under = await page.locator('[data-top-menu]').boundingBox()
  const urlBefore = page.url()
  await page.touchscreen.tap(under.x + under.width / 2, under.y + under.height / 2)
  await until(async () => (await sheet.count()) === 0, 'a tap above closes the sheet')
  await sleep(400)
  if (await page.locator('[data-drawer-backdrop]').count()) throw new Error('the tap that closed the sheet also opened the side menu under it')
  if (page.url() !== urlBefore) throw new Error(`the tap that closed the sheet also opened what was under it: ${page.url()}`)

  step('the long-press menu is a sheet; its submenu slides in with Back')
  const row = page.locator(`main a[href="/o/${task.id}"]`).first()
  await row.dispatchEvent('contextmenu', { clientX: 100, clientY: 300 })
  const menu = page.locator('[data-menu-sheet]')
  await menu.waitFor()
  if (Math.abs((await bottomOf(menu)) - H) > 2) throw new Error('the menu is not at the bottom')
  await menu.locator('button', { hasText: 'Pin to sidebar' }).click()
  await menu.locator('[data-menu-back]').waitFor()
  await menu.locator('[data-menu-back]').click()
  await menu.locator('button', { hasText: 'Open' }).first().waitFor()
  // The dimmed area closes it; the tap does not reach the menu button under the finger.
  const menuButton = await page.locator('[data-top-menu]').boundingBox()
  await page.touchscreen.tap(menuButton.x + menuButton.width / 2, menuButton.y + menuButton.height / 2)
  await until(async () => (await menu.count()) === 0, 'the menu closed')
  await sleep(400)
  if ((await page.locator('[data-drawer-backdrop]').count()) !== 0) throw new Error('the tap that closed the menu also opened the side menu')

  step('the last row clears the bar when scrolled to the end')
  await page.locator('main').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await sleep(400)
  const last = page.locator(`main a[href^="/o/"]`).last()
  if ((await bottomOf(last)) > (await tabBar.boundingBox()).y + 1) throw new Error('the last row is under the bar')

  step("a task's page: its fields folded into one line, opened by a tap")
  await page.goto(`${base}/o/${task.id}`)
  const summary = page.locator('[data-fields-summary]')
  await summary.waitFor()
  if ((await page.locator('[data-fields]').count()) !== 0) throw new Error('the fields are not folded')
  await summary.click()
  await page.locator('[data-fields]').waitFor()

  step('a desktop has none of it')
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main [role=button]').first().waitFor()
  if ((await tabBar.count()) || (await page.locator('[data-view-picker]').count())) throw new Error('phone parts on a desktop')
  await page.goto(`${base}/o/${task.id}`)
  await page.locator('[data-fields]').waitFor()
  if (await summary.count()) throw new Error('fields folded on a desktop')

  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`\nAll phone-shell checks passed for ${engine}.`)
} catch (error) {
  const shot = path.join(tmpdir(), `vasta-phone-shell-${engine}.png`)
  await page.screenshot({ path: shot }).catch(() => {})
  console.log('screenshot:', shot)
  if (problems.length) console.log(problems.join('\n'))
  throw error
} finally {
  for (const object of made) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
  await browser.close()
}
