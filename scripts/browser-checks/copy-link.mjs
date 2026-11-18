// "Copy link to page" in the test env: the action in the sidebar right-click menu, the right-click
// menu of a type view and query results, and the ⋯ More menu of an object's page and side pane;
// the browser and simulated desktop URL formats; clipboard rejection (the copy command, else the link
// offered to copy by hand); and that existing block-link
// copying and normal link navigation are unchanged.
//   node copy-link.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-copy-link-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
// The clipboard needs permissions the engines grant differently; keep what is copied instead.
await context.addInitScript(() => {
  if (navigator.clipboard) navigator.clipboard.writeText = async (text) => void (window.__copied = text)
})
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
      const shot = path.join(tmpdir(), `vasta-copy-link-${engine}.png`)
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

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const taskType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')

// Clean up objects from an earlier failed run.
for (const object of await get(`/api/spaces/${space.id}/search?q=CopyLink&limit=20`)) {
  await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}

// Make a test object.
const created = await post('/api/objects', { typeId: taskType.id, title: `CopyLink ${tag}` })
// The sidebar lists what is pinned: put the object in its first section.
const sidebar = space.sidebar.length ? space.sidebar : [{ id: 'pinned', name: 'Pinned', items: [] }]
await put(`/api/spaces/${space.id}`, { ...space, sidebar: sidebar.map((section, i) => (i === 0 ? { ...section, items: [...section.items, created.id] } : section)) })
await page.reload()
await page.waitForSelector('nav', { timeout: 30000 })
const copied = () => page.evaluate(() => window.__copied)
const clearCopied = () => page.evaluate(() => { window.__copied = undefined })
const expectedLink = `${base}/o/${created.id}`
const expectedDesktop = `vasta://o/${created.id}`
const errorText = () => page.locator('[data-error-banner]').textContent().catch(() => '')

// ---------------------------------------------------------------------------
step('sidebar right-click menu copies the object link')
await clearCopied()
const sidebarRow = page.locator('nav a', { hasText: `CopyLink ${tag}` })
await sidebarRow.click({ button: 'right' })
await page.waitForSelector('[role=menu]')
await page.click('[role=menu] button:has-text("Copy link to page")')
const sidebarLink = await until(() => copied(), 'sidebar copied link')
if (sidebarLink !== expectedLink) throw new Error(`sidebar link: ${sidebarLink}, expected ${expectedLink}`)
// The success notice should appear.
await until(async () => (await page.locator('[role=status]', { hasText: 'Link to the page copied' }).count()) > 0, 'success toast after sidebar copy')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------------------
step('type view right-click menu copies the object link')
await clearCopied()
await page.goto(`${base}/t/${taskType.id}`)
await page.waitForSelector('main')
// Find the object in the list and right-click it.
const typeRow = page.locator('main').getByText(`CopyLink ${tag}`).first()
await typeRow.click({ button: 'right' })
await page.waitForSelector('[role=menu]')
await page.click('[role=menu] button:has-text("Copy link to page")')
const typeLink = await until(() => copied(), 'type view copied link')
if (typeLink !== expectedLink) throw new Error(`type view link: ${typeLink}, expected ${expectedLink}`)
await page.keyboard.press('Escape')

// ---------------------------------------------------------------------------
step('object page ⋯ More menu copies the object link')
await clearCopied()
await page.goto(`${base}/o/${created.id}`)
await page.waitForSelector('textarea[data-large-text]')
await page.click('button[title="More"]')
await page.click('[data-overlay] button:has-text("Copy link to page")')
const pageLink = await until(() => copied(), 'page More menu copied link')
if (pageLink !== expectedLink) throw new Error(`page More link: ${pageLink}, expected ${expectedLink}`)

// ---------------------------------------------------------------------------
step('side pane ⋯ More copies the pane object, not the page')
// Set the type to open in pane so the object opens in the side pane.
const type = await get(`/api/types/${taskType.id}`)
await put(`/api/types/${taskType.id}`, { ...type, openIn: 'pane' })
// A second object, listed beside the first: the pane must copy the one it shows, not another.
const pageObject = await post('/api/objects', { typeId: taskType.id, title: `CopyLink Page ${tag}` })
await clearCopied()
await page.goto(`${base}/t/${taskType.id}`)
await page.waitForSelector('main')
// A click on a row of the list opens it where its type says: the side pane.
await page.locator('main a', { hasText: `CopyLink ${tag}` }).first().click()
await until(async () => (await page.locator('[data-side-pane]').count()) > 0, 'side pane open')
// Now use the ⋯ More menu in the side pane.
const paneMore = page.locator('[data-side-pane] button[title="More"]')
await paneMore.click()
await page.click('[data-overlay] button:has-text("Copy link to page")')
const paneLink = await until(() => copied(), 'pane More menu copied link')
if (paneLink !== expectedLink) throw new Error(`pane link: ${paneLink}, expected ${expectedLink}`)
// The pane link should be for the pane object, not the underlying page.
if (paneLink.includes(pageObject.id)) throw new Error(`pane link copied the page object: ${paneLink}`)
// Reset the type's openIn.
await put(`/api/types/${taskType.id}`, { ...type, openIn: undefined })

