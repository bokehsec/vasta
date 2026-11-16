// A link to a type of another space (/t/<id>) opens that space and shows the type's page, as a link
// to an object of another space does.
//   node typelink.mjs [chromium|webkit] [base]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[3-6]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-typelink-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const get = async (url) => (await page.request.get(`${base}${url}`)).json()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const spaces = await get('/api/spaces')
if (spaces.length < 2) throw new Error('needs two spaces')
const current = await page.evaluate(() => localStorage.getItem('vasta.space'))
const other = spaces.find((s) => s.id !== current) ?? spaces[1]
const { types } = await get(`/api/spaces/${other.id}`)
const target = types.find((t) => t.key === 'habit') ?? types.find((t) => t.key === 'task') ?? types[0]
console.log(`• in ${current}, opening /t/${target.id} (${target.pluralName} of ${other.name})`)

await page.goto(`${base}/t/${target.id}`)
await page.getByRole('heading', { name: target.pluralName }).first().waitFor({ timeout: 15000 })
const now = await page.evaluate(() => localStorage.getItem('vasta.space'))
if (now !== other.id) throw new Error(`space not switched: ${now}`)
console.log(`• ${target.pluralName} shown, space switched to ${other.name}`)
if (problems.length) throw new Error(problems.join('\n'))
await browser.close()
console.log('ok')
