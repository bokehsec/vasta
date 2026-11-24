// Group by Due in a list and a board in the test env: ordered day buckets, dragging cards
// between date columns and swimlanes sets the date, and "New" starts a card with it. MODE=json turns the replica off.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:5183'
if (!/^http:\/\/127\.0\.0\.1:518[34]$/.test(base)) throw new Error(`not the test env: ${base}`)
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'America/Toronto' })
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = await context.newPage()
const problems = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/401|TextSelection endpoint/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const step = (name) => console.log(`• ${name}`)
async function until(check, what, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    if (await check()) return
    if (Date.now() - start > timeout) {
      console.log(problems.join('\n'))
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const headers = { 'x-requested-with': 'vasta' }
const get = async (url) => (await page.request.get(`${base}${url}`)).json()
const post = async (url, data) => (await page.request.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => (await page.request.put(`${base}${url}`, { headers, data })).json()

try {
  await page.goto(base)
  await page.fill('#login-username', 'tester')
  await page.fill('#login-password', 'test-password')
  await page.click('button[type=submit]')
  await page.waitForSelector('nav', { state: 'attached', timeout: 30000 })

  const space = await post('/api/spaces', { name: `Date groups ${Date.now() % 100000}` })
  const task = (await get(`/api/spaces/${space.id}`)).types.find((type) => type.system === 'task')
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))
  const shifted = (offset) => new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * 86400000).toISOString()
  const made = {}
  for (const [title, offset] of [['Tomorrow task', 1], ['No date task', undefined], ['Earlier task', -1], ['Today task', 0]]) {
    made[title] = await post('/api/objects', {
      typeId: task.id, title,
      props: { status: { kind: 'select', value: ['todo'] }, ...(offset === undefined ? {} : { due: { kind: 'date', value: { start: shifted(offset), resolution: 'day' } } }) },
    })
  }
  await put(`/api/types/${task.id}`, { ...task, views: [{ id: `${task.id}:dates`, name: 'Dates', layout: 'list' }] })
  // Open the space (the app starts in the last one opened; else from the space menu once it knows it).
  await page.evaluate((id) => localStorage.setItem('vasta.space', id), space.id)
  await page.reload()
  await page.waitForSelector('nav', { state: 'attached' })
  await until(async () => {
    if ((await page.title()).includes(space.name) || (await page.locator('aside').getByText(space.name).count())) return true
    await page.locator('aside button[title="Spaces and account"]').click()
    const item = page.locator('[role=menu]').getByText(space.name)
    if (await item.count()) await item.click()
    else await page.keyboard.press('Escape')
    await sleep(500)
    return false
  }, 'the space open', 30000)
  await page.goto(`${base}/t/${task.id}`)
  await until(() => page.getByRole('link', { name: /Today task/ }).count(), 'the list in the new space', 30000)

  step('Due is offered in Group, and the list headers follow time rather than object order')
  await page.getByRole('button', { name: 'Group', exact: true }).click()
  await page.locator('[data-overlay]').getByRole('button', { name: 'Due', exact: true }).click()
  const listHeaders = page.locator('main section > header > span:first-child')
  await until(async () => JSON.stringify(await listHeaders.allTextContents()) === JSON.stringify(['Earlier', 'Today', 'Tomorrow', 'No date']), 'ordered list groups')
  await until(async () => (await get(`/api/types/${task.id}`)).views[0].groupBy?.[0]?.field === 'due', 'Due grouping saved')

  step('a board keeps the empty date columns')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.locator('[data-overlay]').getByRole('button', { name: 'Board', exact: true }).click()
  const keys = ['past', 'today', 'tomorrow', 'this-week', 'next-week', 'later', '__none']
  const labels = ['Earlier', 'Today', 'Tomorrow', 'This week', 'Next week', 'Later', 'No date']
  await until(async () => (await page.locator('[data-board-cell]').count()) === 7, 'seven date columns')
  const columnHeaders = page.locator('[data-drag-scroll] section > header > span:first-child')
  if (JSON.stringify(await columnHeaders.allTextContents()) !== JSON.stringify(labels)) throw new Error('wrong board headers')
  for (const [index, key] of keys.entries()) {
    const cell = page.locator(`[data-board-cell="${key}|"]`)
    if ((await cell.count()) !== 1) throw new Error(`no ${key} column`)
    const title = { past: 'Earlier task', today: 'Today task', tomorrow: 'Tomorrow task', __none: 'No date task' }[key]
    if (title && !(await cell.getByText(title, { exact: true }).count())) throw new Error(`${title} is not in ${labels[index]}`)
  }
  // A date column does not say the day, so the card still shows its Due.
  const tomorrowCard = page.locator(`[data-board-card="${made['Tomorrow task'].id}"]`)
  if ((await tomorrowCard.innerText()).trim() === 'Tomorrow task') throw new Error('a card in a date column hides its date')

  const findByTitle = async (title) => (await post(`/api/spaces/${space.id}/query`, { query: { typeIds: [task.id] } })).find((o) => o.title === title)?.id
  async function drag(id, target) {
    const card = page.locator(`[data-board-card="${id}"]`)
    await card.scrollIntoViewIfNeeded()
    const from = await card.boundingBox()
    const to = await target.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + 12)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + 12, { steps: 10 })
    const dragging = await page.locator('html').evaluate((element) => element.classList.contains('vasta-dragging'))
    return { dragging, release: async () => { await page.mouse.up(); await sleep(500) } }
  }
  const dueOf = async (id) => (await get(`/api/objects/${id}`)).props.due?.value
  const dayOf = (value) => value?.start.slice(0, 10)
  const dayAt = (offset) => shifted(offset).slice(0, 10)
  async function dropOn(id, target) {
    const { release } = await drag(id, target)
    await release()
  }

  // Every date column on screen at once, so a drag never has to scroll the board.
  await page.setViewportSize({ width: 2400, height: 900 })
  step('a card dropped in Tomorrow gets tomorrow, in No date loses its date')
  const noDate = made['No date task'].id
  await dropOn(noDate, page.locator('[data-board-cell="tomorrow|"]'))
  await until(async () => dayOf(await dueOf(noDate)) === dayAt(1), 'tomorrow set')
  if ((await dueOf(noDate)).resolution !== 'day') throw new Error('a dropped date is not a day')
  await until(() => page.locator('[data-board-cell="tomorrow|"]').getByText('No date task', { exact: true }).count(), 'the card in Tomorrow')
  await dropOn(noDate, page.locator('[data-board-cell="__none|"]'))
  await until(async () => (await dueOf(noDate)) === undefined, 'date cleared')

  step('Earlier refuses a drop: no landing bar, the card snaps back, no New there')
  const todayId = made['Today task'].id
  const before = JSON.stringify(await dueOf(todayId))
  const refused = await drag(todayId, page.locator('[data-board-cell="past|"]'))
  if (!refused.dragging) throw new Error('the card did not start dragging')
  if (await page.locator('[data-board-cell="past|"] .bg-accent').count()) throw new Error('a landing bar over Earlier')
  await refused.release()
  if (JSON.stringify(await dueOf(todayId)) !== before) throw new Error('a drop in Earlier changed the date')
  if (!(await page.locator('[data-board-cell="today|"]').getByText('Today task', { exact: true }).count())) throw new Error('the card left Today')
  if (await page.locator('[data-board-cell="past|"]').getByRole('button', { name: 'New', exact: true }).count()) throw new Error('Earlier offers New')

  step('New in Today makes a task due today')
  await page.locator('[data-board-cell="today|"]').getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('[data-board-cell="today|"] input').fill('Added in Today')
  await page.keyboard.press('Enter')
  await until(() => findByTitle('Added in Today'), 'the new card')
  if (dayOf(await dueOf(await findByTitle('Added in Today'))) !== dayAt(0)) throw new Error('New in Today is not due today')
  await page.keyboard.press('Escape')
  step('New in No date makes a task without a date')
  await page.locator('[data-board-cell="__none|"]').getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('[data-board-cell="__none|"] input').fill('Added without date')
  await page.keyboard.press('Enter')
  await until(() => findByTitle('Added without date'), 'the undated card')
  if ((await dueOf(await findByTitle('Added without date'))) !== undefined) throw new Error('New in No date has a date')
  await page.keyboard.press('Escape')

  step('date swimlanes: a drop sets the date too, Earlier refuses, even with select columns')
  await page.getByRole('button', { name: 'Due', exact: true }).click()
  await page.locator('[data-overlay]').getByRole('button', { name: 'Status', exact: true }).click()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await page.locator('select[aria-label="Swimlanes"]').selectOption({ label: 'Due' })
  await page.keyboard.press('Escape')
  await until(() => page.locator('[data-board-cell="todo|today"]').count(), 'date swimlanes')
  await dropOn(noDate, page.locator('[data-board-cell="todo|tomorrow"]'))
  await until(async () => dayOf(await dueOf(noDate)) === dayAt(1), 'lane date set')
  const laneBefore = JSON.stringify(await dueOf(todayId))
  await dropOn(todayId, page.locator('[data-board-cell="todo|past"]'))
  if (JSON.stringify(await dueOf(todayId)) !== laneBefore) throw new Error('a drop in an Earlier lane changed the date')

  if (problems.length) {
    console.log(problems.join('\n'))
    throw new Error('console problems')
  }
  console.log('ok')
} finally {
  await browser.close()
}
