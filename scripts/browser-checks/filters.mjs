// Filters are a temporary narrowing of a view (phone's Filters sheet and desktop's Filter menu): what
// is added there narrows this visit to the page only, on top of the view's own saved filter, which is
// shown apart ("This view: …") and not counted; the count and Clear cover only the narrowing (Clear
// keeps the view's own filter); Save to view merges the narrowing into the view, on purpose, and
// Edit view filter changes the view's own conditions; leaving the page and coming back finds no narrowing.
//   node filters.mjs [chromium|webkit] [base]        MODE=json: the replica turned off (HTTP mode)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(phone) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-filters-')), phone)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|Failed to load resource/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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
      const shot = path.join(tmpdir(), `vasta-filters-${engine}.png`)
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
const put = async (url, data) => {
  const response = await page.request.put(`${base}${url}`, { headers, data })
  if (!response.ok()) throw new Error(`PUT ${url}: ${response.status()} ${await response.text()}`)
  return response.json()
}

// Setup ------------------------------------------------------------------
await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })

const tag = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const taskType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const original = await get(`/api/types/${taskType.id}`)
const viewId = `${taskType.id}:filterscheck`
const ownFilter = { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'FilterCheck' } }
const savedView = async () => (await get(`/api/types/${taskType.id}`)).views.find((v) => v.id === viewId)
const items = async () => (await savedView())?.filter?.items ?? []
await put(`/api/types/${taskType.id}`, {
  ...original,
  views: [...original.views.filter((v) => v.id !== viewId), { id: viewId, name: 'FiltersCheck', layout: 'list', sort: [{ field: 'title', direction: 'asc' }], filter: { kind: 'group', operator: 'and', items: [ownFilter] } }],
})
for (const object of await get(`/api/spaces/${space.id}/search?q=FilterCheck&limit=50`)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
const made = {}
for (const name of ['alpha', 'beta', 'gamma']) made[name] = await post('/api/objects', { typeId: taskType.id, title: `FilterCheck ${name} ${tag}` })
await sleep(1500)

const row = (name) => page.locator(`main a[href="/o/${made[name].id}"]`).first()
const rows = async () => (await Promise.all(Object.keys(made).map(async (name) => ((await row(name).count()) ? name : '')))).filter(Boolean).join()
const openView = async () => {
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('main :is([data-view-picker], [role=button])').first().waitFor()
  const picker = page.locator('[data-view-picker]')
  if (await picker.count()) {
    await picker.click()
    await page.locator('[data-view-option]', { hasText: /^\s*FiltersCheck\s*$/ }).click()
  } else await page.locator('main :is(button, [role=button])', { hasText: /^\s*FiltersCheck\s*$/ }).first().click()
  await until(async () => (await rows()) === 'alpha,beta,gamma', 'the view lists its three tasks')
}

// The narrowing editor of the open sheet or menu: one title condition.
const narrow = async (text) => {
  await page.locator('[data-narrowing] button', { hasText: 'Add filter' }).first().click()
  await page.locator('[data-narrowing] input[placeholder="Value"]').fill(text)
  await page.locator('[data-narrowing] input[placeholder="Value"]').press('Enter')
}
const openFilters = async (desktop) => {
  if (desktop) await page.locator('main button', { hasText: /^\s*Filter/ }).first().click()
  else await page.locator('[data-filters-button]').click()
  await page.locator('[data-view-filters]').waitFor()
}
const shownCount = async (desktop) => (desktop ? (await page.locator('main button', { hasText: /^\s*Filter/ }).first().textContent()) : await page.locator('[data-filters-count]').textContent().catch(() => '')).replace(/\D/g, '')

async function run(desktop) {
  const where = desktop ? 'desktop' : 'phone'
  step(`${where}: the view's own filter is shown apart and not counted`)
  await openView()
  if (await shownCount(desktop)) throw new Error('the view\'s own filter is counted')
  await openFilters(desktop)
  const own = (await page.locator('[data-view-filter-text]').textContent())?.trim()
  if (!/FilterCheck/.test(own ?? '')) throw new Error(`"This view" reads "${own}"`)

  step(`${where}: a narrowing narrows this visit, counts, and leaves the view alone`)
  await narrow('alpha')
  await until(async () => (await rows()) === 'alpha', 'only alpha listed')
  await until(async () => (await shownCount(desktop)) === '1', 'the count is 1')
  await sleep(1200)
  if ((await items()).length !== 1) throw new Error(`the view was edited: ${JSON.stringify(await items())}`)

  step(`${where}: Clear clears only the narrowing; the view keeps its own filter`)
  if (desktop) await page.locator('[data-narrowing-clear]').click()
  else await page.locator('[data-filters-clear]').click()
  await until(async () => (await rows()) === 'alpha,beta,gamma', 'all three listed again')
  await until(async () => !(await shownCount(desktop)), 'no count')
  await sleep(1200)
  if (!(await items()).some((item) => item.field === 'title' && item.value.value === 'FilterCheck') || (await items()).length !== 1) throw new Error('Clear edited the view')
  if (!(await page.locator('[data-view-filter-text]').textContent())?.includes('FilterCheck')) throw new Error('the view\'s own filter went from the list')

  step(`${where}: leaving the page and coming back finds no narrowing`)
  await narrow('beta')
  await until(async () => (await rows()) === 'beta', 'only beta listed')
  await page.goto(`${base}/calendar`)
  await page.locator('main').waitFor()
  await openView()
  if (await shownCount(desktop)) throw new Error('the narrowing came back')
  if (!(await items()).length || (await items()).length !== 1) throw new Error('the view changed')

  step(`${where}: Save to view merges the narrowing into the view, on purpose`)
  await openFilters(desktop)
  await narrow('gamma')
  await until(async () => (await rows()) === 'gamma', 'only gamma listed')
  await page.locator('[data-save-to-view]').click()
  await until(async () => (await items()).some((item) => item.field === 'title' && item.value.value === 'gamma'), 'the view saved with gamma')
  if ((await items()).length !== 2) throw new Error(`the view's filter is ${JSON.stringify(await items())}`)
  await until(async () => !(await shownCount(desktop)), 'the narrowing is gone once saved')
  if (await page.locator('[data-save-to-view]').count()) throw new Error('Save to view still offered')
  await until(async () => /gamma/.test((await page.locator('[data-view-filter-text]').textContent()) ?? ''), 'the saved condition listed under This view')

  step(`${where}: Edit view filter changes the view's own conditions`)
  await page.locator('[data-edit-view-filter]').click()
  const values = page.locator('[data-view-filter-editor] input[placeholder="Value"]')
  // Let the save just made settle: a re-render from its sync resets a box typed in but not yet committed.
  await sleep(1500)
  await values.last().fill('beta')
  await values.last().press('Enter')
  await values.last().blur()
  await until(async () => (await items()).some((item) => item.value?.value === 'beta') && !(await items()).some((item) => item.value?.value === 'gamma'), 'the view edited')
  await until(async () => (await rows()) === 'beta', 'the view now lists beta only')
  // Back to the view as it was, for the next run.
  await put(`/api/types/${taskType.id}`, { ...(await get(`/api/types/${taskType.id}`)), views: (await get(`/api/types/${taskType.id}`)).views.map((v) => (v.id === viewId ? { ...v, filter: { kind: 'group', operator: 'and', items: [ownFilter] } } : v)) })
  await page.keyboard.press('Escape')
}

try {
  await run(false)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(true)
  const unexpected = problems.filter((p) => !/Failed to load resource/.test(p))
  if (unexpected.length) throw new Error(unexpected.join('\n'))
  console.log(`filters: ok (${engine})`)
} finally {
  for (const task of Object.values(made)) await page.request.delete(`${base}/api/objects/${task.id}`, { headers }).catch(() => {})
  await put(`/api/types/${taskType.id}`, { ...(await get(`/api/types/${taskType.id}`)), views: (await get(`/api/types/${taskType.id}`)).views.filter((v) => v.id !== viewId) }).catch(() => {})
  await browser.close()
}
