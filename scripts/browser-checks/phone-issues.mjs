import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5283'
assert(/^http:\/\/127\.0\.0\.1:(5183|5283)$/.test(base), 'Use an isolated test environment')
const [width, height] = (process.env.SIZE ?? '390x844').split('x').map(Number)
const directory = mkdtempSync(path.join(tmpdir(), 'vasta-phone-issues-'))
const options = { viewport: { width, height }, hasTouch: true, locale: 'en-US', timezoneId: 'America/Toronto', colorScheme: process.env.DARK ? 'dark' : 'light' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = browser ? await browser.newContext(options) : await webkit.launchPersistentContext(directory, options)
await context.addInitScript(() => {
  localStorage.setItem('vasta.replica', 'off')
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query) => query === '(hover: none)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : matchMedia(query)
})
const page = context.pages()[0] ?? await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const headers = { 'x-requested-with': 'vasta' }
async function request(method, route, data) {
  const response = await page.request[method](`${base}${route}`, { headers, data })
  assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`)
  return response.status() === 204 ? undefined : response.json()
}
async function target(locator, label) {
  const box = await locator.boundingBox()
  assert(box && box.height >= 43.5 && box.width >= 43.5, `${label}: ${JSON.stringify(box)}`)
}
async function clientValue(file, member, value) {
  await page.evaluate(async ({ file, member, value }) => {
    const resource = performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === file).at(-1)
    if (!resource) throw new Error(`Module was not loaded: ${file}`)
    const module = await import(resource.name)
    module[member].value = value
  }, { file, member, value })
}
async function until(check) {
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return
      await page.waitForTimeout(100)
    }
    throw new Error('Timed out waiting for state')
  })
}
try {
  await page.goto(base)
  await page.locator('#login-username').fill('tester')
  await page.locator('#login-password').fill('test-password')
  await page.locator('button[type=submit]').click()
  await page.locator('main').waitFor()
  const spaces = await request('get', '/api/spaces')
  const bundle = await request('get', `/api/spaces/${spaces[0].id}`)
  const type = bundle.types.find((item) => item.system === 'task')
  for (let index = 0; index < 8; index++) {
    if (!bundle.types.some((item) => item.name === `Phone kind ${index}`)) await request('post', '/api/types', { spaceId: spaces[0].id, name: `Phone kind ${index}`, pluralName: `Phone kinds ${index}` })
  }
  const tasks = []
  for (let index = 0; index < 18; index++) tasks.push(await request('post', '/api/objects', { typeId: type.id, title: `Phone issues ${engine} ${Date.now()} ${index}` }))
  await page.goto(`${base}/t/${type.id}`)
  await page.locator('[data-filters-button]').waitFor()

  console.log('Phone View, Filters and filter rows reach 44px')
  await target(page.locator('[data-view-picker]'), 'View')
  await target(page.locator('[data-filters-button]'), 'Filters')
  const templateArrow = page.locator('[data-new-split] button').nth(1)
  if (await templateArrow.count()) await target(templateArrow, 'template arrow')
  await page.locator('[data-filters-button]').click()
  await target(page.getByRole('button', { name: 'Add filter', exact: true }).first(), 'Add filter')
  await target(page.getByRole('button', { name: 'Add group', exact: true }).first(), 'Add group')
  await page.locator('[data-filters-done]').click()

  console.log('A last row can scroll fully above Capture')
  await page.locator('main').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const rowButtons = page.locator('main [data-row-more]')
  await rowButtons.last().waitFor()
  const last = await rowButtons.last().boundingBox()
  const capture = await page.locator('[data-capture-button]').boundingBox()
  const mainPadding = await page.locator('main').evaluate((element) => getComputedStyle(element).paddingBottom)
  assert(last && capture && last.y + last.height <= capture.y, `last row ${JSON.stringify(last)} Capture ${JSON.stringify(capture)} main padding ${mainPadding}`)
  await clientValue('/src/lib/state.ts', 'notice', { message: 'Test notice' })
  await page.waitForTimeout(250)
  await page.locator('main').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const raisedCapture = await page.locator('[data-capture-button]').boundingBox()
  const raisedRow = await rowButtons.last().boundingBox()
  assert(raisedRow.y + raisedRow.height <= raisedCapture.y, 'Notice-raised Capture covers the last row')
  await clientValue('/src/lib/state.ts', 'notice', null)

  console.log('Capture types stay bounded and keyboard-only hints are hidden')
  // On a type's page "+" is the quick card; its link opens capture.
  await page.locator('[data-capture-button]').click()
  await page.locator('[data-quick-add-capture]').click()
  const dialog = page.getByRole('dialog', { name: 'Quick capture' })
  const chips = dialog.locator('[data-testid=capture-types]')
  // The types you make most first (four at most), the rest after More….
  await until(async () => await chips.getByRole('radio').count() >= 2)
  assert(await chips.getByRole('radio').count() <= 5, 'more than Note and four types before More…')
  await dialog.getByTestId('capture-more').click()
  await until(async () => await chips.getByRole('radio').count() >= 9)
  assert((await chips.boundingBox()).height <= 112)
  await chips.getByRole('radio').last().scrollIntoViewIfNeeded()
  assert(await chips.getByRole('radio').last().isVisible())
  assert(!/Ctrl\+Enter|Enter saves/.test(await dialog.innerText()))
  await target(dialog.getByRole('button', { name: 'Save capture', exact: true }), 'Save capture')
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 240)
  const saveCapture = await dialog.getByRole('button', { name: 'Save capture', exact: true }).boundingBox()
  assert(saveCapture.y + saveCapture.height <= height - 240, 'Save capture is covered by the simulated keyboard')
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  console.log('The object sheet and the quick card stay above the keyboard')
  await page.locator('main a[href^="/o/"]').first().click()
  const objectSheet = page.locator('[data-popup]')
  await objectSheet.waitFor()
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 240)
  await page.waitForTimeout(250)
  const objectBox = await objectSheet.boundingBox()
  assert(objectBox.y >= 0 && objectBox.y + objectBox.height <= height - 240 + 1, `the object sheet is under the keyboard: ${JSON.stringify(objectBox)}`)
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 0)
  await objectSheet.getByTitle('Close').click()
  await objectSheet.waitFor({ state: 'detached' })
  await page.locator('[data-capture-button]').click()
  const quickCard = page.locator('[data-quick-add]')
  await quickCard.waitFor()
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 240)
  await page.waitForTimeout(250)
  const cardBox = await quickCard.boundingBox()
  assert(cardBox.y + cardBox.height <= height - 240 + 1, `the quick card is under the keyboard: ${JSON.stringify(cardBox)}`)
  await clientValue('/src/lib/viewport.ts', 'keyboardInset', 0)
  await page.keyboard.press('Escape')
  await quickCard.waitFor({ state: 'detached' })

  console.log('Review asks without falsely announcing Saving')
  // The 18 test tasks have no status: they are new, and Review starts with them. Defer… (the type's Defer) asks a date.
  await page.locator('[data-review-tasks]').click()
  await page.locator('[data-process-mode]').waitFor()
  await page.locator('[data-process-role="defer"]').click()
  await page.locator('[data-ask-save]').waitFor()
  assert(!/Saving/.test(await page.locator('[data-process-position]').innerText()))
  assert.equal(await page.locator('[data-process-mode] [role=dialog]').getAttribute('aria-busy'), null)
  assert.equal(await page.locator('[data-process-mode]').evaluate((element) => getComputedStyle(element).backgroundColor), await page.locator('[data-process-mode] section').evaluate((element) => getComputedStyle(element).backgroundColor))
  await page.locator('[data-ask-cancel]').click()
  await page.locator('[data-process-close]').click()

  console.log('Subtasks have a visible touch Add action')
  if (!(await request('get', `/api/types/${type.id}`)).subtasks?.parentField) {
    await page.goto(`${base}/t/${type.id}?settings=1`)
    await page.locator('[data-subtask-field]').selectOption({ label: 'Add a “Part of” field' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await until(async () => (await request('get', `/api/types/${type.id}`)).subtasks?.parentField)
  }
  await page.goto(`${base}/o/${tasks[2].id}`)
  await page.locator('[data-add-subtask]').fill('A visible Add action')
  await target(page.locator('[data-add-subtask-button]'), 'Add subtask')
  await page.locator('[data-add-subtask-button]').click()
  await until(async () => (await page.locator('[data-add-subtask]').inputValue()) === '')
  assert.match(await page.locator('[data-subtasks]').innerText(), /A visible Add action/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const palette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(['ink-faint', 'surface', 'canvas', 'raised', 'hover'].map((name) => [name, style.getPropertyValue(`--color-${name}`).trim()]))
  })
  const luminance = (color) => {
    const values = color.replace('#', '').match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
  }
  for (const background of ['surface', 'canvas', 'raised', 'hover']) {
    const levels = [luminance(palette['ink-faint']), luminance(palette[background])].sort((first, second) => first - second)
    assert((levels[1] + 0.05) / (levels[0] + 0.05) >= 4.5, `Faint text contrast against ${background}`)
  }
  assert.deepEqual(errors, [])
  console.log(`PASS ${engine} ${width}x${height} ${options.colorScheme}`)
} catch (error) {
  await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {})
  console.error(`Failure screenshot: ${directory}/failure.png`)
  throw error
} finally {
  await context.close()
  await browser?.close()
}