// ---------------------------------------------------------------------------
step('simulated desktop app copies vasta:// URL')
await clearCopied()
await page.goto(`${base}/o/${created.id}`)
await page.waitForSelector('textarea[data-large-text]')
// Pretend we are in the desktop app (after the page loaded: a navigation drops it).
await page.evaluate(() => { window.__TAURI_INTERNALS__ = {} })
await page.click('button[title="More"]')
await page.click('[data-overlay] button:has-text("Copy link to page")')
const desktopLink = await until(() => copied(), 'desktop copied link')
if (desktopLink !== expectedDesktop) throw new Error(`desktop link: ${desktopLink}, expected ${expectedDesktop}`)
// Clean up the simulated desktop flag.
await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })

// ---------------------------------------------------------------------------
step('clipboard API refused: the older copy command takes over')
await clearCopied()
await page.goto(`${base}/o/${created.id}`)
await page.waitForSelector('textarea[data-large-text]')
// writeText refuses (as on a plain-http address); keep what the copy command copies.
await page.evaluate(() => {
  navigator.clipboard.writeText = async () => { throw new Error('denied') }
  document.execCommand = (command) => {
    if (command !== 'copy') return false
    window.__copied = document.querySelector('body > textarea[readonly]')?.value
    return true
  }
})
const copyFromMenu = async () => {
  await page.click('button[title="More"]')
  await page.click('[data-overlay] button:has-text("Copy link to page")')
}
await copyFromMenu()
const fallbackCopied = await until(() => page.evaluate(() => window.__copied), 'link copied by the copy command')
if (fallbackCopied !== `${base}/o/${created.id}`) throw new Error(`copy command copied: ${fallbackCopied}`)
await until(async () => (await page.locator('[role=status]:has-text("Link to the page copied")').count()) > 0, 'copied notice after the copy command')

step('nothing copies: a box shows the link to copy by hand')
await page.evaluate(() => {
  document.execCommand = () => false
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
})
const shown = new Promise((resolve) => page.once('dialog', async (dialog) => {
  resolve(dialog.defaultValue())
  await dialog.dismiss()
}))
await copyFromMenu()
const offered = await shown
if (offered !== `${base}/o/${created.id}`) throw new Error(`link offered by hand: ${offered}`)

// ---------------------------------------------------------------------------
step('existing block-link copying still works')
// Restore the clipboard mock.
await context.addInitScript(() => {
  if (navigator.clipboard) navigator.clipboard.writeText = async (text) => void (window.__copied = text)
})
await page.reload()
await page.waitForSelector('textarea[data-large-text]')
// Type some text, select a block, and copy its link.
await page.click('.vasta-doc')
await page.keyboard.type('Block link test')
await page.keyboard.press('Escape')
await page.waitForSelector('.vasta-block-selected')
// Right-click the block for its menu (the handle shows only on hover).
await page.locator('.vasta-doc p', { hasText: 'Block link test' }).click({ button: 'right' })
await page.waitForSelector('[role=menu]')
await clearCopied()
await page.click('[role=menu] button:has-text("Copy link to block")')
const blockLink = await until(() => copied(), 'block link copied')
if (!blockLink.startsWith(`${base}/o/${created.id}#b-`)) throw new Error(`unexpected block link: ${blockLink}`)

// ---------------------------------------------------------------------------
step('normal link navigation still works')
// Click the type chip in the object page header to navigate.
await page.goto(`${base}/o/${created.id}`)
await page.waitForSelector('textarea[data-large-text]')
const typeChip = page.locator('a[href^="/t/"]').first()
await typeChip.click()
await until(() => page.url().startsWith(`${base}/t/`), 'navigated to type page')

console.log(`\nAll copy-link checks passed for ${engine}.`)

await browser.close()
