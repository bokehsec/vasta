// A type's page in pieces: one paused review per type (another type's review never replaces it,
// the same type's asks first), one row menu in a list and in a query (Move to trash), the ⋯ on every
// row of a phone, and Review's own section in Type settings.
//   node type-page.mjs [chromium|webkit] [base]   (MODE=json: HTTP; default: replica)
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5183'
assert(/^http:\/\/127\.0\.0\.1:5[12]8[34]$/.test(base), 'Use an isolated test environment')
const options = { viewport: { width: 1280, height: 900 }, locale: 'en-US' }
const browser = engine === 'webkit' ? null : await chromium.launch()
const context = engine === 'webkit' ? await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-type-page-')), options) : await browser.newContext(options)
if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
const page = context.pages()[0] ?? (await context.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const headers = { 'x-requested-with': 'vasta' }
const send = async (method, route, data) => {
  const response = await page.request[method](`${base}${route}`, { headers, data })
  assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`)
  return response.status() === 204 ? undefined : response.json()
}
const until = async (check, name) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${name}`)
}
const step = (name) => console.log(`• ${name}`)
const clean = (text) => text.replace(/\s+/g, ' ').trim()

await page.goto(base)
await page.fill('#login-username', 'tester')
await page.fill('#login-password', 'test-password')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 30000 })
const tag = `${engine}-${Date.now() % 100000}`
const space = (await send('get', '/api/spaces'))[0]
const taskType = (await send('get', `/api/spaces/${space.id}`)).types.find((t) => t.system === 'task')
const made = []
try {
  // Books with a quick action (so a view of them can be reviewed), and a plain type without one.
  const book = await send('post', '/api/types', { spaceId: space.id, name: `Book ${tag}`, pluralName: `Books ${tag}` })
  await send('put', `/api/types/${book.id}`, {
    ...book,
    properties: [...book.properties, { id: 'read', kind: 'checkbox', name: 'Read' }],
    quickActions: { actions: [{ id: 'read', name: 'Mark read', changes: [{ field: 'read', value: { kind: 'value', value: { kind: 'checkbox', value: true } } }] }] },
  })
  const plain = await send('post', '/api/types', { spaceId: space.id, name: `Plain ${tag}`, pluralName: `Plains ${tag}` })
  for (const title of ['One', 'Two']) made.push(await send('post', '/api/objects', { typeId: book.id, title: `Book ${title} ${tag}`, props: {} }))
  made.push(await send('post', '/api/objects', { typeId: plain.id, title: `Plain one ${tag}`, props: {} }))
  const query = await send('post', '/api/objects', { typeId: (await send('get', `/api/spaces/${space.id}`)).types.find((t) => t.system === 'query').id, title: `Books query ${tag}`, props: {}, query: { typeIds: [book.id], layout: 'list' } })
  made.push(query)
  await page.reload({ waitUntil: 'networkidle' })
  const more = () => page.locator('main header button[title="More"]').click()
  const taskResume = page.locator('[data-review-tasks]')

  step('a paused review is kept for each type: another type\'s review does not replace it, the same type\'s asks first')
  await until(async () => {
    await page.goto(`${base}/t/${taskType.id}`)
    return page.locator('[data-review-tasks]').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 'the Tasks page')
  await taskResume.click()
  await page.locator('[data-process-mode]').waitFor()
  const taskPlace = clean(await page.locator('[data-process-position]').innerText())
  await page.locator('[data-process-close]').click()
  await until(async () => /^Resume \d+ of \d+$/.test(clean(await taskResume.innerText())), 'Tasks says Resume N of M')
  await page.goto(`${base}/t/${book.id}`)
  await page.locator('main header button[title="More"]').waitFor()
  await more()
  await page.locator('[data-review-view]').click()
  await page.locator('[data-process]').click()
  await page.locator('[data-process-mode]').waitFor()
  await page.locator('[data-process-close]').click()
  await until(async () => clean(await page.locator('[data-process-resume]').first().innerText()) === 'Resume 1 of 2' || /1 of 2/.test(clean(await page.locator('[data-process-resume]').first().innerText())), 'Books are paused at 1 of 2')
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('[data-review-tasks]').waitFor()
  assert.match(clean(await taskResume.innerText()), /^Resume \d+ of \d+$/, 'the books review did not take the Tasks review')
  await taskResume.click()
  await page.locator('[data-process-mode]').waitFor()
  assert.equal(clean(await page.locator('[data-process-position]').innerText()), taskPlace, 'Tasks resumes where it stopped')
  await page.locator('[data-process-close]').click()
  // Starting another review of Books asks before it replaces the paused one; keeping it leaves it.
  await page.goto(`${base}/t/${book.id}`)
  await page.locator('main header button[title="More"]').waitFor()
  await more()
  await page.locator('[data-review-view]').click()
  await page.locator('[data-process]').click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-process-mode]').waitFor({ state: 'detached' })
  await until(async () => (await page.locator('[data-process-resume]').count()) > 0, 'Books still paused')

  step('one row menu: a list and a query offer Move to trash; Open and the rest are the same')
  await page.goto(`${base}/t/${book.id}`)
  const row = page.locator(`a[href^="/o/${made[0].id}"]`).first()
  await row.waitFor()
  await row.click({ button: 'right' })
  const listMenu = clean(await page.locator('[role=menu]').innerText())
  assert.match(listMenu, /Open.*Copy link to page.*Move to trash/)
  await page.keyboard.press('Escape')
  await page.goto(`${base}/o/${query.id}`)
  const queried = page.locator(`a[href^="/o/${made[1].id}"]`).first()
  await queried.waitFor()
  await queried.click({ button: 'right' })
  const queryMenu = clean(await page.locator('[role=menu]').innerText())
  assert.match(queryMenu, /Open.*Copy link to page.*Move to trash/, 'a query has the same menu')
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await until(async () => (await page.locator(`a[href^="/o/${made[1].id}"]`).count()) === 0, 'the trashed book left the query')

  step('a phone: every row has its ⋯, also a type without quick actions')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/t/${plain.id}`)
  await page.locator(`a[href^="/o/${made[2].id}"]`).first().waitFor()
  await until(async () => (await page.locator('[data-row-more]').count()) === 1, 'the ⋯ on a plain row')
  const box = await page.locator('[data-row-more]').boundingBox()
  assert(box.width >= 44 && box.height >= 44, `the ⋯ is ${box.width}×${box.height}`)
  await page.locator('[data-row-more]').click()
  assert.match(clean(await page.locator('[role=menu], [role=dialog]').last().innerText()), /Open.*Move to trash/)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 900 })

  step('Type settings has a Review section (how often, which statuses are new) and no Hold setting')
  await page.goto(`${base}/t/${taskType.id}`)
  await page.locator('button[title="Type settings"]').click()
  const section = page.locator('[data-review-settings]')
  await section.waitFor()
  assert.equal(await page.locator('[data-hold-status]').count(), 0, 'the Hold setting is gone')
  assert.equal(await page.locator('[data-quick-action-settings] [data-review-every]').count(), 0, 'Review settings are not under Quick actions')
  await section.locator('[data-review-every]').fill('3')
  await section.locator('[data-review-every]').blur()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(async () => (await send('get', `/api/types/${taskType.id}`)).review?.every === 3, 'review.every saved on the type')
  const saved = await send('get', `/api/types/${taskType.id}`)
  assert(!('reviewEvery' in (saved.quickActions ?? {})) && !('holdStatus' in (saved.quickActions ?? {})), 'nothing of it is left in the quick actions')
  await send('put', `/api/types/${taskType.id}`, { ...saved, review: undefined })

  assert.deepEqual(errors, [])
  console.log(`Type page checks passed: ${engine}, ${process.env.MODE === 'json' ? 'HTTP' : 'replica'}.`)
} finally {
  for (const object of made) await send('delete', `/api/objects/${object.id}`).catch(() => {})
  await context.close()
  await browser?.close()
}
