// Touch sizes and fallbacks on a phone (iPhone review, 2026-11-15): a task page's quick actions 44px
// verbs, Mark done tinted (not filled, so it does not read as the task's state), the page's ⋯ and its "Open type" row 44px; Defer's sheet picking
// no day at first, naming the task from a row (not on its own page), 44px days and month arrows, Save
// on screen; Copy link when the clipboard refuses (the copy command, else the link offered by hand);
// a failed save saying it could not reach the server (MODE=json); Undo and Dismiss 44px, the notice
// staying while held.
//   node phone-touch.mjs [chromium|webkit] [base]      SIZE=320x568 (default 390x844), DARK=1, MODE=json: the replica off
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const [W, H] = (process.env.SIZE ?? '390x844').split('x').map(Number)
const shots = mkdtempSync(path.join(tmpdir(), 'vasta-phone-touch-'))
const options = { viewport: { width: W, height: H }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }), locale: 'en-US', timezoneId: 'America/Toronto', colorScheme: process.env.DARK ? 'dark' : 'light' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-medium-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
const tag = `${engine}${W}${process.env.MODE ?? ''}${process.env.DARK ? 'dark' : ''}`
const shot = (name) => page.screenshot({ path: path.join(shots, `${tag}-${name}.png`) })
const fail = async (msg) => {
  await shot('FAIL')
  throw new Error(msg)
}
const box = async (locator) => locator.boundingBox()
const atLeast44 = async (locator, what, { width = true } = {}) => {
  const b = await box(locator)
  if (!b || b.height < 43.5 || (width && b.width < 43.5)) await fail(`${what} is ${b?.width}×${b?.height}`)
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForLoadState('networkidle')
await sleep(1500)

const space = (await get('/api/spaces'))[0]
const taskType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const title = `PhoneTouch ${tag} call the dentist about the appointment next week`
const task = await post('/api/objects', { typeId: taskType.id, title })
await sleep(800)

try {
  step("a row's Defer names the task, Save in reach")
  await page.goto(`${base}/t/${taskType.id}`)
  const rowMore = page.locator(`[aria-label="More actions for ${title}"]`).first()
  await rowMore.waitFor({ state: 'attached', timeout: 60000 })
  await rowMore.scrollIntoViewIfNeeded()
  await rowMore.click()
  await page.locator('[data-menu-sheet] button', { hasText: /^\s*Defer…\s*$/ }).click()
  const scope = page.locator('[data-defer-menu] [data-ask-scope]')
  await scope.waitFor()
  if ((await scope.textContent()).trim() !== title) await fail(`scope: ${await scope.textContent()}`)
  const rowSave = await box(page.locator('[data-defer-menu] [data-ask-save]'))
  if (rowSave.y + rowSave.height > H + 1) await fail('Save is off screen from a row')
  await shot('1-defer-row')
  await page.locator('[data-defer-menu] [data-ask-cancel]').click()

  step('task page: actions 44px, Mark done tinted and not filled, Defer…; ⋯ 44px')
  await page.goto(`${base}/o/${task.id}`)
  const done = page.locator('[data-quick-actions] [data-action="done"]')
  await done.waitFor()
  const actionButtons = page.locator('[data-quick-actions] [data-action]')
  console.log(`  actions: ${(await actionButtons.allTextContents()).map((t) => t.trim()).join(', ')}`)
  for (let i = 0; i < (await actionButtons.count()); i++) await atLeast44(actionButtons.nth(i), `action ${i}`, { width: false })
  const bg = (l) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
  const defer = page.locator('[data-quick-actions] [data-action="defer"]')
  if ((await bg(done)) === (await bg(defer))) await fail('Mark done does not stand out from Defer')
  const ink = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim())
  const filled = await done.evaluate((el, ink) => { const probe = document.createElement('i'); probe.style.color = ink; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).backgroundColor === c }, ink)
  if (filled) await fail('Mark done is filled with ink (reads as the task\'s state)')
  if (!(await defer.textContent()).trim().endsWith('…')) await fail(`Defer does not say it asks first: ${await defer.textContent()}`)
  const more = page.locator('main button[title="More"]').first()
  await atLeast44(more, 'page ⋯')
  await shot('2-task-page')

  step('page ⋯ sheet: Open type row 44px')
  await more.click()
  const openType = page.locator('a', { hasText: 'Open type' })
  await openType.waitFor()
  await atLeast44(openType, 'Open type', { width: false })
  await shot('3-page-menu')

  step('Copy link, clipboard refused: the copy command copies')
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('denied')
    }
    document.execCommand = (command) => {
      if (command !== 'copy') return false
      window.__copied = document.querySelector('body > textarea[readonly]')?.value
      return true
    }
  })
  await page.locator('button', { hasText: 'Copy link to page' }).click()
  await page.locator('[role=status]', { hasText: 'Link to the page copied' }).waitFor()
  if ((await page.evaluate(() => window.__copied)) !== `${base}/o/${task.id}`) await fail('copy command did not get the link')

  step('Copy link, nothing copies: the link offered to copy by hand')
  await page.evaluate(() => {
    document.execCommand = () => false
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
  const offered = new Promise((resolve) => page.once('dialog', async (d) => (resolve(d.defaultValue()), await d.dismiss())))
  await more.click()
  await page.locator('button', { hasText: 'Copy link to page' }).click()
  if ((await offered) !== `${base}/o/${task.id}`) await fail('prompt did not offer the link')
  await sleep(300)
  if (await page.locator('[role=alert]').count()) await fail('an error showed after the prompt')

  step('Defer on the page: nothing picked at first, no task name (it is on the page), 44px calendar')
  await page.locator('[data-quick-actions] [data-action="defer"]').click()
  const sheet = page.locator('[data-defer-menu]')
  await sheet.waitFor()
  if (await sheet.locator('[aria-pressed="true"]').count()) await fail('a preset is picked at first')
  const picked = await sheet.locator('[data-picked-day]').textContent()
  if (!picked.includes('choose a day')) await fail(`picked line: ${picked}`)
  if (await sheet.locator('.grid-cols-7 button.bg-ink').count()) await fail('a day is drawn as picked')
  if (await sheet.locator('[data-ask-scope]').count()) await fail('the task name shows on its own page')
  await atLeast44(sheet.locator('button[title="Previous month"]'), 'previous month')
  await atLeast44(sheet.locator('button[title="Next month"]'), 'next month')
  const dayBox = await box(sheet.locator('.grid-cols-7 button').nth(10))
  if (dayBox.height < 43.5 || dayBox.width < 38) await fail(`a day is ${dayBox.width}×${dayBox.height}`)
  const saveBox = await box(sheet.locator('[data-ask-save]'))
  if (saveBox.y + saveBox.height > H + 1) await fail(`Save is off screen: ${saveBox.y}+${saveBox.height} > ${H}`)
  await shot('4-defer-page')
  // A day on the calendar only picks it (Tomorrow and Next week would save at once).
  await sheet.locator('.grid-cols-7 button').nth(10).click()
  if ((await sheet.locator('.grid-cols-7 button.bg-ink').count()) !== 1) await fail('a calendar day is not picked')
  await shot('5-defer-picked-day')
  await sheet.locator('[data-ask-cancel]').click()
  await sheet.waitFor({ state: 'detached' })

  if (process.env.MODE === 'json') {
    step('no connection: a save says so in words')
    await page.goto(`${base}/t/${taskType.id}`)
    const rowMore = page.locator(`[aria-label="More actions for ${title}"]`).first()
    await rowMore.waitFor({ state: 'attached' })
    await rowMore.scrollIntoViewIfNeeded()
    await page.route('**/api/objects/**', (route) => (route.request().method() === 'GET' ? route.continue() : route.abort('internetdisconnected')))
    await rowMore.click()
    await page.locator('[data-menu-sheet] button', { hasText: /^\s*Done\s*$/ }).click()
    const alert = page.locator('[role=alert]').first()
    await alert.waitFor()
    const text = await alert.textContent()
    console.log(`  error reads: ${text.trim()}`)
    await shot('6-offline')
    if (/Load failed|Failed to fetch|NetworkError when/i.test(text) || !/reach the server/.test(text)) await fail(`error text: ${text}`)
    await page.unroute('**/api/objects/**')
    await page.goto(`${base}/o/${task.id}`)
    await done.waitFor()
  }

  step('Done: Undo and Dismiss 44px; the notice waits while touched')
  await done.click()
  const toast = page.locator('[role=status]', { hasText: 'Undo' })
  await toast.waitFor()
  await atLeast44(toast.locator('button', { hasText: 'Undo' }), 'Undo', { width: false })
  await atLeast44(toast.locator('button[title="Dismiss"]'), 'Dismiss')
  const toastBox = await box(toast)
  if (toastBox.x < 0 || toastBox.x + toastBox.width > W) await fail('toast overflows')
  await shot('7-undo')
  await toast.dispatchEvent('pointerenter')
  await sleep(9000)
  if (!(await toast.count())) await fail('the notice left while held')
  await toast.dispatchEvent('pointerleave')
  await toast.locator('button', { hasText: 'Undo' }).click()
  await toast.waitFor({ state: 'detached' })
} catch (error) {
  await shot('ERROR').catch(() => {})
  throw error
} finally {
  await page.request.delete(`${base}/api/objects/${task.id}`, { headers })
  if (problems.length) console.log(problems.join('\n'))
}
await browser.close()
console.log(`\nAll phone-touch checks passed for ${tag} at ${W}×${H} (screenshots: ${shots}).`)
