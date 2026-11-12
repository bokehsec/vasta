// A query embedded in a page shown compact, in the test env: the full frame has its header, the
// block menu's Show as → Compact leaves just the results, Edit query (block menu) opens the
// settings inline and Done closes them, compact survives a reload, and Full brings the header back.
//   node compactembed.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-compactembed-')), options)
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
      const shot = path.join(tmpdir(), `vasta-compactembed-${engine}.png`)
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
const queryType = bundle.types.find((t) => t.system === 'query')
const made = []
let host
try {
  // Two pages for the query to list, picked out by a tag in their titles.
  const rows = []
  for (const name of ['Alpha', 'Bravo']) rows.push(await post('/api/objects', { typeId: pageType.id, title: `Compact row ${name} ${tag}`, content: { body: { type: 'doc', content: [{ type: 'paragraph' }] } } }))
  made.push(...rows)
  const query = await post('/api/objects', {
    typeId: queryType.id,
    title: `Compact query ${tag}`,
    query: { typeIds: [pageType.id], layout: 'list', filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: `Compact row` } }] } },
  })
  made.push(query)
  host = await post('/api/objects', {
    typeId: pageType.id,
    title: `Compact host ${tag}`,
    content: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Above the list' }] }, { type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }, { type: 'paragraph' }] } },
  })
  await sleep(1500)

  const doc = page.locator('.vasta-doc')
  const embed = doc.locator('[data-node-view-wrapper]').first()
  const title = doc.locator(`a[href="/o/${query.id}"]`)
  const results = doc.locator(`a[href="/o/${rows[0].id}"]`)
  const editButton = doc.locator('button', { hasText: 'Edit query' })
  const filterButton = doc.locator('button', { hasText: 'Add filter' })
  const display = async () => (await get(`/api/objects/${host.id}`)).content.body.content.find((b) => b.type === 'objectEmbed')?.attrs.display
  /** Hover the embed, walk to its ⋮⋮ handle and click it: the block menu. */
  async function blockMenu() {
    await until(async () => {
      const box = await embed.boundingBox()
      await page.mouse.move(box.x + 24, box.y + 8, { steps: 5 })
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

  step('the full frame: header with the title and Edit query, and the results')
  await until(async () => (await results.count()) > 0, 'the query lists its pages', 20000)
  if ((await title.count()) !== 1) throw new Error('the full frame has no title link')
  if ((await editButton.count()) !== 1) throw new Error('the full frame has no Edit query button')

  step('Show as → Compact: no header, results still there')
  await blockMenu()
  for (const name of ['Full', 'Compact']) if (!(await menuItem(name).count())) throw new Error(`no ${name} in the block menu`)
  if (await menuItem('Edit query').count()) throw new Error('Edit query in the menu of a full query')
  await menuItem('Compact').click()
  await until(async () => (await display()) === 'compact', 'compact saved on the server')
  await until(async () => (await title.count()) === 0 && (await editButton.count()) === 0, 'the header gone')
  if (!(await results.count())) throw new Error('the results went away with the header')

  step('Edit query (block menu) opens the settings inline; Done closes them')
  await blockMenu()
  if (!(await menuItem('Open query').count())) throw new Error('no Open query in the menu of a compact query')
  await menuItem('Edit query').click()
  await filterButton.waitFor()
  await doc.locator('button', { hasText: 'Done' }).click()
  await until(async () => (await filterButton.count()) === 0, 'the settings closed')
  if (!(await results.count())) throw new Error('the results went away after Done')

  step('Open query opens the query object')
  await blockMenu()
  await menuItem('Open query').click()
  await until(() => new URL(page.url()).pathname === `/o/${query.id}`, 'the query page')

  step('compact survives a reload')
  await page.goto(`${base}/o/${host.id}`)
  await until(async () => (await results.count()) > 0, 'the results after the reload', 20000)
  if ((await title.count()) || (await editButton.count())) throw new Error('the header came back after the reload')
  if ((await display()) !== 'compact') throw new Error('compact was not kept')

  step('Show as → Full brings the header back')
  await blockMenu()
  await menuItem('Full').click()
  await until(async () => (await display()) === 'embed', 'full saved on the server')
  await until(async () => (await title.count()) === 1 && (await editButton.count()) === 1, 'the header back')
} finally {
  if (host) await page.request.delete(`${base}/api/objects/${host.id}`, { headers })
  for (const object of made) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}

console.log(problems.length ? `problems:\n${problems.join('\n')}` : 'no console problems')
await browser.close()
console.log('ok')
