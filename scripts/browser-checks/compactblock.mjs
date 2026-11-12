// One block of another page embedded and shown compact, in the test env: the full frame has the
// object's name and Open, the block menu's Show as → Compact leaves just the content (a group
// without its panel), Open block (block menu) opens the source, an emptied block hides and comes
// back when filled, and Full brings the frame back.
//   node compactblock.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-compactblock-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
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
      const shot = path.join(tmpdir(), `vasta-compactblock-${engine}.png`)
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

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const pageType = bundle.types.find((t) => t.system === 'page')
const made = []
const put = async (object) => page.request.put(`${base}/api/objects/${object.id}`, { headers, data: object })
const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
let host
try {
  // A source page whose colored group (id cb1) holds a line; a host page embeds that block.
  const source = await post('/api/objects', {
    typeId: pageType.id,
    title: `Block source ${tag}`,
    content: { body: { type: 'doc', content: [{ type: 'group', attrs: { id: 'cb1', color: 'amber' }, content: [para(`Heads up line ${tag}`)] }] } },
  })
  made.push(source)
  host = await post('/api/objects', {
    typeId: pageType.id,
    title: `Block host ${tag}`,
    content: { body: { type: 'doc', content: [para('Above the block'), { type: 'objectEmbed', attrs: { objectId: source.id, display: 'block', blockId: 'cb1' } }, para()] } },
  })
  await sleep(1500)

  const doc = page.locator('.vasta-doc').first()
  const embed = doc.locator('[data-node-view-wrapper]').first()
  const frame = doc.locator('[data-testid=block-embed]')
  const line = doc.locator('.vasta-block-embed', { hasText: `Heads up line ${tag}` })
  const header = frame.locator('button', { hasText: 'Open' })
  const display = async () => (await get(`/api/objects/${host.id}`)).content.body.content.find((b) => b.type === 'objectEmbed')?.attrs.display
  /** Hover the embed, walk to its ⋮⋮ handle and click it: the block menu. */
  async function blockMenu() {
    await until(async () => {
      const box = await embed.boundingBox()
      await page.mouse.move(box.x + 24, box.y + Math.min(8, box.height / 2), { steps: 5 })
      return page.locator('.vasta-block-handle:not([hidden])').count()
    }, 'the ⋮⋮ handle beside the embed')
    const handle = page.locator('.vasta-block-handle:not([hidden])')
    const at = await handle.boundingBox()
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 10 })
    await handle.click()
    await page.waitForSelector('[role=menu]')
  }
  const menuItem = (name) => page.locator('[role=menu] button', { hasText: name })

  await page.goto(`${base}/o/${host.id}`)
  await page.waitForSelector('.vasta-doc')

  step('the full frame: the object\'s name and Open, the line inside its group')
  await until(async () => (await line.count()) > 0, 'the embedded line', 20000)
  if ((await header.count()) !== 1) throw new Error('the full frame has no Open button')

  step('Show as → Compact: no frame, no group panel, the line still there')
  await blockMenu()
  for (const name of ['Full', 'Compact']) if (!(await menuItem(name).count())) throw new Error(`no ${name} in the block menu`)
  if (await menuItem('Wide card').count()) throw new Error('card displays offered for an embedded block')
  await menuItem('Compact').click()
  await until(async () => (await display()) === 'compact', 'compact saved on the server')
  await until(async () => (await header.count()) === 0, 'the header gone')
  if (!(await line.count())) throw new Error('the line went away with the frame')
  if (await frame.locator('.vasta-group').count()) throw new Error('the group panel is still drawn')

  step('Open block (block menu) opens the source page')
  await blockMenu()
  await menuItem('Open block').click()
  await until(() => new URL(page.url()).pathname === `/o/${source.id}`, 'the source page')

  step('the block emptied: the compact embed shows nothing')
  const full = await get(`/api/objects/${source.id}`)
  full.content.body.content[0].content = [para()]
  await put(full)
  await page.goto(`${base}/o/${host.id}`)
  await until(async () => (await frame.count()) === 1 && (await frame.getAttribute('data-empty')) === '', 'the empty block hidden', 20000)
  const box = await frame.boundingBox()
  if (box && box.height > 2) throw new Error(`the empty compact block takes ${box.height}px`)

  step('filled again: the line comes back by itself')
  full.content.body.content[0].content = [para(`Heads up line ${tag}`)]
  await put(full)
  await until(async () => (await line.count()) > 0, 'the line back', 20000)

  step('Show as → Full brings the frame back')
  await blockMenu()
  await menuItem('Full').click()
  await until(async () => (await display()) === 'block', 'full saved on the server')
  await until(async () => (await header.count()) === 1, 'the frame back')
} finally {
  if (host) await page.request.delete(`${base}/api/objects/${host.id}`, { headers })
  for (const object of made) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}

console.log(problems.length ? `problems:\n${problems.join('\n')}` : 'no console problems')
await browser.close()
console.log('ok')
