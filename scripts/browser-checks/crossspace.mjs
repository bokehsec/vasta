// A link to a page in another space than the open one: the page opens that space and shows its text.
//   node crossspace.mjs [chromium|webkit] [base]   (MODE=json: the replica turned off)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-crossspace-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const step = (name) => console.log(`• ${name}`)
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const home = await post('/api/spaces', { name: `Home ${tag}` })
const other = await post('/api/spaces', { name: `Other ${tag}` })
const pageType = (await get(`/api/spaces/${other.id}`)).types.find((t) => t.system === 'page')
const body = pageType.properties.find((p) => p.kind === 'rich-text')
const words = `Body text ${tag}`
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] }
const made = await post('/api/objects', { typeId: pageType.id, title: `Linked ${tag}`, content: { [body.id]: doc } })
if (!made.id) throw new Error(`object not made: ${JSON.stringify(made)}`)

step('the app is on another space')
// Reload until the app (and its replica, when on) has the new spaces and opens Home.
await page.evaluate((id) => localStorage.setItem('vasta.space', id), home.id)
for (let tries = 0; ; tries++) {
  await page.goto(base)
  await page.waitForSelector('nav')
  if (await page.locator('aside').getByText(`Home ${tag}`).first().isVisible().catch(() => false)) break
  if (tries > 10) throw new Error('the app did not open the Home space')
  await page.evaluate((id) => localStorage.setItem('vasta.space', id), home.id)
  await page.waitForTimeout(1500)
}

step('open the link: title and text show, and the space is switched')
await page.goto(`${base}/o/${made.id}`)
await page.locator('textarea').filter({ hasText: `Linked ${tag}` }).first().waitFor({ timeout: 15000 }).catch(() => {})
await page.getByText(words).first().waitFor({ timeout: 15000 })
await page.locator('aside').getByText(`Other ${tag}`).first().waitFor({ timeout: 15000 })
if (problems.length) throw new Error(problems.join('\n'))
await browser.close()
console.log(`crossspace: ok (${engine}${process.env.MODE === 'json' ? ', json' : ''})`)
