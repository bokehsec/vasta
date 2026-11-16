// Personal folds in grouped collections; only a seeded, isolated local test environment.
// node group-collapse.mjs [chromium|webkit] [base]   MODE=json disables the replica.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5283'
assert(/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base), 'Use an isolated test environment')
const options = { viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto', hasTouch: true }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = browser ? await browser.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-groups-')), options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? await context.newPage()
page.setDefaultTimeout(15000)
const errors = []
// WebKit reports cancelled same-origin loads during navigation as access-control errors.
page.on('pageerror', (e) => !/due to access control checks|Importing a module script failed/.test(e.message) && errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
async function request(method, route, data) {
  const r = await page.request[method](`${base}${route}`, { headers, data })
  assert(r.ok(), `${route}: ${r.status()} ${await r.text()}`)
  return r.status() === 204 ? undefined : r.json()
}
async function until(check, message) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${message}`)
}
async function pickView(name) {
  if (await page.locator('[data-view-picker]').count()) {
    await page.locator('[data-view-picker]').click()
    await page.locator('[data-view-option]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
  } else await page.locator('main [role=button]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).click()
}
const heading = (key, scope = page) => scope.locator(`[data-group-heading="${key}"]`)
const fold = (key, scope = page) => heading(key, scope).locator('[data-fold-group]')
const expanded = (key, scope = page) => fold(key, scope).getAttribute('aria-expanded')
const hasTitle = async (title, scope = page) => scope.getByText(title, { exact: true }).count()
let space
try {
  await request('post', '/api/auth/login', { username: 'tester', password: 'test-password' })
  space = await request('post', '/api/spaces', { name: `Group folds ${engine} ${Date.now()}` })
  const bundle = await request('get', `/api/spaces/${space.id}`)
  let type = bundle.types.find((t) => t.system === 'task')
  const layouts = ['table', 'list', 'grid', 'gallery', 'wall']
  type = await request('put', `/api/types/${type.id}`, {
    ...type,
    properties: type.properties.map((p) => p.id === 'status' ? { ...p, options: [{ id: 'next', label: 'Next' }, { id: 'waiting', label: 'Waiting' }, { id: 'big', label: 'Large group' }] } : p),
    views: [
      ...layouts.map((layout) => ({ id: layout, name: layout, layout, groupBy: [{ field: 'status' }], sort: [{ field: 'title', direction: 'asc' }] })),
      { id: 'tags', name: 'Tags', layout: 'list', groupBy: [{ field: 'tags' }] },
      { id: 'flat', name: 'Flat', layout: 'list' },
    ],
  })
  const make = (title, status) => request('post', '/api/objects', { typeId: type.id, title, props: status ? { status: { kind: 'select', value: [status] } } : {} })
  const made = {}
  for (const [title, status] of [['Alpha','next'],['Bravo','next'],['Charlie','waiting'],['Unplaced',undefined]]) made[title] = await make(title, status)
  const tag = await request('post', '/api/objects', { typeId: bundle.types.find((t) => t.system === 'tag').id, title: 'Planning' })
  await request('put', `/api/objects/${made.Alpha.id}`, { ...made.Alpha, tagIds:[tag.id] })
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout:60000 })
  await page.evaluate((id) => localStorage.setItem('vasta.space', id), space.id)
  await page.goto(`${base}/t/${type.id}`)
  await page.reload()
  await until(() => fold('next').count(), 'group controls')
  const original = await request('get', `/api/types/${type.id}`)

  console.log('• table: one header, keyboard folding, names/counts retained, no data changes')
  assert.equal(await page.locator('main table thead').count(), 1)
  await fold('next').focus()
  await page.keyboard.press('Enter')
  assert.equal(await expanded('next'), 'false')
  assert.equal(await hasTitle('Alpha'), 0)
  assert.match(await heading('next').innerText(), /Next\s*2/)
  await page.keyboard.press('Space')
  assert.equal(await expanded('next'), 'true')
  assert.equal(await hasTitle('Alpha'), 1)
  await fold('__none').click()
  assert.equal(await hasTitle('Unplaced'), 0)
  await fold('next').click()
  await page.reload()
  await until(async () => await expanded('next') === 'false', 'folds after reload')
  assert.equal(await hasTitle('Alpha'), 0)
  assert.deepEqual((await request('get', `/api/types/${type.id}`)).views, original.views)

  console.log('• other layouts and views stay independent; collapse/expand all')
  for (const layout of layouts.slice(1)) {
    await pickView(layout)
    await until(async () => await expanded('next') === 'true', `${layout} initially expanded`)
    assert.equal(await hasTitle('Alpha'), 1)
    await fold('next').click()
    assert.equal(await hasTitle('Alpha'), 0)
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
    assert.equal(await page.locator('[data-fold-group][aria-expanded=true]').count(), 0)
    await page.getByRole('button', { name: 'Expand all', exact: true }).click()
    assert.equal(await page.locator('[data-fold-group][aria-expanded=false]').count(), 0)
  }
  console.log('• linked group chips stay separate and open normally when folded')
  await pickView('Tags')
  await until(() => heading(tag.id).count(), 'tag group')
  const tagHeading = heading(tag.id)
  assert.equal(await tagHeading.locator('button a, a button').count(), 0)
  await fold(tag.id).click()
  assert.equal(await hasTitle('Alpha'), 0)
  await tagHeading.locator('a').click()
  await page.locator('[data-popup]').waitFor()
  assert.equal(await expanded(tag.id), 'false')
  await page.keyboard.press('Escape')
  await pickView('table')
  assert.equal(await expanded('next'), 'false')

  console.log('• phones reuse folds as table rows; 320px and 390px tap targets')
  for (const width of [320,390]) {
    await page.setViewportSize({ width, height: 844 })
    await until(() => page.locator('[data-view-picker]').count(), 'phone layout')
    assert.equal(await expanded('next'), 'false')
    assert.equal(await page.locator('main table').count(), 0)
    const box = await fold('next').boundingBox()
    assert(box.height >= 44, '44px group button')
    await fold('next').click()
    assert.equal(await hasTitle('Alpha'), 1)
    await fold('next').click()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow')
  }
  await page.evaluate(() => localStorage.setItem('vasta.theme', 'dark'))
  await page.reload()
  await until(() => fold('next').count(), 'dark phone theme')
  const shots = path.join(tmpdir(), `vasta-group-collapse-${engine}`)
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, 'phone.png') })
  await page.setViewportSize({ width:1280,height:900 })
  await page.evaluate(() => localStorage.setItem('vasta.theme', 'light'))
  await page.reload()
  await until(async () => !(await page.locator('[data-view-picker]').count()), 'desktop restored')
  await page.screenshot({ path: path.join(shots, 'desktop.png') })

  console.log('• ungrouped collections have no fold controls')
  await pickView('Flat')
  assert.equal(await page.locator('[data-group-controls]').count(), 0)
  assert.equal(await hasTitle('Alpha'), 1)

  console.log('• two embeds of the same query keep independent folds and retain them after reload')
  const queryType = bundle.types.find((t) => t.system === 'query')
  const pageType = bundle.types.find((t) => t.system === 'page')
  const query = await request('post', '/api/objects', { typeId: queryType.id, title:'Grouped query', query: { typeIds:[type.id], layout:'table', groupBy:[{field:'status'}] } })
  const host = await request('post', '/api/objects', {
    typeId: pageType.id, title:'Group fold host', content: { body: { type:'doc', content:[
      {type:'objectEmbed', attrs:{id:'group-embed-one',objectId:query.id,display:'embed'}},
      {type:'paragraph'},
      {type:'objectEmbed', attrs:{id:'group-embed-two',objectId:query.id,display:'embed'}},
    ] } },
  })
  await page.goto(`${base}/o/${host.id}`)
  await until(async () => await page.locator('.group\\/query').count() === 2, 'two embeds')
  const embeds = page.locator('.group\\/query')
  await until(() => fold('next', embeds.first()).count(), 'query results')
  await fold('next', embeds.first()).click()
  assert.equal(await hasTitle('Alpha', embeds.first()), 0)
  assert.equal(await hasTitle('Alpha', embeds.last()), 1)
  await page.reload()
  await until(async () => await expanded('next', embeds.first()) === 'false', 'embed fold retained')
  assert.equal(await expanded('next', embeds.last()), 'true')
  assert.deepEqual((await request('get', `/api/objects/${query.id}`)).query, query.query)
  await page.goto(`${base}/o/${query.id}`)
  await until(async () => await expanded('next') === 'true', 'query page independent of embeds')

  console.log('• counts cover all 205 items; collapsed groups have no rows or autoload controls')
  for (let batch=0; batch<21; batch++) {
    await Promise.all(Array.from({length:Math.min(10,205-batch*10)},(_,i)=>make(`Large ${batch*10+i}`, 'big')))
  }
  await page.goto(`${base}/t/${type.id}`)
  await pickView('table')
  await until(() => heading('big').count(), 'large group')
  assert.match(await heading('big').innerText(), /205/)
  await fold('big').click()
  const body = heading('big').locator('xpath=ancestor::tbody')
  assert.equal(await body.locator('td').count(), 0)
  assert.equal(await body.getByText(/Show more/).count(), 0)
  assert.equal(await page.locator('main table thead').count(), 1)
  await page.goto(`${base}/o/${host.id}`)
  await until(() => heading('big', embeds.first()).count(), 'large group in embed')
  assert.match(await heading('big', embeds.first()).innerText(), /205/)
  await page.waitForTimeout(400)
  const preview = heading('big', embeds.first()).locator('xpath=ancestor::tbody')
  assert.equal(await preview.locator('tr.group\\/row').count(), 24, 'preview stays bounded while header counts all results')
  await fold('big', embeds.first()).click()
  assert.equal(await preview.locator('td').count(), 0)
  assert.deepEqual(errors, [])
  console.log(`PASS ${engine}; screenshots ${shots}`)
} finally {
  if (space) await request('delete', `/api/spaces/${space.id}`).catch(() => {})
  await context.close()
  if (browser) await browser.close()
}
