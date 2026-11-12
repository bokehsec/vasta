// Fields on list rows in the test env: a query of tasks shown as a list, the Fields menu (turn the
// due date on, wrap titles), a task's checkbox marking it done without opening it, and Reset to
// default giving back the plain row.
//   node listrows.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-listrows-')), options)
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
      const shot = path.join(tmpdir(), `vasta-listrows-${engine}.png`)
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
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const queryType = bundle.types.find((t) => t.system === 'query')
const todo = taskType.properties.find((p) => p.id === 'status').options.find((o) => o.status === 'todo').id
const done = taskType.properties.find((p) => p.id === 'status').options.find((o) => o.status === 'done').id

const tag = `${engine}-${Date.now() % 100000}`
const due = { kind: 'date', value: { start: '2027-03-14T00:00:00.000Z', resolution: 'day' } }
const a = await post('/api/objects', { typeId: taskType.id, title: `Pay rent ${tag}`, props: { status: { kind: 'select', value: [todo] }, due } })
const b = await post('/api/objects', { typeId: taskType.id, title: `Water plants ${tag}`, props: { status: { kind: 'select', value: [todo] } } })
const query = await post('/api/objects', {
  typeId: queryType.id,
  title: `Chores ${tag}`,
  query: {
    typeIds: [taskType.id],
    layout: 'list',
    filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: tag } }] },
  },
})
await sleep(1500) // the replica pulls them
const savedList = async () => (await get(`/api/objects/${query.id}`)).query.list
const row = (title) => page.locator('a', { hasText: title })
const checks = page.locator('[data-task-check]')

try {
  step('the default row: no checkbox, no due date')
  const url = `${base}/o/${query.id}`
  await page.goto(url)
  await until(async () => (await row(`Pay rent ${tag}`).count()) === 1 && (await row(`Water plants ${tag}`).count()) === 1, 'both rows')
  if ((await checks.count()) !== 0) throw new Error('the default row has a checkbox')
  if (/Mar/.test(await row(`Pay rent ${tag}`).innerText())) throw new Error('the default row shows the due date')

  step('turn Due on in the Fields menu')
  await page.locator('button', { hasText: 'Fields' }).click()
  await page.locator('div[data-list-field="due"] button[title="Show field"]').click()
  await until(async () => (await savedList())?.fields?.includes('due'), 'Due saved on the query')
  await until(async () => /Mar/.test(await row(`Pay rent ${tag}`).innerText()), 'the due date on the row')
  if (/Mar/.test(await row(`Water plants ${tag}`).innerText())) throw new Error('a task without a due date shows one')
  if ((await checks.count()) !== 2) throw new Error(`checkboxes: ${await checks.count()}`)

  step('wrap titles')
  await page.locator('button', { hasText: 'Wrap titles' }).click()
  await until(async () => (await savedList())?.wrap === true, 'wrap saved')
  await until(async () => (await row(`Pay rent ${tag}`).locator('span.break-words').count()) === 1, 'the title wraps')
  await page.keyboard.press('Escape')

  step('the checkbox marks a task done and does not open it')
  await row(`Pay rent ${tag}`).locator('[data-task-check]').click()
  await until(async () => (await get(`/api/objects/${a.id}`)).props.status.value[0] === done, 'the task is done')
  await until(async () => (await row(`Pay rent ${tag}`).locator('span.line-through').count()) === 1, 'the title struck through')
  if (page.url() !== url) throw new Error(`navigated to ${page.url()}`)
  await row(`Pay rent ${tag}`).locator('[data-task-check]').click()
  await until(async () => (await get(`/api/objects/${a.id}`)).props.status.value[0] === todo, 'the task is to do again')

  step('reset to default')
  await page.locator('button', { hasText: 'Fields' }).click()
  await page.locator('button', { hasText: 'Reset to default' }).click()
  await until(async () => (await savedList()) === undefined, 'list settings cleared')
  await until(async () => (await checks.count()) === 0, 'the checkboxes gone')
  if (/Mar/.test(await row(`Pay rent ${tag}`).innerText())) throw new Error('the due date stayed after the reset')
} finally {
  for (const id of [query.id, a.id, b.id]) await page.request.delete(`${base}/api/objects/${id}`, { headers })
}

if (problems.length) console.log(`console problems:\n  ${problems.join('\n  ')}`)
console.log('OK')
await browser.close()
