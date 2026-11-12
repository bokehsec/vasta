// What a space opens on (Settings › Space › Opens on, Space.opensOn): "/" opens the chosen page, then
// Today, then (cleared) the first pinned item again; a chosen page in the trash falls back to the
// first pinned item. The setting is also changed in Settings with its picker.
//   node startpage.mjs [chromium|webkit] [base]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-startpage-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-startpage-${engine}.png`)
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

// A space of its own with two pages, one of them pinned: the first sidebar item is known.
const tag = `${engine}-${Date.now() % 100000}`
const space = await post('/api/spaces', { name: `Start ${tag}` })
const pageType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'page')
const wanted = await post('/api/objects', { typeId: pageType.id, title: `Wanted ${tag}` })
const pinned = await post('/api/objects', { typeId: pageType.id, title: `Pinned ${tag}` })
await put(`/api/spaces/${space.id}`, { sidebar: [{ id: 'pinned', name: 'Pinned', items: [pinned.id] }] })
const opensOn = (value) => put(`/api/spaces/${space.id}`, { opensOn: value })
await page.evaluate((id) => localStorage.setItem('vasta.space', id), space.id)

/** Load "/" until it lands on `expected` (a device takes a moment to hear of a change made elsewhere). */
async function opens(expected, what) {
  await until(async () => {
    // (The built app's first load may reload itself once.)
    await page.goto(`${base}/`).catch(() => {})
    await page.waitForSelector('nav')
    // A device that has not yet heard of the new space opens another one: switch, then load "/" again.
    if (!(await page.locator('aside').getByText(`Start ${tag}`).count())) {
      await page.locator('aside button[title="Spaces and account"]').click()
      const row = page.locator('[role=menu]').getByText(`Start ${tag}`)
      if (!(await row.count())) return false
      await row.click()
      await page.locator('aside').getByText(`Start ${tag}`).waitFor()
      await page.goto(`${base}/`).catch(() => {})
      await page.waitForSelector('nav')
    }
    await sleep(800)
    const url = new URL(page.url())
    return typeof expected === 'string' ? url.pathname === expected : expected(url)
  }, what)
}
const isToday = (url) => url.pathname === '/calendar' && url.searchParams.get('view') === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '')

step('nothing chosen: the first pinned item opens')
await opens(`/o/${pinned.id}`, 'the first pinned item')

step('a page: it opens, in place of the pinned item')
console.log('  saved:', JSON.stringify((await opensOn({ kind: 'object', id: wanted.id })).opensOn))
await opens(`/o/${wanted.id}`, 'the chosen page')

step('Today: the day view of today')
await opensOn({ kind: 'today' })
await opens(isToday, 'the day view')

step('cleared: the first pinned item again')
console.log('  saved:', JSON.stringify((await opensOn(null)).opensOn ?? 'nothing'))
await opens(`/o/${pinned.id}`, 'the first pinned item again')

step('a page in the trash: the first pinned item')
await opensOn({ kind: 'object', id: wanted.id })
await opens(`/o/${wanted.id}`, 'the chosen page, before it is trashed')
await page.request.delete(`${base}/api/objects/${wanted.id}`, { headers })
await opens(`/o/${pinned.id}`, 'the first pinned item for a trashed page')
await opensOn(null)

// SETTINGS=0 skips this step (headless WebKit here does not settle on the Settings page: sprints.mjs stalls the same way).
if (process.env.SETTINGS !== '0') {
  step('Settings › Space: Today, then a page from the picker, then back to the first pinned item')
  await page.goto(`${base}/settings#space`)
  const select = page.locator('select[aria-label="Opens on"]')
  await select.waitFor()
  await select.selectOption('today')
  await until(async () => (await get('/api/spaces')).find((s) => s.id === space.id).opensOn?.kind === 'today', 'Today saved')
  const other = await post('/api/objects', { typeId: pageType.id, title: `Chosen ${tag}` })
  await select.selectOption('object')
  await page.locator('input[placeholder="Search…"]').fill(`Chosen ${tag}`)
  await page.locator('button', { hasText: `Chosen ${tag}` }).first().click()
  await until(async () => (await get('/api/spaces')).find((s) => s.id === space.id).opensOn?.id === other.id, 'the page saved')
  await page.locator('button[title="Change the page"]', { hasText: `Chosen ${tag}` }).waitFor()
  await select.selectOption('pinned')
  await until(async () => !(await get('/api/spaces')).find((s) => s.id === space.id).opensOn, 'cleared')
}

if (problems.length) console.log(problems.join('\n'))
console.log(problems.length ? `done with ${problems.length} console problems` : 'ok')
await browser.close()
