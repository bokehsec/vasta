// Task completion feedback on the Tasks page (Phase 1 acceptance): a task marked Done stays where it
// was, checked, muted and struck through, until a fresh view. Views filter on status Next, due Today
// and "not Done", so a completed task would normally vanish. Per layout (list without and with
// columns, desktop table / phone rows, cards, list with quick actions, status board): the accessible
// checkbox, the struck title, the same order before and after a background save, Undo back to exactly
// Next, a reload dropping it. Also: board column kept and a drag to Done still moving the card, search
// keeping matching rows, a view switch clearing them, a repeating task ("Done this time · Next: …",
// Undo, the last occurrence, a fresh Today view dropping it), rapid double taps, the full page and
// Back (phone: gone) against the side pane (desktop: stays), bulk Done, and (MODE=json) a failed save
// with Retry and a bulk partial failure; replica on: Done while offline.
//   node completion-feedback.mjs [chromium|webkit] [base]
//   MODE=json: the replica turned off (HTTP mode); SHOTS=<dir>: a screenshot per layout;
//   WIDTH=desktop|phone and THEME=light|dark run one cell of the matrix (default: all four)
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
if (!['chromium', 'webkit'].includes(engine)) throw new Error(`unknown engine: ${engine}`)
if (!/^http:\/\/(127\.0\.0\.1|localhost):(5183|5383)$/.test(base)) throw new Error(`not the test env: ${base}`)
const json = process.env.MODE === 'json'
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const profiles = {
  desktop: { viewport: { width: 1280, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, ...(engine === 'webkit' ? {} : { isMobile: true }) },
}
const sizes = (process.env.WIDTH ?? 'desktop,phone').split(',')
const themes = (process.env.THEME ?? 'light,dark').split(',')
for (const size of sizes) if (!profiles[size]) throw new Error(`unknown WIDTH: ${size}`)
for (const theme of themes) if (!['light', 'dark'].includes(theme)) throw new Error(`unknown THEME: ${theme}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const headers = { 'x-requested-with': 'vasta' }
const unexpectedProblem = (text) => !/401|TextSelection endpoint|due to access control checks|async component loader|linkifyjs: already initialized|Failed to load resource|Importing a module script failed/.test(text)
const launched = engine === 'webkit' ? undefined : await chromium.launch()

let context
let page
let label = ''
let size = 'desktop'
let theme = 'light'
let problems = []
let failing = new Set()
let days
const skipped = []
const failures = []

async function openContext(wanted, scheme) {
  const options = { ...profiles[wanted], locale: 'en-US', timezoneId: 'America/Toronto', colorScheme: scheme }
  const opened = launched ? await launched.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-completion-')), options)
  await opened.addInitScript((value) => {
    try {
      localStorage.setItem('vasta.theme', value)
    } catch {}
  }, scheme)
  if (json) await opened.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
  if (engine === 'webkit' && wanted === 'phone') {
    await opened.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        if (!/hover:\s*none/.test(query)) return original(query)
        return { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
      }
    })
  }
  const opening = opened.pages()[0] ?? (await opened.newPage())
  opening.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && unexpectedProblem(m.text()) && problems.push(`${m.type()}: ${m.text()}`))
  opening.on('pageerror', (e) => unexpectedProblem(e.message) && problems.push(`pageerror: ${e.message}`))
  await opening.goto(base)
  await opening.fill('#login-username', 'tester')
  await opening.fill('#login-password', 'test-password')
  await opening.click('button[type=submit]')
  await opening.waitForSelector('main', { timeout: 30000 })
  return { opened, opening }
}

async function until(check, what, timeout = 12000) {
  const start = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - start > timeout) {
      if (problems.length) console.log(problems.join('\n'))
      const shot = path.join(tmpdir(), `vasta-completion-${label}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      console.log('screenshot:', shot)
      throw new Error(`timed out: ${what}`)
    }
    await sleep(200)
  }
}
const expect = (ok, what) => {
  if (!ok) throw new Error(what)
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const setup = await openContext('desktop', 'light')
const api = setup.opening.request
const get = async (url) => (await api.get(`${base}${url}`)).json()
const post = async (url, data) => (await api.post(`${base}${url}`, { headers, data })).json()
const put = async (url, data) => {
  const response = await api.put(`${base}${url}`, { headers, data })
  if (!response.ok()) throw new Error(`PUT ${url}: ${response.status()} ${await response.text()}`)
  return response.json()
}
const del = (id) => api.delete(`${base}/api/objects/${id}`, { headers }).catch(() => {})

const tagRoot = `${engine}-${Date.now() % 100000}`
const space = (await get('/api/spaces'))[0]
const taskType = (await get(`/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const found = await get(`/api/types/${taskType.id}`)
const status = found.properties.find((p) => p.id === 'status')
const doneId = status.options.find((o) => o.status === 'done').id
const nextId = 'cfnext'
const prefix = `${taskType.id}:cf`
const keys = ['list', 'cols', 'table', 'grid', 'quick', 'board', 'pane', 'other']
const ids = Object.fromEntries(keys.map((key) => [key, `${prefix}${key}`]))
const original = {
  ...found,
  views: found.views.filter((v) => !v.id.startsWith(prefix)),
  properties: found.properties.map((p) => (p.id === 'status' ? { ...p, options: p.options.filter((o) => o.id !== nextId) } : p)),
}

async function cleanTasks() {
  for (const object of await get(`/api/spaces/${space.id}/search?q=CompletionFeedback&limit=100`)) await del(object.id)
}

try {
  await cleanTasks()
  days = await setup.opening.evaluate(() => {
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const add = (day, n) => key(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86400000))
    const today = key(new Date())
    return { today, week: add(today, 7) }
  })
  const ours = { kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'CompletionFeedback' } }
  const dueToday = { kind: 'filter', field: 'due', operator: 'is', value: { kind: 'variable', name: 'today' } }
  const isNext = { kind: 'filter', field: 'status', operator: 'is', value: { kind: 'literal', value: [nextId] } }
  const notDone = { kind: 'filter', field: 'status', operator: 'not-contains', value: { kind: 'literal', value: [doneId] } }
  const group = (...items) => ({ kind: 'group', operator: 'and', items })
  const newest = [{ field: 'updatedAt', direction: 'desc' }]
  const tasksFilter = group(ours, isNext, dueToday, notDone)
  await put(`/api/types/${taskType.id}`, {
    ...original,
    properties: original.properties.map((p) => (p.id === 'status' ? { ...p, options: [...p.options, { id: nextId, label: 'Next', status: 'todo', color: 'purple' }] } : p)),
    views: [
      { id: ids.list, name: 'CFList', layout: 'list', openIn: 'page', sort: newest, filter: tasksFilter },
      { id: ids.cols, name: 'CFCols', layout: 'list', openIn: 'page', sort: newest, list: { fields: ['status', 'due'] }, filter: tasksFilter },
      { id: ids.table, name: 'CFTable', layout: 'table', openIn: 'page', sort: newest, table: { columns: [{ field: 'title' }, { field: 'status' }, { field: 'due' }] }, filter: tasksFilter },
      { id: ids.grid, name: 'CFGrid', layout: 'grid', openIn: 'page', sort: newest, filter: tasksFilter },
      { id: ids.quick, name: 'CFQuick', layout: 'list', openIn: 'page', sort: newest, quickActions: true, filter: tasksFilter },
      { id: ids.board, name: 'CFBoard', layout: 'kanban', openIn: 'page', groupBy: [{ field: 'status' }], filter: group(ours, dueToday) },
      { id: ids.pane, name: 'CFPane', layout: 'list', openIn: 'pane', sort: newest, filter: tasksFilter },
      { id: ids.other, name: 'CFOther', layout: 'list', openIn: 'page', filter: group(ours) },
      ...original.views,
    ],
  })
  await sleep(1500)

  const dueValue = (rrule) => ({ kind: 'date', value: { start: `${days.today}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })
  const isPhone = () => size === 'phone'
  const press = (locator) => (isPhone() ? locator.tap() : locator.click())
  const toast = () => page.locator('[role=status]')

  const scope = (layout, task) => {
    if (layout === 'board') return page.locator(`[data-board-card="${task.id}"]`)
    if (layout === 'table' && !isPhone()) return page.locator(`main tr:has(a[href="/o/${task.id}"])`)
    return page.locator(`main a[href="/o/${task.id}"]`).first()
  }
  const check = (layout, task) => scope(layout, task).locator('[data-task-check]')
  const struck = async (layout, task) => {
    const title = scope(layout, task).locator('.task-title-done')
    return (await title.count()) === 1 && (await title.evaluate((el) => getComputedStyle(el).textDecorationLine.includes('line-through')))
  }
  const pressed = async (layout, task) => (await check(layout, task).getAttribute('aria-pressed').catch(() => null)) === 'true'
  const present = async (layout, task) => (await scope(layout, task).count()) > 0
  const titleColor = (layout, task) => scope(layout, task).locator('.task-title').first().evaluate((el) => getComputedStyle(el).color)
  const apiStatus = async (task) => (await get(`/api/objects/${task.id}`)).props.status?.value?.[0]
  const apiDue = async (task) => (await get(`/api/objects/${task.id}`)).props.due?.value
  const dayOf = (due) => due?.start?.slice(0, 10)

  const showColumn = async (key) => {
    const chip = page.locator(`[data-board-chip="${key}"]`)
    if (await chip.count()) await press(chip.first())
    await sleep(300)
  }
  const drawn = async (layout, made, column = nextId) => {
    const known = new Set(made.map((t) => t.id))
    const found = layout === 'board'
      ? await page.locator(`[data-board-cell="${column}|"] [data-board-card]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-board-card')))
      : await page.locator('main a[href^="/o/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href').slice(3)))
    return [...new Set(found)].filter((id) => known.has(id))
  }
  const openView = async (layout, made, column = nextId) => {
    await page.goto(`${base}/t/${taskType.id}?view=${ids[layout]}`)
    await until(() => present(layout, made[0]), `${layout} view lists the tasks`, 20000)
    if (layout === 'board') await showColumn(column)
  }
  const complete = async (layout, task) => {
    if (layout === 'quick' && !isPhone()) {   // a phone's rows swipe instead: its checkbox
      await scope(layout, task).hover()
      await press(scope(layout, task).locator('[data-action="done"]'))
    } else await press(check(layout, task))
  }
  const syncOrder = async (layout, made, expected, what) => {
    await sleep(600)
    const order = await drawn(layout, made)
    expect(same(order, expected), `${what}: order ${order} instead of ${expected}`)
  }
  const makeTasks = async (names, props = () => ({})) => {
    const made = []
    for (const name of names) {
      made.push(await post('/api/objects', {
        typeId: taskType.id,
        title: `CompletionFeedback ${name} ${tagRoot}-${label}`,
        props: { status: { kind: 'select', value: [nextId] }, due: dueValue(), ...props(name) },
      }))
      await sleep(60)
    }
    await sleep(1200)
    return made
  }
  const withTasks = async (names, props, run) => {
    const made = await makeTasks(names, props)
    try {
      return await run(made)
    } finally {
      failing.clear()
      await context.setOffline(false).catch(() => {})
      for (const task of made) await del(task.id)
    }
  }
  const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `completion-${label}-${name}.png`) })

  const setSearch = async (text) => {
    if (isPhone()) {
      await press(page.locator('[data-filters-button]'))
      await page.locator('[data-filters-search]').fill(text)
      await press(page.locator('[data-filters-done]'))
      await until(async () => !(await page.locator('[data-filters-done]').isVisible()), 'the Filters sheet closes')
    } else await page.locator('main input[placeholder="Filter…"]').fill(text)
  }
  const switchView = async (name) => {
    const exact = new RegExp(`^\\s*${name}\\s*$`)
    if (isPhone()) {
      await press(page.locator('[data-view-picker]'))
      await press(page.locator('[data-view-option]', { hasText: exact }))
    } else await press(page.locator('main :is(button, [role=button])', { hasText: exact }).first())
  }
  const backToList = async () => {
    const back = page.locator('[data-top-back]')
    if (await back.count()) await press(back.first())
    else await page.goBack()
  }
  const routeSaves = async () => {
    await page.route('**/api/objects/*', (route) => {
      const request = route.request()
      const id = new URL(request.url()).pathname.split('/').pop()
      if (request.method() === 'PUT' && failing.has(id)) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"refused for the test"}' })
      return route.continue()
    })
  }

  async function layoutSuite(layout) {
    await withTasks(['Alpha', 'Bravo', 'Charlie'], undefined, async (made) => {
      await openView(layout, made)
      if (layout === 'list' || layout === 'cols') expect(((await page.locator('main [data-row-fields]').count()) > 0) === (layout === 'cols'), `${layout}: row fields ${layout === 'cols' ? 'missing' : 'shown'}`)
      const before = await drawn(layout, made)
      expect(before.length === 3, `${layout}: ${before.length} rows`)
      const target = made.find((t) => t.id === before[1])
      const other = made.find((t) => t.id === before[0])
      expect((await scope(layout, target).getByRole('button', { name: 'Mark as done' }).count()) === 1, `${layout}: no accessible "Mark as done" button`)
      expect(!(await pressed(layout, target)) && !(await struck(layout, target)), `${layout}: shown done before it was`)
      if (layout === 'quick' && !isPhone()) expect((await scope(layout, target).locator('[data-action="done"]').count()) === 1, 'quick: no Done button on the row')

      await complete(layout, target)
      await until(async () => (await apiStatus(target)) === doneId, `${layout}: Done saved`)
      await until(() => struck(layout, target), `${layout}: the title struck through`)
      await until(() => pressed(layout, target), `${layout}: the checkbox checked`)
      expect((await scope(layout, target).getByRole('button', { name: 'Mark as to do' }).count()) === 1, `${layout}: label did not become "Mark as to do"`)
      await until(async () => (await titleColor(layout, target)) !== (await titleColor(layout, other)), `${layout}: the done title is muted`)
      expect(!(await struck(layout, other)), `${layout}: another task struck`)
      expect((await scope(layout, target).locator('[data-completion-note]').count()) === 0, `${layout}: a repeat note on a task that does not repeat`)
      await syncOrder(layout, made, before, `${layout}: after Done`)
      if (layout === 'board') {
        expect((await page.locator(`[data-board-cell="done|"] [data-board-card="${target.id}"]`).count()) === 0, 'board: the card moved to Done')
        expect((await page.locator(`[data-board-cell="${nextId}|"] [data-board-card="${target.id}"]`).count()) === 1, 'board: the card left its column')
      }
      await shot(layout)

      const stored = await get(`/api/objects/${target.id}`)
      await put(`/api/objects/${target.id}`, { ...stored, title: `${stored.title} synced` })
      for (let i = 0; i < 4 && !(await scope(layout, target).innerText()).includes('synced'); i++) {
        await page.evaluate(() => {
          window.dispatchEvent(new Event('focus'))
          document.dispatchEvent(new Event('visibilitychange'))
        })
        await sleep(1500)
      }
      if (!(await scope(layout, target).innerText()).includes('synced')) console.log(`  (${label} ${layout}: the background save did not reach the page in 6s; order checked without it)`)
      await syncOrder(layout, made, before, `${layout}: after a background save`)
      expect((await struck(layout, target)) && (await pressed(layout, target)), `${layout}: not struck/checked after a background save`)

      await press(check(layout, target))
      await until(async () => (await apiStatus(target)) === nextId, `${layout}: Undo returns exactly Next`)
      await until(async () => !(await struck(layout, target)) && !(await pressed(layout, target)), `${layout}: unchecked after Undo`)
      expect(dayOf(await apiDue(target)) === days.today, `${layout}: Undo changed the due date`)
      await syncOrder(layout, made, before, `${layout}: after Undo`)

      await complete(layout, target)
      await until(async () => (await apiStatus(target)) === doneId && (await struck(layout, target)), `${layout}: Done again`)
      await page.reload()
      await until(() => present(layout, other), `${layout}: the view after a reload`, 20000)
      // A board has no status filter: a fresh view draws the Done card in its Done column, not in Next.
      if (layout === 'board') await until(async () => (await page.locator(`[data-board-cell="${nextId}|"] [data-board-card="${target.id}"]`).count()) === 0, `${layout}: a reload moves the completed card out of Next`)
      else await until(async () => !(await present(layout, target)), `${layout}: a reload drops the completed task`)
    })
  }

  async function exactStatusUndo() {
    await withTasks(['Doing'], () => ({ status: { kind: 'select', value: ['doing'] } }), async (made) => {
      const [task] = made
      await openView('board', made, 'doing')
      await until(async () => (await page.locator(`[data-board-cell="doing|"] [data-board-card="${task.id}"]`).count()) === 1, 'the task is in In progress')
      await press(check('board', task))
      await until(async () => (await apiStatus(task)) === doneId, 'Done saved')
      await until(() => struck('board', task), 'the card struck')
      expect((await page.locator(`[data-board-cell="doing|"] [data-board-card="${task.id}"]`).count()) === 1, 'the card left In progress')
      expect((await page.locator(`[data-board-cell="done|"] [data-board-card="${task.id}"]`).count()) === 0, 'the card jumped to Done')
      await press(check('board', task))
      await until(async () => (await apiStatus(task)) === 'doing', 'Undo returns exactly In progress')
    })
  }

  async function dragToDone() {
    await withTasks(['Alpha', 'Bravo', 'Charlie'], undefined, async (made) => {
      await openView('board', made)
      const order = await drawn('board', made)
      const [kept, moved] = [made.find((t) => t.id === order[0]), made.find((t) => t.id === order[1])]
      await press(check('board', kept))
      await until(async () => (await apiStatus(kept)) === doneId && (await struck('board', kept)), 'the checkbox completed a card')
      await scope('board', moved).scrollIntoViewIfNeeded()   // the Next column is clipped at the board's right edge
      const from = await scope('board', moved).boundingBox()
      const cell = await page.locator('[data-board-cell="done|"]').boundingBox()
      const start = { x: from.x + from.width * 0.6, y: from.y + from.height / 2 }
      const end = { x: cell.x + cell.width / 2, y: cell.y + Math.min(cell.height, 120) / 2 }
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + ((end.x - start.x) * i) / 10, start.y + ((end.y - start.y) * i) / 10)
      await sleep(100)
      await page.mouse.up()
      await until(async () => (await apiStatus(moved)) === doneId, 'dragging to Done saved Done')
      await until(async () => (await page.locator(`[data-board-cell="done|"] [data-board-card="${moved.id}"]`).count()) === 1, 'the dragged card is in the Done column')
      expect((await page.locator(`[data-board-cell="${nextId}|"] [data-board-card="${kept.id}"]`).count()) === 1 && (await struck('board', kept)), 'the checked card left its column when another was dragged')
    })
  }

  async function searchAndSwitch() {
    await withTasks(['Alpha', 'Bravo', 'Charlie'], undefined, async (made) => {
      const [alpha, bravo] = made
      await openView('cols', made)
      await press(check('cols', alpha))
      await until(async () => (await apiStatus(alpha)) === doneId && (await struck('cols', alpha)), 'Alpha done and struck')
      await setSearch('Alpha')
      await until(async () => (await present('cols', alpha)) && !(await present('cols', bravo)), 'search matching the done task keeps it')
      expect(await struck('cols', alpha), 'search cleared the strike')
      await setSearch('Bravo')
      await until(async () => !(await present('cols', alpha)) && (await present('cols', bravo)), 'search not matching hides it')
      await setSearch('')
      await until(async () => (await present('cols', alpha)) && (await present('cols', bravo)), 'clearing the search brings both back')
      expect(await struck('cols', alpha), 'the row lost its strike after the search')
      await switchView('CFOther')
      await until(async () => (await present('cols', bravo)) && !(await present('cols', alpha)), 'another view lists no completed task')
      await switchView('CFCols')
      await until(async () => (await present('cols', bravo)) && !(await present('cols', alpha)), 'coming back: a fresh view without the completed task')
    })
  }

  async function repeating() {
    const weekly = 'FREQ=WEEKLY;COUNT=3'
    await withTasks(['Repeat', 'Plain'], (name) => (name === 'Repeat' ? { due: dueValue(weekly) } : {}), async (made) => {
      const [repeat, plain] = made
      await openView('cols', made)
      const note = scope('cols', repeat).locator('[data-completion-note]')
      await press(check('cols', repeat))
      await until(async () => dayOf(await apiDue(repeat)) === days.week, 'the due date advanced a week')
      expect((await apiStatus(repeat)) === nextId, 'a repeating task did not stay Next')
      await until(async () => (await note.count()) === 1 && /^Done this time · Next: \S/.test((await note.innerText()).trim()), 'the row reads "Done this time · Next: …"')
      expect((await struck('cols', repeat)) && (await pressed('cols', repeat)), 'the repeating row is not struck and checked')
      expect(!(await struck('cols', plain)), 'another row struck')
      await shot('repeat')

      await press(check('cols', repeat))
      await until(async () => dayOf(await apiDue(repeat)) === days.today, 'Undo restored the due date')
      const restored = await apiDue(repeat)
      expect(restored.rrule === weekly, `Undo changed the rule: ${restored.rrule}`)
      expect((await apiStatus(repeat)) === nextId, 'Undo did not return Next')
      await until(async () => (await note.count()) === 0 && !(await struck('cols', repeat)) && !(await pressed('cols', repeat)), 'the note and strike gone after Undo')

      await press(check('cols', repeat))
      await until(async () => dayOf(await apiDue(repeat)) === days.week && (await note.count()) === 1, 'completing again advances once')
      await sleep(1000)
      expect(dayOf(await apiDue(repeat)) === days.week, 'the due date advanced more than once')
      await page.reload()
      await until(() => present('cols', plain), 'the Today view after a reload', 20000)
      await until(async () => !(await present('cols', repeat)), 'a fresh Today view drops a task whose next date is not today')
    })
    await withTasks(['Final'], () => ({ due: dueValue('FREQ=WEEKLY;COUNT=1') }), async (made) => {
      const [last] = made
      await openView('cols', made)
      await press(check('cols', last))
      await until(async () => (await apiStatus(last)) === doneId, 'the last occurrence is completed normally')
      expect(dayOf(await apiDue(last)) === days.today, 'the last occurrence moved its date')
      await until(() => struck('cols', last), 'the last occurrence struck')
      expect((await scope('cols', last).locator('[data-completion-note]').count()) === 0, 'a note on the last occurrence')
      await press(check('cols', last))
      await until(async () => (await apiStatus(last)) === nextId, 'Undo on the last occurrence returns Next')
    })
  }

  async function doubleTap() {
    await withTasks(['Plain', 'Repeat'], (name) => (name === 'Repeat' ? { due: dueValue('FREQ=WEEKLY;COUNT=3') } : {}), async (made) => {
      const [plain, repeat] = made
      await openView('cols', made)
      for (const task of [plain, repeat]) await check('cols', task).evaluate((el) => {
        el.click()
        el.click()
      })
      await until(async () => (await apiStatus(plain)) === doneId, 'a double tap completes')
      await until(async () => dayOf(await apiDue(repeat)) === days.week, 'a double tap on a repeating task advances it')
      await sleep(1500)
      expect((await apiStatus(plain)) === doneId, 'the second tap undid the completion')
      expect(dayOf(await apiDue(repeat)) === days.week, 'a double tap advanced a repeating task twice')
      expect((await pressed('cols', plain)) && (await struck('cols', plain)), 'the double-tapped row is not struck and checked')
    })
  }

  async function pageAndBack() {
    await withTasks(['Alpha', 'Bravo'], undefined, async (made) => {
      const [first, second] = made
      await openView('list', made)
      await press(scope('list', first).locator('.task-title').first())
      await page.waitForURL(/\/o\//)
      const quick = page.locator('[data-quick-actions] button[data-action="done"]')
      await until(async () => (await quick.count()) === 1, 'the task page offers Done')
      await press(quick)
      await until(async () => (await apiStatus(first)) === doneId, 'Done saved from the task page')
      await backToList()
      await until(() => present('list', second), 'the list after Back', 20000)
      await until(async () => !(await present('list', first)), 'Back after Done from the task page: the task is gone')
    })
  }

  async function sidePane() {
    await withTasks(['Alpha', 'Bravo'], undefined, async (made) => {
      const [first, second] = made
      await openView('pane', made)
      await press(scope('pane', first).locator('.task-title').first())
      const pane = page.locator('[data-side-pane]')
      await pane.waitFor()
      await press(pane.locator('[data-quick-actions] button[data-action="done"]'))
      await until(async () => (await apiStatus(first)) === doneId, 'Done saved from the side pane')
      await until(() => struck('pane', first), 'the row struck behind the pane')
      await page.keyboard.press('Escape')
      await until(async () => !(await pane.isVisible().catch(() => false)), 'Escape closes the pane')
      await sleep(600)
      expect((await present('pane', first)) && (await struck('pane', first)) && (await present('pane', second)), 'the row did not stay after the pane closed')
    })
  }

  async function bulk() {
    await withTasks(['Alpha', 'Bravo', 'Charlie'], undefined, async (made) => {
      await openView('list', made)
      const before = await drawn('list', made)
      const picked = before.slice(0, 2).map((id) => made.find((t) => t.id === id))
      const rest = made.find((t) => t.id === before[2])
      for (const task of picked) {
        await scope('list', task).hover()
        await scope('list', task).locator('[data-select-row]').click()
      }
      await until(async () => (await page.locator('[data-bulk-count]').innerText()) === '2 selected', '2 selected')
      await page.locator('[data-bulk-action="done"]').click()
      for (const task of picked) await until(async () => (await apiStatus(task)) === doneId && (await struck('list', task)), 'bulk Done: saved and struck')
      expect(!(await struck('list', rest)), 'bulk Done struck an unselected row')
      await until(async () => (await page.locator('[data-bulk-bar]').count()) === 0, 'the selection ends after a full success')
      await syncOrder('list', made, before, 'bulk Done')
    })
  }

  async function bulkPartialFailure() {
    await withTasks(['Alpha', 'Bravo', 'Charlie'], undefined, async (made) => {
      await openView('list', made)
      const before = await drawn('list', made)
      const [first, broken, third] = before.map((id) => made.find((t) => t.id === id))
      for (const task of [first, broken, third]) {
        await scope('list', task).hover()
        await scope('list', task).locator('[data-select-row]').click()
      }
      await until(async () => (await page.locator('[data-bulk-count]').innerText()) === '3 selected', '3 selected')
      failing.add(broken.id)
      await page.locator('[data-bulk-action="done"]').click()
      for (const task of [first, third]) await until(async () => (await apiStatus(task)) === doneId && (await struck('list', task)), 'the rows that saved stay struck')
      await until(async () => !(await struck('list', broken)) && !(await pressed('list', broken)), 'the failed row is restored')
      expect((await apiStatus(broken)) === nextId, 'the failed task changed')
      await until(async () => (await page.locator('[data-bulk-count]').innerText()) === '1 selected' && (await page.locator('[data-bulk-retry]').count()) === 1, 'the failed row stays picked with a Retry')
      await syncOrder('list', made, before, 'bulk partial failure')
      failing.delete(broken.id)
      await page.locator('[data-bulk-retry]').click()
      await until(async () => (await apiStatus(broken)) === doneId && (await struck('list', broken)), 'Retry completes the failed row')
      await until(async () => (await page.locator('[data-bulk-bar]').count()) === 0, 'the selection ends after the retry')
    })
  }

  async function failedSave() {
    await withTasks(['Alpha', 'Bravo'], undefined, async (made) => {
      const [task, other] = made
      await openView('cols', made)
      const before = await drawn('cols', made)
      failing.add(task.id)
      await press(check('cols', task))
      const retry = toast().locator('button', { hasText: /^\s*Retry\s*$/ }).first()
      await retry.waitFor({ timeout: 12000 })
      await until(async () => !(await struck('cols', task)) && !(await pressed('cols', task)), 'the failed row is restored')
      expect((await apiStatus(task)) === nextId, 'a failed save changed the task')
      await syncOrder('cols', made, before, 'failed save')
      failing.delete(task.id)
      await retry.click()
      await until(async () => (await apiStatus(task)) === doneId && (await struck('cols', task)), 'Retry completes it, struck')
      expect(!(await struck('cols', other)), 'another row struck')
    })
  }

  async function offline() {
    await withTasks(['Alpha', 'Bravo'], undefined, async (made) => {
      const [task] = made
      await openView('cols', made)
      await context.setOffline(true)
      await press(check('cols', task))
      await until(async () => (await struck('cols', task)) && (await pressed('cols', task)), 'offline: the row struck and checked')
      await sleep(1000)
      expect(await present('cols', task), 'offline: the row left')
      await context.setOffline(false)
      await until(async () => (await apiStatus(task)) === doneId, 'offline: Done reached the server when back online', 30000)
      expect(await struck('cols', task), 'offline: the row lost its strike once synced')
    })
  }

  const scenarios = [
    ['list (no columns)', () => layoutSuite('list')],
    ['list with columns', () => layoutSuite('cols')],
    ['table (phone: rows)', () => layoutSuite('table')],
    ['grid cards', () => layoutSuite('grid')],
    ['list with quick actions', () => layoutSuite('quick')],
    ['status board', () => layoutSuite('board')],
    ['board: exact In progress Undo', exactStatusUndo],
    ['board: drag to Done still moves', dragToDone, () => !isPhone() || 'a drag needs a long press: board.mjs phone'],
    ['search keeps matching rows; a view switch clears them', searchAndSwitch],
    ['repeating task', repeating],
    ['rapid double taps', doubleTap],
    ['task page Done, then Back: gone', pageAndBack],
    ['desktop side pane: stays', sidePane, () => !isPhone() || 'no side pane on a phone'],
    ['bulk Done', bulk, () => !isPhone() || 'phone selection needs a long press: bulk.mjs phone'],
    ['bulk partial failure and Retry', bulkPartialFailure, () => (json && !isPhone()) || (isPhone() ? 'phone selection needs a long press' : 'a failed save needs MODE=json')],
    ['a failed save: restored, Retry', failedSave, () => json || 'a failed save needs MODE=json'],
    ['offline save keeps the row', offline, () => (!json && theme === themes[0]) || (json ? 'offline needs the replica' : 'once per width')],
  ]

  for (const wanted of sizes) {
    for (const scheme of themes) {
      size = wanted
      theme = scheme
      label = `${engine}-${size}-${theme}`
      problems = []
      failing = new Set()
      const opened = await openContext(size, theme)
      context = opened.opened
      page = opened.opening
      try {
        await routeSaves()
        const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
        expect(dark === (theme === 'dark'), `the ${theme} theme did not apply`)
        for (const [name, run, only] of scenarios) {
          const reason = only?.()
          if (reason !== undefined && reason !== true) {
            skipped.push(`${label}: ${name} (${reason})`)
            continue
          }
          console.log(`• [${label}] ${name}`)
          const mark = problems.length
          try {
            await run()
          } catch (error) {
            failures.push(`[${label}] ${name}: ${error.message}`)
            console.log(`  FAILED: ${error.message}`)
          }
          if (/failed save|partial failure/.test(name)) problems.length = mark
        }
        if (problems.length) failures.push(`[${label}] console problems:\n    ${problems.join('\n    ')}`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await cleanTasks().catch(() => {})
  await put(`/api/types/${taskType.id}`, { ...original, views: (await get(`/api/types/${taskType.id}`)).views.filter((v) => !v.id.startsWith(prefix)) }).catch(() => {})
  await setup.opened.close()
  await launched?.close()
}

if (skipped.length) console.log(`not run:\n  ${skipped.join('\n  ')}`)
if (failures.length) {
  console.log(`completion-feedback: ${failures.length} failed (${engine})\n${failures.join('\n')}`)
  process.exitCode = 1
} else console.log(`completion-feedback: ok (${engine})`)
