// Copy link to page from the sidebar, a type view, query results, a page and a side pane.
//   node copy-link.mjs [chromium|webkit] [base]   (MODE=json: no local replica)
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
if (engine !== 'chromium' && engine !== 'webkit') throw new Error(`unknown browser: ${engine}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US' }
const profile = engine === 'webkit' ? mkdtempSync(path.join(tmpdir(), 'vasta-copy-link-')) : undefined
const browser = profile ? undefined : await chromium.launch()
const context = profile ? await webkit.launchPersistentContext(profile, options) : await browser.newContext(options)
try {
  // Keep a clipboard stub through navigation. Set rejection and desktop mode only for their checks.
  await context.addInitScript(({ json }) => {
    if (json) localStorage.setItem('vasta.replica', 'off')
    navigator.clipboard.writeText = async (text) => {
      if (window.__rejectCopy) throw new Error('Clipboard denied')
      window.__copied = text
    }
  }, { json: process.env.MODE === 'json' })
  const page = context.pages()[0] ?? (await context.newPage())
  page.setDefaultTimeout(12000)
  const headers = { 'x-requested-with': 'vasta' }
  async function request(method, url, data) {
    const response = await page.request.fetch(`${base}${url}`, { method, headers, data })
    if (!response.ok()) throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`)
    return response.json()
  }

  await request('POST', '/api/auth/login', { username: 'tester', password: 'test-password' })
  const space = await request('POST', '/api/spaces', { name: `Copy link ${engine} ${Date.now()}` })
  const { types } = await request('GET', `/api/spaces/${space.id}`)
  const pageType = types.find((type) => type.system === 'page')
  const queryType = types.find((type) => type.system === 'query')
  const title = 'Copy link target'
  const paragraph = 'Text for a block link'
  const object = await request('POST', '/api/objects', {
    typeId: pageType.id,
    title,
    content: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: paragraph }] }] } },
  })
  const query = await request('POST', '/api/objects', {
    typeId: queryType.id,
    title: 'Copy link query',
    query: { typeIds: [pageType.id], layout: 'list', openIn: 'pane' },
  })
  const [pinned, ...sections] = space.sidebar
  await request('PUT', `/api/spaces/${space.id}`, {
    ...space, sidebar: [{ ...pinned, items: [...pinned.items, object.id] }, ...sections],
  })
  const objectPath = `/o/${object.id}`
  const expected = `${base}${objectPath}`
  const action = page
    .getByRole('menuitem', { name: 'Copy link to page', exact: true })
    .or(page.getByRole('button', { name: 'Copy link to page', exact: true }))
  const resultRow = () => page.locator(`main a[href="${objectPath}"]`).first()
  const more = (container = page) => container.getByTitle('More', { exact: true }).click()
  async function copy(openMenu, link = expected) {
    await page.evaluate(() => { window.__copied = undefined })
    await openMenu()
    await action.click()
    await page.waitForFunction(() => window.__copied !== undefined)
    assert.equal(await page.evaluate(() => window.__copied), link)
    const notice = page.getByRole('status').filter({ hasText: 'Link to the page copied' })
    await notice.waitFor()
    await notice.getByRole('button', { name: 'Dismiss' }).click()
  }

  console.log('• Sidebar: copy a pinned object')
  await context.addInitScript((id) => localStorage.setItem('vasta.space', id), space.id)
  await page.goto(`${base}/t/${pageType.id}`)
  const pinnedRow = page.locator(`aside nav a[href="${objectPath}"]`)
  await copy(() => pinnedRow.click({ button: 'right' }))

  console.log('• Type view: copy the same object')
  await copy(() => resultRow().click({ button: 'right' }))

  console.log('• Query results and side pane: copy the result from both menus')
  await page.goto(`${base}/o/${query.id}`)
  await copy(() => resultRow().click({ button: 'right' }))
  await resultRow().click()
  const pane = page.locator('[data-side-pane]')
  await pane.locator('textarea[data-large-text]').waitFor()
  assert.equal(await pane.locator('textarea[data-large-text]').inputValue(), title)
  assert.equal(new URL(page.url()).pathname, `/o/${query.id}`)
  await copy(() => more(pane))

  console.log('• Object page: copy and open the web URL')
  await page.goto(expected)
  await copy(more)
  assert.equal(await page.locator('textarea[data-large-text]').inputValue(), title)

  console.log('• Desktop format: copy a Vasta deep link')
  await page.evaluate(() => { window.__TAURI_INTERNALS__ = {} })
  await copy(more, `vasta://o/${object.id}`)
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })

  console.log('• Clipboard failure: report the error and show no success notice')
  await page.evaluate(() => { window.__copied = undefined; window.__rejectCopy = true })
  await more()
  await action.click()
  const error = page.getByRole('alert').filter({ hasText: 'Could not copy the link' })
  await error.waitFor()
  assert.equal(await page.evaluate(() => window.__copied), undefined)
  assert.equal(await page.getByText('Link to the page copied', { exact: true }).count(), 0)
  await error.getByRole('button', { name: 'Dismiss' }).click()
  await page.evaluate(() => { window.__rejectCopy = false })

  console.log('• Existing block link and normal page navigation')
  const block = page.locator('.vasta-doc p', { hasText: paragraph })
  await block.click()
  await page.keyboard.press('Escape')
  await block.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy link to block', exact: true }).click()
  await page.waitForFunction(() => window.__copied !== undefined)
  const blockLink = await page.evaluate(() => window.__copied)
  assert.equal(blockLink.split('#')[0], expected)
  assert.match(new URL(blockLink).hash, /^#b-.+/)
  await more()
  await page.getByRole('link', { name: 'Open type', exact: true }).click()
  await page.waitForURL(`**/t/${pageType.id}`)
  await resultRow().click()
  await page.waitForURL(expected)

  console.log(`ok (${engine}, ${process.env.MODE === 'json' ? 'HTTP mode' : 'default mode'})`)
} finally {
  await (browser ?? context).close()
  if (profile) rmSync(profile, { recursive: true, force: true })
}
