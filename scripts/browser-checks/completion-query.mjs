// Completion feedback in a query embedded in a page (Phase 2 acceptance): a task marked Done in the
// query's results stays in place, checked and struck, through the debounced re-run after its own
// save; Undo returns the exact previous status; a page reload drops it. A query with a single open
// task keeps that row after Done instead of the block collapsing to "No objects match this query."
//   node completion-query.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!['chromium', 'webkit'].includes(engine)) throw new Error(`unknown engine: ${engine}`)
if (!/^http:\/\/127\.0\.0\.1:(5183|5383)$/.test(base)) throw new Error(`not the test env: ${base}`)

const options = { viewport: { width: 1300, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-completion-query-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
const expect = (ok, what) => {
  if (!ok) throw new Error(what)
}
async function until(check, what, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-completion-query-${engine}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      console.log('screenshot:', shot)
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const del = (id) => page.request.delete(`${base}/api/objects/${id}`, { headers }).catch(() => {})

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('nav', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const bundle = await get(`/api/spaces/${space.id}`)
const taskType = bundle.types.find((t) => t.system === 'task')
const pageType = bundle.types.find((t) => t.system === 'page')
const queryType = bundle.types.find((t) => t.system === 'query')
const status = (await get(`/api/types/${taskType.id}`)).properties.find((p) => p.id === 'status')
const doneId = status.options.find((o) => o.status === 'done').id
const todoId = status.options.find((o) => o.status === 'todo').id

const made = []
let host
try {
  // Two open tasks the first query lists, picked out by a marker in their titles and "not Done".
  const titled = (name, marker) => `CompletionQuery ${name} ${marker}`
  const task = async (name, marker) => {
    const created = await post('/api/objects', { typeId: taskType.id, title: titled(name, marker), props: { status: { kind: 'select', value: [todoId] } } })
    made.push(created)
    return created
  }
  const queryOf = (marker) => ({
    typeIds: [taskType.id],
    layout: 'list',
    filter: { kind: 'group', operator: 'and', items: [
      { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: marker } },
      { kind: 'filter', field: 'status', operator: 'not-contains', value: { kind: 'literal', value: [doneId] } },
    ] },
  })
  const hostOf = async (query, marker) => {
    const host = await post('/api/objects', { typeId: pageType.id, title: `CompletionQuery host ${marker}`, content: { body: { type: 'doc', content: [{ type: 'objectEmbed', attrs: { objectId: query.id, display: 'embed' } }] } } })
    made.push(host)
    return host
  }
  const embed = () => page.locator('[data-node-view-wrapper]').first()
  const row = (object) => embed().locator(`a[href="/o/${object.id}"]`)
  const check = (object) => row(object).locator('[data-task-check]')
  const present = async (object) => (await row(object).count()) > 0
  const struck = async (object) => (await row(object).locator('.task-title-done').count()) === 1
  const pressed = async (object) => (await check(object).getAttribute('aria-pressed').catch(() => null)) === 'true'
  const apiStatus = async (object) => (await get(`/api/objects/${object.id}`)).props.status?.value?.[0]
  // The embed's rows in order, so a kept row is seen staying where it was.
  const order = async (objects) => {
    const known = objects.map((o) => o.id)
    const found = await embed().locator('a[href^="/o/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href').slice(3)))
    return [...new Set(found)].filter((id) => known.includes(id))
  }

  step('two open tasks in an embedded query on a page; one marked Done stays struck after the re-run')
  const alpha = await task('Alpha', tag)
  const bravo = await task('Bravo', tag)
  const first = await post('/api/objects', { typeId: queryType.id, title: `CompletionQuery query ${tag}`, query: queryOf(tag) })
  made.push(first)
  host = await hostOf(first, tag)
  await sleep(1500)
  await page.goto(`${base}/o/${host.id}`)
  await page.waitForSelector('.vasta-doc')
  await until(() => present(alpha) && present(bravo), 'the query lists both open tasks', 20000)
  const before = await order([alpha, bravo])
  const target = before[0] === alpha.id ? alpha : bravo
  const other = target === alpha ? bravo : alpha
  await check(target).click()
  await until(async () => (await apiStatus(target)) === doneId, 'Done saved')
  await until(() => struck(target), 'the completed title struck through')
  await until(() => pressed(target), 'the checkbox checked')
  await sleep(1500)   // past the 400 ms debounced re-run, which no longer returns the task
  await until(() => present(target), 'the completed task still listed after the re-run')
  expect(await struck(target), 'the row lost its strike after the re-run')
  expect(await pressed(target), 'the row lost its check after the re-run')
  expect(!(await struck(other)), 'another row struck')
  const after = await order([alpha, bravo])
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`order ${after} instead of ${before} after Done`)

  step('Undo returns the exact previous status and the row stays')
  await check(target).click()
  await until(async () => (await apiStatus(target)) === todoId, 'Undo returns exactly the previous status')
  await until(async () => (await present(target)) && !(await struck(target)) && !(await pressed(target)), 'the row back, unstruck and unchecked')
  if ((await order([alpha, bravo])).join() !== before.join()) throw new Error('the row moved after Undo')

  step('a reload drops the completed task')
  await check(target).click()
  await until(async () => (await apiStatus(target)) === doneId && (await struck(target)), 'Done again')
  await page.reload()
  await until(() => present(other), 'the page after a reload', 20000)
  await until(async () => !(await present(target)), 'a fresh view drops the completed task')

  step('a query with a single open task keeps its row instead of "No objects match this query."')
  const solo = await task('Solo', `${tag}-solo`)
  const single = await post('/api/objects', { typeId: queryType.id, title: `CompletionQuery single ${tag}`, query: queryOf(`${tag}-solo`) })
  made.push(single)
  host = await hostOf(single, `${tag}-solo`)
  await sleep(1500)
  await page.goto(`${base}/o/${host.id}`)
  await page.waitForSelector('.vasta-doc')
  await until(() => present(solo), 'the single query lists its one open task', 20000)
  await check(solo).click()
  await until(async () => (await apiStatus(solo)) === doneId, 'Done saved')
  await until(() => struck(solo), 'the single task struck')
  await sleep(1500)
  await until(() => present(solo), 'the completed task still listed after the re-run')
  expect(await struck(solo), 'the single row lost its strike')
  if (await page.getByText('No objects match this query.').count()) throw new Error('the block collapsed to "No objects match this query."')
} finally {
  if (host) await del(host.id)
  for (const object of made) await del(object.id)
}

console.log(problems.length ? `problems:\n${problems.join('\n')}` : 'no console problems')
await browser.close()
console.log('ok')
