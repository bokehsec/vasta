// The ⋮⋮ handle of a block in a second column, in the test env: it sits in the gap before that
// column (not in the page's gutter, past the first column's blocks), stays put while the pointer
// goes from the block to it, also through a coloured panel's padding, and opens that block's menu.
//   node columnhandle.mjs [chromium|webkit] [base]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-columnhandle-')), options)
const browser = launched ?? context
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
      const shot = path.join(tmpdir(), `vasta-columnhandle-${engine}.png`)
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
const pageType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'page')
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const column = (...content) => ({ type: 'column', content })
let host
try {
  // Blocks on the left at the height of those on the right, so a pointer crossing them would land on them.
  host = await post('/api/objects', {
    typeId: pageType.id,
    title: `Column handle ${tag}`,
    content: { body: { type: 'doc', content: [
      { type: 'columns', content: [
        column(...['Left one', 'Left two', 'Left three', 'Left four', 'Left five', 'Left six'].map(paragraph)),
        column(paragraph('Right plain'), { type: 'group', attrs: { color: 'sky' }, content: [paragraph('In the panel'), paragraph('Panel second line')] }),
      ] },
      { type: 'paragraph' },
    ] } },
  })
  await sleep(1500)
  await page.goto(`${base}/o/${host.id}`)
  await page.waitForSelector('.vasta-doc')
  const doc = page.locator('.vasta-doc')
  await doc.getByText('Right plain').waitFor()
  const handle = page.locator('.vasta-block-handle:not([hidden])')
  const box = async (locator) => locator.boundingBox()
  const [left, right] = [await box(doc.locator('.vasta-column').first()), await box(doc.locator('.vasta-column').nth(1))]

  /** Hover a line, walk left (then up) to its handle like a hand would, check it held still, and click it. */
  async function reachHandle(text) {
    const line = await box(doc.getByText(text, { exact: true }))
    const from = { x: line.x + 10, y: line.y + line.height / 2 }
    await page.mouse.move(from.x, from.y, { steps: 3 })
    await until(() => handle.count(), `the handle beside "${text}"`)
    const at = await box(handle)
    const target = { x: at.x + at.width / 2, y: at.y + at.height / 2 }
    if (target.x < left.x + left.width || target.x > right.x) throw new Error(`the handle of "${text}" is at x ${Math.round(target.x)}, not in the gap before its column (${Math.round(left.x + left.width)}–${Math.round(right.x)})`)
    await page.mouse.move(target.x, from.y, { steps: 10 })
    await page.mouse.move(target.x, target.y, { steps: 5 })
    const now = await box(handle)
    if (!now || Math.abs(now.y - at.y) > 1) throw new Error(`the handle of "${text}" moved on the way to it`)
    await handle.click()
    await page.waitForSelector('[role=menu]')
    const selected = await doc.locator('.vasta-block-selected').allInnerTexts()
    await page.keyboard.press('Escape')
    return selected.join(' ')
  }

  step('a paragraph in the second column: handle in the gap, its menu')
  if (!(await reachHandle('Right plain')).includes('Right plain')) throw new Error('the menu was not for "Right plain"')

  step('a panel in the second column: the handle holds through the padding')
  if (!(await reachHandle('In the panel')).includes('In the panel')) throw new Error('the menu was not for the panel')

  step('the first column keeps the page gutter')
  const first = await box(doc.getByText('Left two', { exact: true }))
  await page.mouse.move(first.x + 10, first.y + first.height / 2, { steps: 3 })
  await until(async () => (await handle.count()) && (await box(handle)).x < left.x, 'the handle in the page gutter')
} finally {
  if (host) await page.request.delete(`${base}/api/objects/${host.id}`, { headers })
}

console.log(problems.length ? `problems:\n${problems.join('\n')}` : 'no console problems')
await browser.close()
console.log('ok')
