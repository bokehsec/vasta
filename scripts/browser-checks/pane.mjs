// The side pane in the test env: a click on an object in a list, table, board or the calendar
// opens it next to the page (?pane=<id>), where it is edited; another click switches it; back and
// forward, reload, Esc, "Open full page", resizing (kept after a reload), the calendar keeping it
// while its view changes, a move to the trash from the pane (and Undo), and that links still go
// to the object's page. On a phone profile, the same click opens the page.
//   node pane.mjs [chromium|webkit] [base] [phone]   (MODE=json: the replica turned off; phone needs chromium)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, devices, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
const phone = process.argv[4] === 'phone'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
if (phone && engine !== 'chromium') throw new Error('the phone run needs chromium')

const options = { ...(phone ? devices['Pixel 7'] : { viewport: { width: 1400, height: 900 } }), locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-pane-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|404|TextSelection endpoint|due to access control checks|SQLITE_CORRUPT|Importing a module script failed|VUE_ROUTER_R0010|router.onError/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => !/Importing a module script failed/.test(e.message) && problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-pane-${engine}${phone ? '-phone' : ''}.png`)
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

const pane = page.locator('[data-side-pane]')
const paneTitle = pane.locator('textarea[data-large-text]')
const query = () => new URL(page.url()).searchParams
const paneId = () => query().get('pane')

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector(phone ? 'main' : 'nav', { state: 'attached', timeout: 30000 })

const tag = `${engine}${phone ? '-phone' : ''}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const task = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const day = '2027-06-09' // away from the weeks calendar.mjs drags in
// Tasks left by an earlier run that failed.
for (const object of await get(`/api/spaces/${space.id}/search?q=Pane&limit=100`)) {
  if (/^Pane (Alpha|Bravo|Charlie)/.test(object.title)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}
const views = (await get(`/api/types/${task.id}`)).views
const made = {}
for (const name of ['Alpha', 'Bravo', 'Charlie']) {
  made[name] = await post('/api/objects', { typeId: task.id, title: `Pane ${name} ${tag}`, props: { status: { kind: 'select', value: ['todo'] }, due: { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } } } })
}
const setLayout = async (layout) => put(`/api/types/${task.id}`, { ...(await get(`/api/types/${task.id}`)), views: [{ id: `${task.id}:all`, name: 'All', layout, ...(layout === 'kanban' ? { groupBy: [{ field: 'status' }] } : {}) }] })
await setLayout('list')

const t = (name) => `Pane ${name} ${tag}`
const openType = async () => {
  await page.goto(`${base}/t/${task.id}`)
  await until(async () => (await page.locator(`main a[href="/o/${made.Alpha.id}"]`).count()) > 0, 'the type page lists the tasks', 20000)
}
await openType()

if (phone) {
  step('phone: a click opens the page, and an address with a pane opens the page')
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(() => new URL(page.url()).pathname === `/o/${made.Alpha.id}`, 'the page of Alpha')
  if (await pane.count()) throw new Error('a pane on a phone')
  await page.goto(`${base}/t/${task.id}?pane=${made.Bravo.id}`)
  await until(() => new URL(page.url()).pathname === `/o/${made.Bravo.id}` && !paneId(), 'the pane address becomes the page')
} else {
  step('a click in a list opens the pane next to the page')
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(async () => paneId() === made.Alpha.id && (await paneTitle.inputValue().catch(() => '')) === t('Alpha'), 'Alpha in the pane')
  if (new URL(page.url()).pathname !== `/t/${task.id}`) throw new Error(`the page changed: ${page.url()}`)
  if (!(await page.locator(`main a[href="/o/${made.Bravo.id}"]`).count())) throw new Error('the list is gone')
  if (await pane.getByText('Comments', { exact: false }).count()) throw new Error('comments in the pane')
  if (await pane.getByRole('button', { name: /^Activity/ }).count()) throw new Error('activity in the pane')

  step('editing in the pane saves, and the list shows it')
  await paneTitle.fill(t('Alpha edited'))
  await until(async () => (await get(`/api/objects/${made.Alpha.id}`)).title === t('Alpha edited'), 'the title saved')
  await until(async () => (await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().innerText()).includes(t('Alpha edited')), 'the list shows the new title')

  step('another click switches the pane; back and forward follow it')
  await page.locator(`main a[href="/o/${made.Bravo.id}"]`).first().click()
  await until(async () => paneId() === made.Bravo.id && (await paneTitle.inputValue().catch(() => '')) === t('Bravo'), 'Bravo in the pane')
  await page.goBack()
  await until(async () => paneId() === made.Alpha.id && (await paneTitle.inputValue().catch(() => '')) === t('Alpha edited'), 'back: Alpha')
  await page.goForward()
  await until(() => paneId() === made.Bravo.id, 'forward: Bravo')

  step('links keep the page as their address (⌘-click, middle click, copy link)')
  const href = await page.locator(`main a[href="/o/${made.Charlie.id}"]`).first().getAttribute('href')
  if (href !== `/o/${made.Charlie.id}`) throw new Error(`href ${href}`)

  step('reload keeps the pane; Esc closes it')
  await page.reload()
  await until(async () => (await paneTitle.inputValue().catch(() => '')) === t('Bravo'), 'Bravo after reload', 20000)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('Escape')
  await until(async () => !paneId() && !(await pane.count()), 'Esc closed the pane')

  step('the pane is resized by its edge and keeps its width after a reload')
  await page.locator(`main a[href="/o/${made.Charlie.id}"]`).first().click()
  await until(async () => (await pane.count()) && paneId() === made.Charlie.id, 'Charlie in the pane')
  const before = (await pane.boundingBox()).width
  const edge = await pane.getByRole('separator').boundingBox()
  await page.mouse.move(edge.x + 2, edge.y + 200)
  await page.mouse.down()
  await page.mouse.move(edge.x - 120, edge.y + 200, { steps: 6 })
  await page.mouse.up()
  const wider = (await pane.boundingBox()).width
  if (wider < before + 100) throw new Error(`resize: ${before} → ${wider}`)
  await page.reload()
  await until(async () => (await pane.count()) && Math.abs((await pane.boundingBox()).width - wider) < 2, 'the width after reload', 20000)

  step('"Open full page" shows it as the page, without a pane')
  await pane.getByTitle('Open full page').click()
  await until(async () => new URL(page.url()).pathname === `/o/${made.Charlie.id}` && !paneId() && !(await pane.count()), 'Charlie as the page')
  await until(async () => (await page.locator('main textarea[data-large-text]').inputValue()) === t('Charlie'), 'the page shows Charlie')

  step('the same object as the page opens no pane')
  await page.goto(`${base}/o/${made.Charlie.id}?pane=${made.Charlie.id}`)
  await until(async () => !paneId() && !(await pane.count()), 'the pane address over its own page is dropped', 20000)

  step('table: the title opens the pane')
  await setLayout('table')
  await openType()
  await page.locator(`main table a[href="/o/${made.Bravo.id}"]`).first().click()
  await until(() => paneId() === made.Bravo.id, 'Bravo from the table')

  step('board: a card opens the pane')
  await setLayout('kanban')
  await openType()
  await page.locator(`[data-board-card="${made.Charlie.id}"] a`).first().click()
  await until(async () => paneId() === made.Charlie.id && (await paneTitle.inputValue().catch(() => '')) === t('Charlie'), 'Charlie from the board')

  step('calendar: an entry opens the pane, which stays while the view changes')
  await page.goto(`${base}/calendar?view=week&date=${day}`)
  const entry = page.locator(`[data-calendar-entry][href="/o/${made.Alpha.id}"]`).first()
  await until(async () => (await entry.count()) > 0, 'Alpha in the calendar', 20000)
  await entry.click()
  await until(async () => paneId() === made.Alpha.id && (await paneTitle.inputValue().catch(() => '')) === t('Alpha edited'), 'Alpha from the calendar')
  await page.getByRole('button', { name: 'Month', exact: true }).first().click()
  await until(() => query().get('view') === 'month', 'month view')
  if (paneId() !== made.Alpha.id) throw new Error('the calendar dropped the pane')

  step('moving to the trash from the pane closes it; Undo brings it back')
  await pane.getByTitle('More').click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await until(async () => !paneId() && !(await pane.count()), 'the pane closed')
  if (new URL(page.url()).pathname !== '/calendar') throw new Error(`left the calendar: ${page.url()}`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await until(() => paneId() === made.Alpha.id, 'Undo reopened it in the pane')
}

for (const object of Object.values(made)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
await put(`/api/types/${task.id}`, { ...(await get(`/api/types/${task.id}`)), views })

if (problems.length) {
  console.log(problems.join('\n'))
  throw new Error('console problems')
}
console.log(`pane: ok (${engine}${phone ? ', phone' : ''}${process.env.MODE === 'json' ? ', json' : ''})`)
await browser.close()
