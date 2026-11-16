// SparkyFitness on a habit, against a fake upstream (no real SparkyFitness). Run against a test env
// started with VASTA_ALLOW_PRIVATE_FETCH=127.0.0.1 (the server must be allowed to read the fake one).
// Connect, preview without writes, a steps/water/sleep link needs a daily goal, save the link, import,
// the last sync shown; a tap on a linked habit never saves a hand value (it asks, and "Use SparkyFitness
// value" takes a hand entry away again), a hand clear survives a refresh, Unlink, and with no
// connection the panel is gone and disconnecting can remove what it brought. PHONE=1: 390px.
//   node sparkyfitness.mjs [chromium|webkit] [base]
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[3-9]$/.test(base)) throw new Error(`not the test env: ${base}`)
const upstream = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer browser-fake-key')
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(req.url.includes('water-intake') ? { water_ml: 2000 } : req.url.includes('exercise-entries') ? [{ name: 'Active Calories' }, { name: 'Full Body A' }] : []))
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const options = { viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, locale: 'en-US', timezoneId: 'America/Toronto' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-sparky-')), options)
const browser = launched ?? context
const page = context.pages()[0] ?? (await context.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
async function until(check, message) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(message)
}
const objectProps = async (id) => (await get(`/api/objects/${id}`)).props
const open = async (url) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.goto(url)
    } catch (error) {
      if (attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}
const habits = []
let space
try {
  await page.goto(base)
  await page.fill('#login-username', 'tester')
  await page.fill('#login-password', 'test-password')
  await page.click('button[type=submit]')
  await page.waitForSelector('nav', { state: 'attached' })
  space = (await get('/api/spaces'))[0]
  const type = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'habit')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())

  // No connection yet: the habit page has no SparkyFitness panel.
  const first = await post('/api/objects', { typeId: type.id, title: `Sparky nopanel ${Date.now()}` })
  habits.push(first)
  await open(`${base}/o/${first.id}`)
  await page.locator('[data-habit-pauses]').waitFor()
  assert.equal(await page.locator('[data-habit-sparky-link]').count(), 0, 'panel shown without a connection')

  // Headless WebKit freezes on the settings page once an import starts there (its form has a password
  // field): there the settings are checked only through the API.
  const ui = engine !== 'webkit'
  const settings = page.locator('[data-sparkyfitness-settings]')
  if (ui) {
    await open(`${base}/settings#space`)
    await settings.waitFor()
    // The SparkyFitness block sits above the red Delete-space box.
    const order = await page.evaluate(() => {
      const block = document.querySelector('[data-sparkyfitness-settings]')
      const danger = [...document.querySelectorAll('div')].find((d) => d.textContent?.trim().startsWith('Delete this space') && d.className.includes('border-red'))
      return !danger || !!(block.compareDocumentPosition(danger) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    assert.equal(order, true, 'SparkyFitness is below the Delete space box')
  }
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`
  const put = async (data) => await page.request.put(`${base}/api/spaces/${space.id}/sparkyfitness`, { headers, data })
  if (!ui) {
    assert.equal((await put({ baseUrl: upstreamUrl, apiKey: 'browser-fake-key', history: 7 })).status(), 200)
  } else {
    await settings.getByLabel('SparkyFitness server address').fill(upstreamUrl)
    await settings.getByLabel('SparkyFitness API key').fill('browser-fake-key')
    await settings.getByLabel('SparkyFitness history').selectOption('7')
    await settings.getByRole('button', { name: 'Connect', exact: true }).click()
  }
  await until(async () => (await get(`/api/spaces/${space.id}/sparkyfitness`))?.syncedAt, 'connection did not sync')
  assert.equal((await get(`/api/spaces/${space.id}/sparkyfitness`)).hasKey, true)
  // A bad address says why, not just "enter a valid server address…".
  const bad = await put({ baseUrl: 'ftp://nowhere.example', apiKey: 'another-key' })
  assert.equal(bad.status(), 400)
  assert.match((await bad.json()).error, /without credentials/)
  if (ui) {
    await settings.getByLabel('SparkyFitness server address').fill('ftp://nowhere.example')
    await settings.getByLabel('SparkyFitness API key').fill('another-key')
    await settings.getByRole('button', { name: 'Save connection', exact: true }).click()
    await settings.getByText('without credentials').waitFor()
  }

  const habit = await post('/api/objects', { typeId: type.id, title: `Sparky browser ${Date.now()}`, props: { target: { kind: 'number', value: 8 }, unit: { kind: 'text', value: 'glasses' } } })
  habits.push(habit)
  await open(`${base}/o/${habit.id}`)
  const linking = page.locator('[data-habit-sparky-link]')
  await linking.locator('summary').click()
  await linking.getByLabel('SparkyFitness rule').selectOption('water')
  assert.equal(await linking.getByRole('button', { name: 'Save link', exact: true }).count(), 0)
  // Steps, water and sleep need a daily goal: without one there is no preview.
  await linking.getByLabel('Daily goal').fill('')
  assert.equal(await linking.getByRole('button', { name: 'Preview last 7 days', exact: true }).isDisabled(), true)
  await linking.getByLabel('Daily goal').fill('8')
  await linking.getByRole('button', { name: 'Preview last 7 days', exact: true }).click()
  await linking.locator('[data-sparky-preview]').waitFor()
  const beforeLink = await objectProps(habit.id)
  assert.equal(Object.keys(beforeLink).some((key) => key.startsWith('sf:')), false)
  assert.equal(beforeLink.sparkyfitness, undefined)
  assert.equal(await linking.locator('[data-sparky-preview]').getByText('8 glasses', { exact: true }).count(), 7)
  await linking.getByRole('button', { name: 'Save link', exact: true }).click()
  await linking.getByRole('button', { name: 'Link saved', exact: true }).waitFor()
  await until(async () => (await objectProps(habit.id))[`sf:${today}`]?.value === 8, 'new link did not import')
  await open(`${base}/o/${habit.id}`)
  await page.locator('[data-habit-from-sparkyfitness]').waitFor()
  // The panel says when it last synced and has no error.
  await page.locator('[data-habit-sparky-link] summary').click()
  await page.locator('[data-sparky-sync-status]').getByText('Last synced').waitFor()
  assert.equal(await page.locator('[data-sparky-sync-error]').count(), 0)

  const mark = page.locator('button[title*="from SparkyFitness"]').first()
  const dialog = page.locator('form', { hasText: 'From SparkyFitness:' })
  await until(async () => (await mark.getAttribute('aria-pressed')) === 'true', 'filled day not shown')
  // A tap never saves a value: it opens the amount dialog showing what SparkyFitness gave.
  await mark.click()
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /From SparkyFitness: 8 glasses/)
  assert.equal(await dialog.locator('[data-dialog-alternative]').count(), 0, 'nothing to go back to yet')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal((await objectProps(habit.id))[`done:${today}`], undefined, 'a tap froze the value')
  // A hand amount, then back to SparkyFitness's.
  await mark.click()
  await dialog.locator('input').fill('3')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await objectProps(habit.id))[`done:${today}`]?.value === 3, 'hand amount did not save')
  await mark.click()
  await dialog.waitFor()
  await dialog.locator('[data-dialog-alternative]').click()
  await until(async () => (await objectProps(habit.id))[`done:${today}`] === undefined, 'the hand entry was not taken away')
  await until(async () => (await mark.getAttribute('aria-pressed')) === 'true', 'SparkyFitness value not back')
  // A hand clear (0) survives a refresh from SparkyFitness.
  await mark.click()
  await dialog.locator('input').fill('0')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await objectProps(habit.id))[`done:${today}`]?.value === 0, 'hand clear did not save')
  await post(`/api/spaces/${space.id}/sparkyfitness/sync`)
  await until(async () => !(await get(`/api/spaces/${space.id}/sparkyfitness`)).importing, 'refresh did not finish')
  const saved = await objectProps(habit.id)
  assert.equal(saved[`done:${today}`].value, 0)
  assert.equal(saved[`sf:${today}`].value, 8)
  await page.reload()
  await page.locator('[data-habit-from-sparkyfitness]').waitFor()
  assert.equal(await page.locator('button[title*="from SparkyFitness"]').first().getAttribute('aria-pressed'), 'false')

  // Unlink keeps the filled days and goes back to hand entries.
  await page.locator('[data-habit-sparky-link] summary').click()
  await page.locator('[data-sparky-unlink]').click()
  await page.getByRole('button', { name: 'Unlink, keep the filled days', exact: true }).click()
  await until(async () => (await objectProps(habit.id)).sparkyfitness === undefined, 'unlink did not save')
  assert.equal((await objectProps(habit.id))[`sf:${today}`].value, 8)

  // Without a connection the panel goes away; disconnecting can take what it brought.
  await open(`${base}/o/${habit.id}`)
  await linking.locator('summary').click()
  await linking.getByLabel('SparkyFitness rule').selectOption('water')
  await linking.getByRole('button', { name: 'Preview last 7 days', exact: true }).click()
  await linking.getByRole('button', { name: 'Save link', exact: true }).click()
  await linking.getByRole('button', { name: 'Link saved', exact: true }).waitFor()
  if (ui) {
    await open(`${base}/settings#space`)
    await settings.waitFor()
    await settings.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await page.getByRole('button', { name: /Disconnect and remove the filled days/ }).click()
  } else await page.request.delete(`${base}/api/spaces/${space.id}/sparkyfitness?remove=1`, { headers })
  await until(async () => (await get(`/api/spaces/${space.id}/sparkyfitness`)) === null, 'not disconnected')
  await until(async () => !Object.keys(await objectProps(habit.id)).some((key) => key.startsWith('sf:')), 'imported days not removed')
  assert.equal((await objectProps(habit.id)).sparkyfitness, undefined)
  await open(`${base}/o/${habit.id}`)
  await page.locator('[data-habit-pauses]').waitFor()
  // (a replica catches up with a change made behind its back when the page is opened again)
  if (!ui) { await new Promise((resolve) => setTimeout(resolve, 2000)); await page.reload() }
  await until(async () => (await page.locator('[data-habit-sparky-link]').count()) === 0, 'panel shown after disconnecting')
  assert.deepEqual(errors, [])
  console.log(`PASS ${engine} ${process.env.PHONE ? '390px' : 'desktop'}: connect, goal needed, preview without writes, link, import, last sync, tap asks, back to SparkyFitness, hand clear, unlink, disconnect and remove`)
} finally {
  for (const habit of habits) await page.request.delete(`${base}/api/objects/${habit.id}`, { headers })
  if (space) await page.request.delete(`${base}/api/spaces/${space.id}/sparkyfitness`, { headers })
  await browser.close()
  await new Promise((resolve) => upstream.close(resolve))
}
