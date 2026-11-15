// Custom phone menu: choices, order, limits, reload, types, missing types, space isolation, reset
// and desktop visibility. Runs only against scripts/test-env.sh's isolated data.
//   node phone-menu.mjs [chromium|webkit] [base]        MODE=json disables the replica.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
assert.match(base, /^http:\/\/127\.0\.0\.1:518[34]$/)
const options = { viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto' }
const profile = engine === 'webkit' ? mkdtempSync(path.join(tmpdir(), 'vasta-phone-menu-')) : undefined
const browser = engine === 'webkit' ? undefined : await chromium.launch()
const context = browser ? await browser.newContext(options) : await webkit.launchPersistentContext(profile, options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const bar = page.locator('[data-tab-bar]')
const settings = page.locator('#phone-menu')
const labels = () => bar.locator('[data-tab]').evaluateAll((items) => items.map((item) => item.getAttribute('data-tab')))
const selected = () => settings.locator('[data-phone-menu-item]').evaluateAll((items) => items.map((item) => item.getAttribute('data-phone-menu-item')))
const wait = async (check, description) => {
  const deadline = Date.now() + 15000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`)
    await page.waitForTimeout(100)
  }
}
const json = async (response) => { assert(response.ok(), `${response.status()} ${response.url()}`); return response.json() }
const headers = { 'x-requested-with': 'vasta' }

try {
  await page.goto(base)
  await page.fill('#login-username', 'tester')
  await page.fill('#login-password', 'test-password')
  await page.click('button[type=submit]')
  await bar.waitFor()
  assert.deepEqual(await labels(), ['Home', 'Tasks', 'Inbox', 'Calendar', 'Search'])
  const spaces = await json(await page.request.get(`${base}/api/spaces`))
  const spaceId = spaces[0].id
  const bundle = await json(await page.request.get(`${base}/api/spaces/${spaceId}`))
  const type = bundle.types.find((type) => !type.system)
  assert(type, 'seed has a custom type')

  console.log('• settings enforce five items, remove and reorder immediately')
  await page.goto(`${base}/settings#phone-menu`)
  await settings.waitFor()
  const add = settings.getByRole('combobox', { name: 'Add phone menu item' })
  assert(await add.isDisabled())
  await settings.getByRole('button', { name: 'Remove Inbox', exact: true }).click()
  await add.selectOption('today')
  await settings.getByRole('button', { name: 'Move Today earlier', exact: true }).click()
  assert.match(await settings.getByRole('status').innerText(), /Today, position 4 of 5/)
  assert.deepEqual(await labels(), ['Home', 'Tasks', 'Calendar', 'Today', 'Search'])
  assert.deepEqual(await selected(), ['home', 'tasks', 'calendar', 'today', 'search'])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settings.waitFor()
  await wait(async () => (await labels()).join() === 'Home,Tasks,Calendar,Today,Search', 'saved order after reload')

  console.log('• Today uses the existing day view and Search still opens the palette')
  await bar.locator('[data-tab="Today"]').click()
  await page.waitForURL(/\/calendar\?view=day&date=/)
  assert.equal(await bar.locator('[data-tab="Today"]').getAttribute('aria-current'), 'page')
  assert.equal(await bar.locator('[data-tab="Calendar"]').getAttribute('aria-current'), null)
  await bar.locator('[data-tab="Search"]').click()
  await page.getByPlaceholder('Search or create…').waitFor()
  await page.keyboard.press('Escape')

  console.log('• any type can replace a built-in, retains its route and active state')
  await page.goto(`${base}/settings#phone-menu`)
  await settings.getByRole('button', { name: 'Remove Calendar', exact: true }).click()
  await add.selectOption(`type:${type.id}`)
  const typeTab = bar.locator(`[data-tab]`).filter({ hasText: type.pluralName })
  assert.equal(await typeTab.getAttribute('href'), `/t/${type.id}`)
  await typeTab.click()
  await page.waitForURL(`${base}/t/${type.id}`)
  assert.equal(await typeTab.getAttribute('aria-current'), 'page')

  console.log('• a one-item menu, fallback for unavailable types, and defaults for another space')
  await page.goto(`${base}/settings#phone-menu`)
  for (const name of ['Home', 'Tasks', 'Today', 'Search']) await settings.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
  assert(await settings.getByRole('button', { name: `Remove ${type.pluralName}`, exact: true }).isDisabled())
  const storageKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith('vasta.phone-menu:')))
  assert(storageKey)
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify(['type:missing'])), storageKey)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settings.waitFor()
  await wait(async () => (await labels()).join() === 'Home', 'safe fallback')
  await settings.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
  assert.deepEqual(await labels(), ['Home', 'Tasks', 'Inbox', 'Calendar', 'Search'])
  await settings.getByRole('button', { name: 'Remove Home', exact: true }).click()
  await add.selectOption('settings')
  assert.equal(await bar.locator('[data-tab="Settings"]').getAttribute('aria-current'), 'page')
  // Force another seeded space at the next app start; no shared-space data is changed.
  if (spaces.length > 1) {
    await page.evaluate((id) => localStorage.setItem('vasta.space', id), spaces[1].id)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settings.waitFor()
    await wait(async () => (await labels())[0] === 'Home', 'another space has defaults')
    await page.evaluate((id) => localStorage.setItem('vasta.space', id), spaceId)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settings.waitFor()
    await wait(async () => (await labels()).includes('Settings') && !(await labels()).includes('Home'), 'original space keeps choices')
  }
  await settings.getByRole('button', { name: 'Reset to defaults', exact: true }).click()

  console.log('• 320px phone fits, controls stay 44px, desktop has no bottom bar')
  await page.setViewportSize({ width: 320, height: 700 })
  await settings.scrollIntoViewIfNeeded()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  for (const button of await settings.getByRole('button').all()) assert((await button.boundingBox()).height >= 44)
  for (const tab of await bar.locator('[data-tab]').all()) assert((await tab.boundingBox()).width >= 44)
  await page.screenshot({ path: '/private/tmp/vasta-phone-menu.png' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await wait(async () => !(await bar.count()), 'desktop hides phone bar')
  assert.deepEqual(errors, [])
  console.log(`PASS phone-menu (${engine}, ${process.env.MODE ?? 'replica'})`)
} finally {
  await (browser ?? context).close()
  if (profile) rmSync(profile, { recursive: true, force: true })
}
