// Fake upstream only. Run against scripts/test-env.sh with VASTA_ALLOW_PRIVATE_FETCH=127.0.0.1.
//   node scripts/browser-checks/sparkyfitness.mjs; PHONE=1 node scripts/browser-checks/sparkyfitness.mjs
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:5183'
const upstream = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer browser-fake-key')
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(req.url.includes('water-intake') ? { water_ml: 2000 } : req.url.includes('exercise-entries') ? [{ name: 'Active Calories' }, { name: 'Full Body A' }] : []))
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, timezoneId: 'America/Toronto' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
const get = async (path) => (await page.request.get(`${base}${path}`)).json()
const post = async (path, data) => (await page.request.post(`${base}${path}`, { headers, data })).json()
async function until(check, message) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(message)
}
let habit
let space
try {
  await page.goto(base)
  await page.fill('#login-username', 'tester')
  await page.fill('#login-password', 'test-password')
  await page.click('button[type=submit]')
  await page.waitForSelector('nav', { state: 'attached' })
  space = (await get('/api/spaces'))[0]
  const type = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'habit')
  await page.goto(`${base}/t/${type.id}`)
  await page.waitForSelector('nav', { state: 'attached' })
  await page.goto(`${base}/settings#space`)
  const settings = page.locator('[data-sparkyfitness-settings]')
  await settings.waitFor()
  await settings.getByLabel('SparkyFitness server address').fill(`http://127.0.0.1:${upstream.address().port}`)
  await settings.getByLabel('SparkyFitness API key').fill('browser-fake-key')
  await settings.getByLabel('SparkyFitness history').selectOption('7')
  await settings.getByRole('button', { name: 'Connect', exact: true }).click()
  await until(async () => (await get(`/api/spaces/${space.id}/sparkyfitness`))?.syncedAt, 'connection did not sync')
  assert.equal((await get(`/api/spaces/${space.id}/sparkyfitness`)).hasKey, true)
  habit = await post('/api/objects', { typeId: type.id, title: `Sparky browser ${Date.now()}`, props: { target: { kind: 'number', value: 8 }, unit: { kind: 'text', value: 'glasses' } } })
  await page.goto(`${base}/o/${habit.id}`)
  const linking = page.locator('[data-habit-sparky-link]')
  await linking.locator('summary').click()
  await linking.getByLabel('SparkyFitness rule').selectOption('water')
  assert.equal(await linking.getByRole('button', { name: 'Save link', exact: true }).count(), 0)
  await linking.getByRole('button', { name: 'Preview last 7 days', exact: true }).click()
  await linking.locator('[data-sparky-preview]').waitFor()
  const beforeLink = await get(`/api/objects/${habit.id}`)
  assert.equal(Object.keys(beforeLink.props).some((key) => key.startsWith('sf:')), false)
  assert.equal(beforeLink.props.sparkyfitness, undefined)
  assert.equal(await linking.locator('[data-sparky-preview]').getByText('8 glasses', { exact: true }).count(), 7)
  await linking.getByRole('button', { name: 'Save link', exact: true }).click()
  await linking.getByRole('button', { name: 'Link saved', exact: true }).waitFor()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
  await until(async () => (await get(`/api/objects/${habit.id}`)).props[`sf:${today}`]?.value === 8, 'new link did not import')
  await page.goto(`${base}/o/${habit.id}`)
  await page.locator('[data-habit-from-sparkyfitness]').waitFor()
  const check = page.locator('button[aria-pressed=true]').filter({ hasNot: page.locator('[nonexistent]') }).first()
  await until(async () => await check.count() > 0, 'filled day not shown')
  // Today's mark is the first pressed habit button; an amount at its goal clears on click.
  const todayCheck = page.locator('button[aria-pressed=true][title*="from SparkyFitness"]').first()
  await todayCheck.click()
  await until(async () => (await get(`/api/objects/${habit.id}`)).props[`done:${today}`]?.value === 0, 'hand clear did not save')
  await post(`/api/spaces/${space.id}/sparkyfitness/sync`)
  await until(async () => !(await get(`/api/spaces/${space.id}/sparkyfitness`)).importing, 'refresh did not finish')
  const saved = await get(`/api/objects/${habit.id}`)
  assert.equal(saved.props[`done:${today}`].value, 0)
  assert.equal(saved.props[`sf:${today}`].value, 8)
  await page.reload()
  await page.locator('[data-habit-from-sparkyfitness]').waitFor()
  assert.equal(await page.locator('button[title*="from SparkyFitness"]').first().getAttribute('aria-pressed'), 'false')
  assert.deepEqual(errors, [])
  console.log(`PASS Chromium ${process.env.PHONE ? '390px' : 'desktop'}: connect, preview without writes, save link, import, hand clear, refresh, reload`)
} finally {
  if (habit) await page.request.delete(`${base}/api/objects/${habit.id}`, { headers })
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}/sparkyfitness`, { headers })
  await browser.close()
  await new Promise((resolve) => upstream.close(resolve))
}
