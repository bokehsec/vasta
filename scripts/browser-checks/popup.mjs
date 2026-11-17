// The popup window in the test env: with nothing set, a click on an object in a list, table or
// board opens it in a window over the page (?popup=<id>), a sheet from the bottom on a phone;
// Type settings › "Open in" chooses the side pane or its own page instead, and a view's layout
// menu can choose otherwise (Window, Side pane, Full page, Same as the type). In the window it is
// edited (the list behind shows it), another click switches it in place (one Back closes it), and
// back, forward, reload, Esc, clicking outside and "Open full page" all work; the calendar keeps it
// while its view changes; a move to the trash from the window closes it (and Undo brings it back);
// links still go to the object's page. Closing the window goes back in history (Back never reopens
// it) and "Open full page" replaces its entry (one Back returns to the list). Every New (the type
// page's button, the sidebar's, a group's "+", a phone's floating "+") opens the quick card:
// Enter adds and stays, ⌘↩ adds and opens it in the window, Esc cancels leaving nothing behind.
//   node popup.mjs [chromium|webkit] [base] [phone]   (MODE=json: the replica turned off; phone needs chromium)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, devices, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
const phone = process.argv[4] === 'phone'
if (!/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
if (phone && engine !== 'chromium') throw new Error('the phone run needs chromium')

const options = { ...(phone ? devices['Pixel 7'] : { viewport: { width: 1400, height: 900 } }), locale: 'en-US', timezoneId: 'America/Sao_Paulo' }
const launched = engine === 'webkit' ? undefined : await chromium.launch()
const context = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-popup-')), options)
const browser = launched ?? context
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|404|TextSelection endpoint|due to access control checks|SQLITE_CORRUPT|Importing a module script failed|VUE_ROUTER_R0010|router.onError|async component loader/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
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
      const shot = path.join(tmpdir(), `vasta-popup-${engine}${phone ? '-phone' : ''}.png`)
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

const window = page.locator('[data-popup]')
const windowTitle = window.locator('textarea[data-large-text]')
const query = () => new URL(page.url()).searchParams
const popupId = () => query().get('popup')

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector(phone ? 'main' : 'nav', { state: 'attached', timeout: 30000 })

const tag = `${engine}${phone ? '-phone' : ''}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const task = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const pageType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'page')
const day = '2027-06-23' // away from the weeks calendar.mjs drags in
for (const object of await get(`/api/spaces/${space.id}/search?q=Popup&limit=100`)) {
  if (/^Popup /.test(object.title)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}
const { views, properties } = await get(`/api/types/${task.id}`)
const made = {}
for (const name of ['Alpha', 'Bravo', 'Charlie']) {
  made[name] = await post('/api/objects', { typeId: task.id, title: `Popup ${name} ${tag}`, props: { status: { kind: 'select', value: ['todo'] }, due: { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } } } })
}
const typeOpenIn = async () => (await get(`/api/types/${task.id}`)).openIn
const { openIn: _openIn, ...plainTask } = await get(`/api/types/${task.id}`)
await put(`/api/types/${task.id}`, plainTask)
const setLayout = async (layout, openIn = null) => put(`/api/types/${task.id}`, { ...(await get(`/api/types/${task.id}`)), views: [{ id: `${task.id}:all`, name: 'All', layout, ...(openIn ? { openIn } : {}), ...(layout === 'kanban' ? { groupBy: [{ field: 'status' }] } : {}) }] })
const savedOpenIn = async () => (await get(`/api/types/${task.id}`)).views.find((v) => v.id === `${task.id}:all`)?.openIn
await setLayout('list', null)

const t = (name) => `Popup ${name} ${tag}`
/** An object made in the app, once it has reached the server (the replica syncs a moment after). */
const madeAs = (title) => until(async () => (await get(`/api/spaces/${space.id}/search?q=${encodeURIComponent(title)}&limit=10`)).find((o) => o.title === title), `${title} reached the server`, 20000)
const openType = async () => {
  await page.goto(`${base}/t/${task.id}`)
  await until(async () => (await page.locator(`main a[href="/o/${made.Alpha.id}"]`).count()) > 0, 'the type page lists the tasks', 20000)
}

if (phone) {
  step('phone: a click opens the sheet over the page')
  await openType()
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(async () => popupId() === made.Alpha.id && (await window.count()) > 0, 'Alpha in the sheet')
  if (new URL(page.url()).pathname !== `/t/${task.id}`) throw new Error(`the page changed: ${page.url()}`)
  await until(async () => (await windowTitle.inputValue().catch(() => '')) === t('Alpha'), 'Alpha in the sheet', 20000)

  step('phone: the sheet is pulled down to close')
  const grab = await window.locator('[data-sheet-grabber], [class*=grabber]').first().boundingBox().catch(() => undefined)
  const bar = grab ?? (await window.boundingBox())
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 8)
  await page.mouse.down()
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 320, { steps: 8 })
  await page.mouse.up()
  await until(async () => !popupId() && !(await window.count()), 'the sheet closed')

  step('phone: Back closes the sheet, the page stays')
  await page.locator(`main a[href="/o/${made.Bravo.id}"]`).first().click()
  await until(async () => popupId() === made.Bravo.id, 'Bravo in the sheet')
  await page.goBack()
  await until(() => !popupId() && new URL(page.url()).pathname === `/t/${task.id}`, 'back: the list, no sheet')

  step('phone: "Open full page" from the sheet')
  await page.locator(`main a[href="/o/${made.Bravo.id}"]`).first().click()
  await until(async () => popupId() === made.Bravo.id, 'Bravo in the sheet again')
  await window.getByTitle('Open full page').click()
  await until(() => new URL(page.url()).pathname === `/o/${made.Bravo.id}` && !popupId(), 'Bravo as the page')
  await page.goBack()
  await until(() => new URL(page.url()).pathname === `/t/${task.id}` && !popupId(), 'one Back from the full page returns to the list, without the sheet')

  step('phone: the type page has one "+" (the floating one); it opens the quick card for the type')
  await openType()
  // An entry of the app's own to go back to (a reload's first entry would leave the app).
  await page.locator('[data-tab="Inbox"]').click()
  await page.locator('[data-tab="Tasks"]').click()
  await until(async () => new URL(page.url()).pathname === `/t/${task.id}`, 'the Tasks list, reached inside the app')
  if (await page.locator('[data-new-split]').count()) throw new Error('the type page still has its own New button on a phone')
  const plus = page.locator('[data-capture-button]')
  if (!/New Task/.test((await plus.getAttribute('aria-label')) ?? '')) throw new Error('the floating + does not say it makes a task here')
  await plus.click()
  const sheet = page.locator('[data-quick-add]')
  await until(async () => (await sheet.count()) > 0, 'the quick card opens')
  const box = await sheet.boundingBox()
  const height = page.viewportSize().height
  if (Math.abs(box.y + box.height - height) > 2) throw new Error(`the card is not at the bottom: ${JSON.stringify(box)}`)
  for (const control of await sheet.locator('[data-quick-add-save], [data-quick-add-open]').all()) {
    if ((await control.boundingBox()).height < 44) throw new Error('a card button is under 44px')
  }
  // "Capture a note instead" swaps the card for quick capture.
  await sheet.locator('[data-quick-add-capture]').click()
  await until(async () => (await sheet.count()) === 0 && (await page.locator('[data-testid="capture-destination"]').count()) > 0, 'the link opened quick capture and put the card away')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await until(async () => (await page.locator('[data-testid="capture-destination"]').count()) === 0, 'capture closed')
  await plus.click()
  await until(async () => (await sheet.count()) > 0, 'the card opens again')
  await sheet.locator('[data-quick-add-title]').fill(t('Phone card'))
  await sheet.locator('[data-quick-add-save]').click()
  await until(async () => (await sheet.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Phone card')), 'the card says it was added')
  await page.goBack()
  await until(async () => (await sheet.count()) === 0 && new URL(page.url()).pathname === `/t/${task.id}`, 'Back closed the card, the list stays')
} else {
  step('with nothing set, a click in a list opens the window over the page')
  await openType()
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(async () => popupId() === made.Alpha.id && (await windowTitle.inputValue().catch(() => '')) === t('Alpha'), 'Alpha in the window')
  if (new URL(page.url()).pathname !== `/t/${task.id}`) throw new Error(`the page changed: ${page.url()}`)
  if (!(await page.locator(`main a[href="/o/${made.Bravo.id}"]`).count())) throw new Error('the list is gone')
  if (await window.getByText('Comments', { exact: false }).count()) throw new Error('comments in the window')
  if (await window.getByRole('button', { name: /^Activity/ }).count()) throw new Error('activity in the window')

  step('editing in the window saves, and the list shows it')
  await windowTitle.fill(t('Alpha edited'))
  await until(async () => (await get(`/api/objects/${made.Alpha.id}`)).title === t('Alpha edited'), 'the title saved')
  await until(async () => (await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().innerText()).includes(t('Alpha edited')), 'the list shows the new title')

  step('Back closes the window: the list is still there; forward brings it back')
  await page.goBack()
  await until(async () => !popupId() && new URL(page.url()).pathname === `/t/${task.id}`, 'back: the list, no window')
  await page.goForward()
  await until(async () => popupId() === made.Alpha.id, 'forward: Alpha again')

  step('links keep the page as their address (⌘-click, middle click, copy link)')
  const href = await page.locator(`main a[href="/o/${made.Charlie.id}"]`).first().getAttribute('href')
  if (href !== `/o/${made.Charlie.id}`) throw new Error(`href ${href}`)

  step('reload keeps the window; Esc closes it')
  await page.reload()
  await until(async () => (await windowTitle.inputValue().catch(() => '')) === t('Alpha edited'), 'Alpha after reload', 20000)
  await page.keyboard.press('Escape')
  await until(async () => !popupId() && !(await window.count()), 'Esc closed the window')

  step('clicking outside closes it')
  await page.locator(`main a[href="/o/${made.Charlie.id}"]`).first().click()
  await until(async () => popupId() === made.Charlie.id, 'Charlie in the window')
  await page.mouse.click(20, 700)
  await until(async () => !popupId() && !(await window.count()), 'the outside click closed it')

  step('"Open full page" shows it as the page, without a window')
  await page.locator(`main a[href="/o/${made.Charlie.id}"]`).first().click()
  await until(async () => popupId() === made.Charlie.id, 'Charlie in the window')
  await window.getByTitle('Open full page').click()
  await until(async () => new URL(page.url()).pathname === `/o/${made.Charlie.id}` && !popupId() && !(await window.count()), 'Charlie as the page')
  await until(async () => (await page.locator('main textarea[data-large-text]').inputValue()) === t('Charlie'), 'the page shows Charlie')
  await page.goBack()
  await until(async () => new URL(page.url()).pathname === `/t/${task.id}` && !popupId(), 'one Back from the full page returns to the list, without the window')

  step('the same object as the page opens no window')
  await page.goto(`${base}/o/${made.Charlie.id}?popup=${made.Charlie.id}`)
  await until(async () => !popupId() && !(await window.count()), 'the popup address over its own page is dropped', 20000)

  step('Type settings › "Open in": the side pane, and its own page')
  await openType()
  await page.getByTitle('Type settings').click()
  const select = page.locator('[data-open-in]')
  if ((await select.inputValue()) !== 'popup') throw new Error('the type setting starts as the window')
  await select.selectOption('pane')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await typeOpenIn()) === 'pane', 'openIn pane saved on the type')
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(async () => (await page.locator('[data-side-pane]').count()) > 0 && popupId() === null, 'Alpha in the pane, not the window')
  await openType()
  await page.getByTitle('Type settings').click()
  await page.locator('[data-open-in]').selectOption('page')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await typeOpenIn()) === 'page', 'openIn page saved on the type')
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(() => new URL(page.url()).pathname === `/o/${made.Alpha.id}` && !popupId(), 'the page of Alpha')
  await openType()
  await page.getByTitle('Type settings').click()
  await page.locator('[data-open-in]').selectOption('popup')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await typeOpenIn()) === undefined, 'openIn unset again')

  step('a view can choose "Full page" instead, and back to "Same as Task"')
  const layoutMenu = () => page.locator('main button').filter({ hasText: /^\s*List\s*$/ }).click()
  const choice = (name) => page.locator('[data-overlay] button', { hasText: name })
  await layoutMenu()
  if ((await choice('Same as Task').getAttribute('aria-pressed')) !== 'true') throw new Error('the view does not start as the type')
  if (!(await choice('Same as Task').innerText()).includes('window')) throw new Error('the choice does not say what the type does')
  if (!(await choice('Window').count())) throw new Error('no Window choice in the layout menu')
  await choice('Full page').click()
  await until(async () => (await savedOpenIn()) === 'page', 'openIn page saved on the view')
  await page.locator(`main a[href="/o/${made.Alpha.id}"]`).first().click()
  await until(() => new URL(page.url()).pathname === `/o/${made.Alpha.id}` && !popupId(), 'Full page: the page of Alpha')
  await openType()
  await layoutMenu()
  await choice('Same as Task').click()
  await until(async () => (await savedOpenIn()) === undefined, 'the view follows the type again')

  step('table and board: a click opens the window')
  await setLayout('table')
  await openType()
  await page.locator(`main table a[href="/o/${made.Bravo.id}"]`).first().click()
  await until(() => popupId() === made.Bravo.id, 'Bravo from the table')
  await setLayout('kanban')
  await openType()
  await page.locator(`[data-board-card="${made.Charlie.id}"] a`).first().click()
  await until(async () => popupId() === made.Charlie.id && (await windowTitle.inputValue().catch(() => '')) === t('Charlie'), 'Charlie from the board')
  await setLayout('list')

  step('a query opens as each type says')
  const queryType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'query')
  const list = await post('/api/objects', { typeId: queryType.id, title: `Popup query ${tag}`, query: { typeIds: [task.id], layout: 'list' } })
  made.query = list
  await page.goto(`${base}/o/${list.id}`)
  const result = page.locator(`main a[href="/o/${made.Bravo.id}"]`).first()
  await until(async () => (await result.count()) > 0, 'the query lists Bravo', 20000)
  await result.click()
  await until(() => popupId() === made.Bravo.id && new URL(page.url()).pathname === `/o/${list.id}`, 'Bravo from the query, in the window')

  step('the calendar keeps the window while its view changes')
  await page.goto(`${base}/calendar?view=week&date=${day}&popup=${made.Alpha.id}`)
  await until(async () => popupId() === made.Alpha.id && (await windowTitle.inputValue().catch(() => '')) === t('Alpha edited'), 'Alpha in the window over the calendar', 20000)
  await page.keyboard.press('m')
  await until(() => query().get('view') === 'month', 'month view')
  if (popupId() !== made.Alpha.id) throw new Error('the calendar dropped the window')

  step('moving to the trash from the window closes it; Undo brings it back')
  await window.getByTitle('More').click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await until(async () => !popupId() && !(await window.count()), 'the window closed')
  if (new URL(page.url()).pathname !== '/calendar') throw new Error(`left the calendar: ${page.url()}`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await until(() => popupId() === made.Alpha.id, 'Undo reopened it in the window')

  step("the type page's New button opens the quick card: Enter adds and the card stays for the next")
  await openType()
  await page.locator('[data-new-split] button').first().click()
  const card = page.locator('[data-quick-add]')
  const cardTitle = card.locator('[data-quick-add-title]')
  await until(async () => (await card.count()) > 0, 'the quick card opens')
  if (!(await cardTitle.evaluate((el) => el === document.activeElement))) throw new Error('the title does not have the cursor')
  if (!(await card.locator('[data-quick-add-field="Status"]').count())) throw new Error('no Status chip on the card')
  if (await card.locator('[data-quick-add-field="Last reviewed"]').count()) throw new Error('a field shown only with a value is on the card')
  await cardTitle.fill(t('Card'))
  await card.locator('button', { hasText: 'Add a note' }).click()
  await card.locator('[data-quick-add-note]').fill('Ask about Thursday')
  await cardTitle.press('Enter')
  await until(async () => (await card.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Card')), 'the card says it was added')
  if ((await cardTitle.inputValue()) !== '') throw new Error('the title was not cleared for the next one')
  if (!(await cardTitle.evaluate((el) => el === document.activeElement))) throw new Error('the title lost the cursor after adding')
  await until(async () => (await page.locator(`main a`).filter({ hasText: t('Card') }).count()) > 0, 'the list shows the made task')
  if (new URL(page.url()).pathname !== `/t/${task.id}`) throw new Error(`the page changed: ${page.url()}`)
  const cardMade = await madeAs(t('Card'))
  const cardObject = await get(`/api/objects/${cardMade.id}`)
  if (!JSON.stringify(cardObject.content).includes('Ask about Thursday')) throw new Error('the note did not go into the text')
  // a second one, then Undo takes it back
  await cardTitle.fill(t('Card undo'))
  await cardTitle.press('Enter')
  await until(async () => (await card.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Card undo')), 'the second is added')
  await card.locator('[data-quick-add-added] button', { hasText: 'Undo' }).click()
  await until(async () => (await page.locator(`main a`).filter({ hasText: t('Card undo') }).count()) === 0, 'Undo took it out of the list')
  await page.keyboard.press('Escape')
  await until(async () => (await card.count()) === 0, 'Esc closed the card')

  step("the quick card's Open adds and opens the window")
  await page.locator('[data-new-split] button').first().click()
  await until(async () => (await card.count()) > 0, 'the quick card opens again')
  await card.locator('[data-quick-add-title]').fill(t('Card open'))
  await card.locator('[data-quick-add-title]').press('Meta+Enter')
  await until(async () => popupId() && (await windowTitle.inputValue().catch(() => '')) === t('Card open'), 'the made task in the window', 20000)

  step('the sidebar New opens the quick card too: cancelling it leaves nothing behind')
  await page.keyboard.press('Escape')
  await until(async () => !popupId(), 'the window closed')
  await madeAs(t('Card open'))
  await page.goto(`${base}/t/${task.id}`)
  await until(async () => (await page.locator(`main a[href="/o/${made.Alpha.id}"]`).count()) > 0, 'the type page lists the tasks', 20000)
  const untitledBefore = (await get(`/api/spaces/${space.id}/search?q=Untitled&limit=100`)).filter((o) => o.typeId === task.id && !o.title).length
  await page.locator('aside').getByRole('button').filter({ hasText: 'New' }).first().click()
  const picker = page.locator('[data-overlay]')
  await until(async () => (await picker.count()) > 0, 'the type picker opens')
  await picker.getByText('Task', { exact: true }).click()
  await until(async () => (await card.count()) > 0 && !popupId(), 'the quick card opens, not a window')
  await page.keyboard.press('Escape')
  await until(async () => (await card.count()) === 0, 'Esc closed the card')
  await page.waitForTimeout(300)
  const untitledAfter = (await get(`/api/spaces/${space.id}/search?q=Untitled&limit=100`)).filter((o) => o.typeId === task.id && !o.title).length
  if (untitledAfter !== untitledBefore) throw new Error('cancelling a New made an untitled task')

  step('the quick card starts with what the view filters on; what it adds shows in the view')
  const priority = properties.find((p) => p.id === 'priority')
  const high = priority.options[0]
  const byPriority = { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'priority', operator: 'is', value: { kind: 'literal', value: [high.id] } }] }
  await put(`/api/types/${task.id}`, { ...(await get(`/api/types/${task.id}`)), views: [{ id: `${task.id}:all`, name: 'All', layout: 'list', filter: byPriority }] })
  await page.goto(`${base}/t/${task.id}`)
  await page.locator('[data-new-split] button').first().click()
  await until(async () => (await card.count()) > 0, 'the quick card opens')
  const priorityChip = card.locator('[data-quick-add-field="Priority"]')
  await until(async () => (await priorityChip.innerText()).includes(high.label), `the Priority chip starts as ${high.label}`)
  await cardTitle.fill(t('Card filled'))
  await cardTitle.press('Enter')
  await until(async () => (await card.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Card filled')), 'the card says it was added')
  const filledMade = await madeAs(t('Card filled'))
  if ((await get(`/api/objects/${filledMade.id}`)).props.priority?.value?.[0] !== high.id) throw new Error('the added task did not get the view\'s Priority')
  await until(async () => (await page.locator('main a').filter({ hasText: t('Card filled') }).count()) > 0, 'the view lists the added task')
  if (!(await priorityChip.innerText()).includes(high.label)) throw new Error('the next one does not start with the view\'s Priority again')
  await page.keyboard.press('Escape')
  await until(async () => (await card.count()) === 0, 'Esc closed the card')

  step("a group's \"+\" adds into that group")
  const bravo = await get(`/api/objects/${made.Bravo.id}`)
  await put(`/api/objects/${made.Bravo.id}`, { ...bravo, props: { ...bravo.props, status: { kind: 'select', value: ['doing'] } } })
  await put(`/api/types/${task.id}`, { ...(await get(`/api/types/${task.id}`)), views: [{ id: `${task.id}:all`, name: 'All', layout: 'list', groupBy: [{ field: 'status' }] }] })
  await openType()
  await page.locator('[data-group-heading="doing"] [data-group-add]').click()
  await until(async () => (await card.count()) > 0, 'the quick card opens from the group')
  await until(async () => (await card.locator('[data-quick-add-field="Status"]').innerText()).includes('In progress'), 'the Status chip starts as the group (In progress)')
  await cardTitle.fill(t('Card group'))
  await cardTitle.press('Enter')
  await until(async () => (await card.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Card group')), 'the card says it was added')
  const groupMade = await madeAs(t('Card group'))
  if ((await get(`/api/objects/${groupMade.id}`)).props.status?.value?.[0] !== 'doing') throw new Error('the task did not go into the group it was added in')
  await page.keyboard.press('Escape')
  await setLayout('list')

  step("on Today, the sidebar's New starts with today's date")
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await page.goto(`${base}/calendar?view=day&date=${today}`)
  await page.locator('aside').getByRole('button').filter({ hasText: 'New' }).first().click()
  await until(async () => (await picker.count()) > 0, 'the type picker opens')
  await picker.getByText('Task', { exact: true }).click()
  await until(async () => (await card.count()) > 0, 'the quick card opens on Today')
  await cardTitle.fill(t('Card today'))
  await cardTitle.press('Enter')
  await until(async () => (await card.locator('[data-quick-add-added]').innerText().catch(() => '')).includes(t('Card today')), 'the card says it was added')
  const todayMade = await madeAs(t('Card today'))
  const todayTask = await get(`/api/objects/${todayMade.id}`)
  if (!todayTask.props.due?.value?.start?.startsWith(today)) throw new Error(`the new task is not due today: ${JSON.stringify(todayTask.props.due)}`)
  await page.keyboard.press('Escape')

  step('Back on a desktop puts away the quick card, not leaving it over the page that came back')
  await openType()
  await page.locator('aside a', { hasText: 'Inbox' }).first().click()
  await until(() => new URL(page.url()).pathname === '/inbox', 'the Inbox, reached inside the app')
  await page.locator('aside').getByRole('button').filter({ hasText: 'New' }).first().click()
  await until(async () => (await picker.count()) > 0, 'the type picker opens')
  await picker.getByText('Task', { exact: true }).click()
  await until(async () => (await card.count()) > 0, 'the quick card opens on the Inbox')
  await page.goBack()
  await until(async () => new URL(page.url()).pathname === `/t/${task.id}` && (await card.count()) === 0, 'Back went to the list and the card is gone')

  step('closing an untitled item with explicit content or calendar fields keeps it')
  for (const data of [
    { content: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template answer' }] }] } } },
    { props: { due: { kind: 'date', value: { start: `${today}T15:00:00.000Z`, resolution: 'minute' } } } },
  ]) {
    const explicit = await post(`/api/objects`, { typeId: task.id, title: '', ...data })
    await page.goto(`${base}/t/${task.id}?popup=${explicit.id}&new=1`)
    await until(async () => (await page.locator('[data-popup] [contenteditable]').count()) > 0, 'the explicit item opened')
    await page.keyboard.press('Escape')
    await until(async () => !popupId(), 'the explicit item closed')
    await page.waitForTimeout(300)
    const kept = await get(`/api/objects/${explicit.id}`)
    if (data.content && !Object.keys(kept.content ?? {}).length) throw new Error('template content was lost')
    if (data.props && !kept.props.due) throw new Error('calendar date was lost')
    await page.request.delete(`${base}/api/objects/${explicit.id}`, { headers })
  }

}

for (const object of Object.values(made)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
for (const title of [t('Card'), t('Card open'), t('Card undo'), t('Phone card'), t('Card filled'), t('Card today'), t('Card group')]) {
  for (const object of await get(`/api/spaces/${space.id}/search?q=${encodeURIComponent(title)}&limit=10`)) await page.request.delete(`${base}/api/objects/${object.id}`, { headers })
}
{
  const { openIn: _set, ...type } = await get(`/api/types/${task.id}`)
  await put(`/api/types/${task.id}`, { ...type, views, properties })
}

if (problems.length) {
  console.log(problems.join('\n'))
  throw new Error(`${problems.length} console problem(s)`)
}
console.log(phone ? 'phone: ' : '', 'popup ok')
await browser.close()
