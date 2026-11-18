// v0.11 intersections: Rules save only changed settings; reminders share the phone's overlay
// and Back behavior; source-derived habits acknowledge without writing a manual amount.
// node upgrade-reminders-rules.mjs [chromium|webkit] [base]    MODE=json: HTTP
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
import { createRequire } from 'node:module'
const sdk = createRequire(new URL('../../packages/server/package.json', import.meta.url))
const { Client } = await import(sdk.resolve('@modelcontextprotocol/sdk/client/index.js'))
const { StreamableHTTPClientTransport } = await import(sdk.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'))

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
assert(/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base), 'Use isolated seed data')
const options = { viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = browser ? await browser.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-upgrade-')), options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? await context.newPage()
let client
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('requestfailed', (request) => console.log(`Request failed: ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
// Use the app's router after first load, as its own links do: a full document reload can
// abort WebKit's background route imports and report an unrelated module-load error.
const navigate = (to) => page.evaluate((path) => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), to)
const headers = { 'x-requested-with': 'vasta' }
async function request(method, url, data) {
  const response = await page.request[method](`${base}${url}`, { headers, data })
  assert(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`)
  return response.status() === 204 ? undefined : response.json()
}
async function until(check, name) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out: ${name}`)
}
try {
  await request('post', '/api/auth/login', { username: 'tester', password: 'test-password' })
  const space = await request('post', '/api/spaces', { name: `Upgrade ${engine} ${Date.now()}` })
  const bundle = await request('get', `/api/spaces/${space.id}`)
  const task = bundle.types.find((type) => type.system === 'task')
  const habit = bundle.types.find((type) => type.system === 'habit')
  const taskObject = await request('post', '/api/objects', { typeId: task.id, title: 'Upgrade task' })
  console.log('• Rules UI saves only its change alongside a concurrent view and custom setting')
  await page.goto(`${base}/t/${task.id}?settings=1`)
  const settings = page.getByRole('dialog', { name: 'Task settings' })
  await settings.waitFor()
  await settings.getByLabel('A cover', { exact: true }).check()
  await request('patch', `/api/types/${task.id}`, { views: [...task.views, { id: 'concurrent', name: 'Concurrent', layout: 'list' }], quickActions: { nextStepField: 'next' }, review: { every: 12 } })
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => !(await settings.count()), 'settings saved')
  await until(async () => (await request('get', `/api/types/${task.id}`)).rules?.cover, 'Rules reached the server')
  const saved = await request('get', `/api/types/${task.id}`)
  assert.deepEqual(saved.rules, { cover: true })
  assert(saved.views.some((view) => view.id === 'concurrent'))
  assert.deepEqual(saved.quickActions, { nextStepField: 'next' })
  assert.deepEqual(saved.review, { every: 12 })
  // Rules stay deliberately off in the rest of this check.
  await request('patch', `/api/types/${task.id}`, { rules: null })

  console.log('• Remind me over a phone task sheet closes on Back and keeps the task sheet')
  await navigate(`/t/${task.id}`)
  await page.getByText('Upgrade task', { exact: true }).first().click()
  await page.locator('[data-popup]').waitFor()
  const popupPath = new URL(page.url()).pathname + new URL(page.url()).search
  await page.locator('[data-popup] button[title="More"]').click()
  await page.locator('[data-remind-me]').click()
  await page.locator('#reminder-form').waitFor()
  await page.evaluate(() => history.back())
  await until(async () => !(await page.locator('#reminder-form').count()), 'Back closes reminder editor')
  await until(async () => new URL(page.url()).pathname + new URL(page.url()).search === popupPath, 'Back restores the task sheet address')
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, popupPath)
  assert.equal(await page.locator('[data-popup]').count(), 1)

  console.log('• imported habit reminder acknowledges only, then its object link uses the phone sheet')
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const imported = await request('post', '/api/objects', { typeId: habit.id, title: 'Imported steps', props: { target: { kind: 'number', value: 10000 }, sparkyfitness: { kind: 'select', value: ['steps'] }, [`sf:${day}`]: { kind: 'number', value: 4000 } } })
  const rule = await request('post', '/api/auth/reminders/rules', { objectId: imported.id, ack: 'done', when: { kind: 'daily', at: '23:59' }, steps: [{ after: 0, channels: ['desktop'] }], repeat: null })
  const { secret } = await request('post', '/api/tokens', { name: 'Seed browser check', scope: 'api' })
  client = new Client({ name: 'seed-browser-check', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }))
  const result = await client.callTool({ name: 'start_reminder', arguments: { id: rule.id } })
  assert(!result.isError, result.content[0]?.text)
  const { nag } = JSON.parse(result.content[0].text)
  await navigate(`/remind/${nag.id}`)
  await page.locator('[data-acknowledgement-only]').waitFor()
  await page.locator('[data-answer]').click()
  await page.locator('[data-remind-done]').waitFor()
  assert.match(await page.locator('[data-remind-done]').innerText(), /Acknowledged/)
  assert.deepEqual((await request('get', `/api/objects/${imported.id}`)).props, imported.props)
  await page.getByRole('link', { name: 'Open habit' }).click()
  await page.locator('[data-popup]').waitFor()
  assert.equal(new URL(page.url()).pathname, `/remind/${nag.id}`)
  console.log('• takeover renders alone while native opener support remains independent')
  await navigate(`/remind/${nag.id}?takeover=1&popup=1`)
  await page.locator('[data-takeover]').waitFor()
  assert.equal(await page.locator('[data-popup], main, nav').count(), 0)
  assert.deepEqual(errors, [])
  console.log(`All upgrade-reminders-rules checks passed for ${engine}.`)
} finally {
  await client?.close()
  await context.close()
  await browser?.close()
}
