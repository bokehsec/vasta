// Walk the app's screens with the local replica (test env only): no errors, same data as the server,
// trash and Undo, search, a second tab (no replica there), logout.
import { testArgs, testContext } from './test-env.mjs'

const { engine, base } = testArgs()
const context = await testContext(engine)
const page = await context.newPage()
const problems = []
const watch = (p, name) => {
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|Service Worker registration blocked by Playwright|linkifyjs: already initialized - will not register custom scheme "message"/.test(m.text()) && problems.push(`${name} ${m.type()}: ${m.text()}`))
  p.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`))
}
watch(page, 'tab1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      throw new Error(`timed out: ${what}`)
    }
    await sleep(250)
  }
}
const get = async (url) => (await page.request.get(`${base}${url}`)).json()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })
await page.waitForURL((url) => url.pathname !== '/')
await page.locator('main h1').first().waitFor()
await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
const spaces = await get('/api/spaces')
const space = spaces[0]
const bundle = await get(`/api/spaces/${space.id}`)

step('every type page lists what the server lists')
for (const type of bundle.types.filter((t) => bundle.counts[t.id]).slice(0, 6)) {
  await page.goto(`${base}/t/${type.id}`)
  const server = await get(`/api/types/${type.id}/objects`)
  await until(async () => (await page.textContent('main')).includes(server[0].title || ''), `type ${type.name} shows its objects`)
  console.log(`  ${type.name}: ${server.length} objects`)
}

step('home, inbox, calendar, trash, settings render')
for (const path of ['/', '/inbox', '/calendar', '/trash', '/settings']) {
  await page.goto(`${base}${path}`)
  if (path === '/') await page.waitForURL((url) => url.pathname !== '/')
  // A document's load event precedes Vue's lazy route and its data, especially on WebKit.
  await page.locator('main h1').first().waitFor()
  await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
  if (!(await page.textContent('main')).trim()) throw new Error(`${path} is empty`)
}

step('⌘K pressed while the app loads opens the palette once it is ready')
const target = (await get(`/api/spaces/${space.id}/search?q=&limit=5`)).find((o) => o.title)
// checkSession awaits auth/me in both modes. Keep it held until after the key, even when
// Vite's module loading or WebKit takes longer than a fixed delay.
let release
let held = false
const gate = new Promise((resolve) => (release = resolve))
await page.route('**/api/auth/me', async (route) => {
  held = true
  await gate
  await route.continue()
})
const paletteInput = page.locator('input[placeholder="Search or create…"]')
try {
  await page.goto(base)
  await until(() => held, 'auth/me held')
  await page.getByText('Loading…', { exact: true }).waitFor()
  if (await page.locator('nav').count()) throw new Error('the app was ready before the key went in')
  await page.keyboard.press('Meta+k')
  if (await paletteInput.count()) throw new Error('the palette mounted before the workspace was ready')
} finally {
  release()
}
await until(async () => (await paletteInput.count()) > 0, 'the palette opens when the app is ready')
await until(async () => (await paletteInput.evaluate((el) => document.activeElement === el)), 'the palette has the focus')
await page.unroute('**/api/auth/me')
await paletteInput.fill(target.title.slice(0, 6))
await until(async () => (await page.textContent('body')).includes(target.title), `palette finds ${target.title}`)
await page.keyboard.press('Escape')

step('move to the trash and undo')
const pageType = bundle.types.find((t) => t.system === 'page')
const victim = await (await page.request.post(`${base}/api/objects`, { headers: { 'x-requested-with': 'vasta' }, data: { typeId: pageType.id, title: 'Trash me' } })).json()
await sleep(1500)
await page.goto(`${base}/o/${victim.id}`)
await page.waitForSelector('textarea[data-large-text]')
await page.locator('article button[title="More"]').first().click()
await page.locator('button', { hasText: 'Move to trash' }).click()
await until(async () => (await get(`/api/objects/${victim.id}`)).deletedAt, 'deleted on the server')
await page.locator('[role=status] button', { hasText: 'Undo' }).click()
await until(async () => !(await get(`/api/objects/${victim.id}`)).deletedAt, 'restored on the server')

step('a second tab works too (straight to the server) and both see each other’s edits')
const second = await context.newPage()
watch(second, 'tab2')
await second.goto(`${base}/o/${victim.id}`)
await second.waitForSelector('textarea[data-large-text]', { timeout: 20000 })
await page.goto(`${base}/o/${victim.id}`)
await page.waitForSelector('textarea[data-large-text]')
await second.fill('textarea[data-large-text]', 'Renamed in tab 2')
await until(async () => (await page.inputValue('textarea[data-large-text]')) === 'Renamed in tab 2', 'tab 1 sees tab 2')
await page.fill('textarea[data-large-text]', 'Renamed in tab 1')
await until(async () => (await second.inputValue('textarea[data-large-text]')) === 'Renamed in tab 1', 'tab 2 sees tab 1', 20000)
await second.close()

step('log out and in again')
await page.goto(base)
await page.waitForURL((url) => url.pathname !== '/')
await page.locator('main h1').first().waitFor()
await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
await page.click('button[title="Spaces and account"]')
await page.locator('button', { hasText: 'Log out' }).click()
await page.waitForSelector('#login-username')
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })
await page.waitForURL((url) => url.pathname !== '/')
await page.locator('main h1').first().waitFor()
await page.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
await page.goto(`${base}/o/${victim.id}`)
await until(async () => (await page.inputValue('textarea[data-large-text]').catch(() => '')) === 'Renamed in tab 1', 'replica again after login')

await context.close()
if (problems.length) throw new Error(`console problems:\n  ${problems.join('\n  ')}`)
console.log('OK')
