// Editing in table views in the test env: a click on a property's cell edits it in place (a select
// picked from its menu, a number typed, a date from the picker, a checkbox toggled), on a type page
// and in a query shown as a table; formula columns follow and are not editable.
//   node table-edit.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-table-edit-')), options)
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
      const shot = path.join(tmpdir(), `vasta-table-edit-${engine}.png`)
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
const row = (title) => page.locator('tbody tr', { has: page.locator('td:first-child', { hasText: title }) })
const cell = (title, field) => row(title).locator(`td:nth-child(${columns.indexOf(field) + 1})`)
const headerFields = () => page.locator('thead th[data-column]').evaluateAll((ths) => ths.map((th) => th.dataset.column))
let columns = []

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const queryType = bundle.types.find((t) => t.system === 'query')

const tag = `${engine}-${Date.now() % 100000}`
const taskNew = await post('/api/types', { spaceId: space.id, name: `Chore ${tag}`, pluralName: `Chores ${tag}` })
const chore = await put(`/api/types/${taskNew.id}`, {
  ...taskNew,
  properties: [
    { id: 'priority', kind: 'select', name: 'Priority', multiple: false, options: [{ id: 'high', label: 'High', color: 'red' }, { id: 'low', label: 'Low', color: 'gray' }] },
    { id: 'minutes', kind: 'number', name: 'Minutes' },
    { id: 'doon', kind: 'date', name: 'Do on', withTime: false },
    { id: 'urgent', kind: 'checkbox', name: 'Urgent' },
    { id: 'double', kind: 'formula', name: 'Double', expression: '{minutes} * 2' },
  ],
  views: [{ id: `${taskNew.id}:all`, name: 'All', layout: 'table', sort: [{ field: 'title', direction: 'asc' }] }],
})
const dishes = await post('/api/objects', { typeId: chore.id, title: `Dishes ${tag}`, props: { minutes: { kind: 'number', value: 10 } } })
const laundry = await post('/api/objects', { typeId: chore.id, title: `Laundry ${tag}` })
await sleep(1500) // the replica pulls them
const saved = async (id) => (await get(`/api/objects/${id}`)).props

let query
try {
  await page.goto(`${base}/t/${chore.id}`)
  await until(async () => (await page.locator('tbody tr').count()) === 2, 'two rows')
  columns = await headerFields()

  step('a select: click the cell, pick an option')
  await cell(`Dishes ${tag}`, 'priority').locator('[data-edit]').click()
  await page.locator('button', { hasText: /^\s*High\s*$/ }).click()
  await until(async () => (await cell(`Dishes ${tag}`, 'priority').textContent()).includes('High'), 'High shown in the cell')
  await until(async () => (await saved(dishes.id)).priority?.value?.[0] === 'high', 'High saved')

  step('a number: type and press Enter; the formula follows')
  await cell(`Dishes ${tag}`, 'minutes').locator('[data-edit]').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('25')
  await page.keyboard.press('Enter')
  await until(async () => (await saved(dishes.id)).minutes?.value === 25, '25 saved')
  await until(async () => (await cell(`Dishes ${tag}`, 'double').textContent()).trim() === '50', 'formula shows 50')
  if (await cell(`Dishes ${tag}`, 'double').locator('[data-edit]').count()) throw new Error('a formula cell is editable')
  if (await page.locator('tbody input').count()) throw new Error('the number editor stayed open')

  step('a date: Tomorrow from the picker')
  await cell(`Laundry ${tag}`, 'doon').locator('[data-edit]').click()
  await page.locator('button', { hasText: /^\s*Tomorrow\s*$/ }).click()
  await page.keyboard.press('Escape')
  await until(async () => (await saved(laundry.id)).doon?.value?.resolution === 'day', 'a day saved')
  await until(async () => (await cell(`Laundry ${tag}`, 'doon').textContent()).trim() !== '', 'the day shown in the cell')

  step('a checkbox: one click toggles it')
  await cell(`Dishes ${tag}`, 'urgent').locator('[data-edit]').click()
  await until(async () => (await saved(dishes.id)).urgent?.value === true, 'Urgent saved')

  step('the same in a query shown as a table')
  query = await post('/api/objects', { typeId: queryType.id, title: `Chores ${tag}`, query: { typeIds: [chore.id], layout: 'table', sort: [{ field: 'title', direction: 'asc' }] } })
  await sleep(1000)
  await page.goto(`${base}/o/${query.id}`)
  await until(async () => (await page.locator('tbody tr').count()) === 2, 'two rows in the query')
  columns = await headerFields()
  await cell(`Dishes ${tag}`, 'priority').locator('[data-edit]').click()
  await page.locator('button', { hasText: /^\s*Low\s*$/ }).click()
  await until(async () => (await saved(dishes.id)).priority?.value?.[0] === 'low', 'Low saved from the query')
  await until(async () => (await cell(`Dishes ${tag}`, 'priority').textContent()).includes('Low'), 'Low shown in the query')
} finally {
  if (query) await page.request.delete(`${base}/api/objects/${query.id}`, { headers })
  await page.request.delete(`${base}/api/types/${chore.id}`, { headers })
}

if (problems.length) console.log(`console problems:\n  ${problems.join('\n  ')}`)
console.log('OK')
await browser.close()
