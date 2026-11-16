import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createBuiltinTypes, habitValue, newObject } from '@vasta/core'
import { NodeStore } from '@vasta/core/node'
import { NodeMediaStore } from '@vasta/core/media-node'
import { ChangeFeed } from '../src/events.ts'
import { currentActor, runAs } from '../src/actor.ts'
import { SparkyFitnessService, sparkyWater, sparkySleep } from '../src/sparkyfitness.ts'
import { createApp } from '../src/app.ts'
import { asUser } from './helpers.ts'

const at = '2026-11-16T12:00:00.000Z'
function setup() {
  const store = new NodeStore(':memory:')
  store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
  for (const type of createBuiltinTypes('s', at)) store.putType(type)
  const feed = new ChangeFeed()
  const requests: string[] = []
  let steps = 4000
  let foodLogged = true
  let fail = false
  let remaining = 200
  const service = new SparkyFitnessService({ store, feed, now: () => at, fetch: async (url, init) => {
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-key')
    requests.push(url)
    if (fail) return new Response('secret-key upstream failure', { status: 401 })
    const day = url.match(/\d{4}-\d{2}-\d{2}/)![0]
    return Response.json(url.includes('check-in-measurements') ? [{ entry_date: day, steps: String(steps) }]
      : url.includes('water-intake') ? { water_ml: 2000 }
      : url.includes('/sleep?') ? [{ entry_date: day, duration_in_seconds: 9 * 3600, time_asleep_in_seconds: 7 * 3600 }]
      : url.includes('daily-summary') ? { foodEntries: foodLogged ? [1] : [], calorieBalance: { eaten: 2300, goal: 2100, remaining } }
      : [{ name: 'Active Calories' }, { name: ' Full Body A ', type: 'preset' }])
  } })
  service.connect('s', { baseUrl: 'https://fitness.example.com', apiKey: 'secret-key', history: 7 })
  const type = store.listTypes('s').find((t) => t.system === 'habit')!
  const add = (rule: string, extra = {}) => {
    const object = newObject(type, { title: rule }, randomUUID(), at)
    object.props = { sparkyfitness: { kind: 'select', value: [rule] }, ...extra }
    store.putObject(object)
    return object.id
  }
  return { store, feed, service, requests, add, changeSteps: () => { steps = 5000 }, noFood: () => { foodLogged = false }, overBudget: () => { remaining = -1 }, fail: () => { fail = true } }
}

describe('SparkyFitness sync', () => {
  it('fills each rule, ignores Active Calories, keeps hand entries and only writes changes', async () => {
    const { store, service, add, requests, changeSteps } = setup()
    const steps = add('steps', { target: { kind: 'number', value: 8000 }, 'done:2026-11-16': { kind: 'number', value: 12 } })
    const water = add('water', { unit: { kind: 'text', value: 'L' }, target: { kind: 'number', value: 2 } })
    const sleep = add('sleep', { target: { kind: 'number', value: 8 } })
    const calories = add('calories')
    const workout = add('workout', { 'sparkyfitness-workouts': { kind: 'text', value: ' other, full BODY a ' } })
    const active = add('workout', { 'sparkyfitness-workouts': { kind: 'text', value: 'Active Calories' } })
    await service.sync('s')
    expect(habitValue(store.getObject(steps)!, '2026-11-16')).toBe(12)
    expect(habitValue(store.getObject(steps)!, '2026-11-15')).toBe(4000)
    expect(habitValue(store.getObject(water)!, '2026-11-16')).toBe(2)
    expect(habitValue(store.getObject(sleep)!, '2026-11-16')).toBe(7)
    expect(habitValue(store.getObject(calories)!, '2026-11-16')).toBe(1)
    expect(habitValue(store.getObject(workout)!, '2026-11-16')).toBe(1)
    expect(habitValue(store.getObject(active)!, '2026-11-16')).toBe(0)
    const rev = store.syncRow('objects', steps)
    await service.sync('s')
    expect(store.syncRow('objects', steps)).toEqual(rev)
    changeSteps()
    await service.sync('s')
    expect(habitValue(store.getObject(steps)!, '2026-11-15')).toBe(5000)
    expect(requests.filter((u) => u.includes('check-in-measurements')).every((u) => !u.includes('2026-11-09'))).toBe(true)
    expect(service.status('s')?.workouts).toEqual(['Full Body A'])
    service.disconnect('s')
    expect(habitValue(store.getObject(water)!, '2026-11-16')).toBe(2)
  })

  it('uses the exercise-adjusted budget and rejects days over it', async () => {
    const { store, service, add, overBudget } = setup()
    const id = add('calories')
    await service.sync('s')
    expect(habitValue(store.getObject(id)!, '2026-11-16')).toBe(1)
    overBudget()
    await service.sync('s')
    expect(habitValue(store.getObject(id)!, '2026-11-16')).toBe(0)
  })

  it('requires food to be logged and records safe errors without discarding data', async () => {
    const { store, service, add, noFood, fail } = setup()
    const id = add('calories')
    noFood()
    await service.sync('s')
    expect(habitValue(store.getObject(id)!, '2026-11-16')).toBe(0)
    fail()
    await service.sync('s')
    expect(service.status('s')?.error).toContain('401')
    expect(JSON.stringify(service.status('s'))).not.toContain('secret-key')
    expect(store.getObject(id)!.props['sf:2026-11-16']).toEqual({ kind: 'checkbox', value: false })
  })

  it('reimports history when a habit is linked, its rule changes or history changes', async () => {
    const { service, store, add, requests } = setup()
    await service.sync('s')
    const id = add('steps', { target: { kind: 'number', value: 8000 } })
    requests.length = 0
    await service.sync('s')
    expect(requests.filter((u) => u.includes('check-in-measurements'))).toHaveLength(7)
    const object = store.getObject(id)!
    store.putObject({ ...object, props: { ...object.props, sparkyfitness: { kind: 'select', value: ['water'] }, unit: { kind: 'text', value: 'L' } } })
    requests.length = 0
    await service.sync('s')
    expect(requests.filter((u) => u.includes('water-intake'))).toHaveLength(7)
    service.connect('s', { baseUrl: 'https://fitness.example.com', history: 30 })
    requests.length = 0
    await service.sync('s')
    expect(requests.filter((u) => u.includes('water-intake'))).toHaveLength(30)
  })

  it.each([0, 7, 30, 90, 365])('imports %i days and only refreshes from two days before the last sync afterwards', async (history) => {
    const { service, add, requests } = setup()
    service.connect('s', { baseUrl: 'https://fitness.example.com', history })
    add('steps', { target: { kind: 'number', value: 8000 } })
    await service.sync('s')
    expect(requests.filter((u) => u.includes('check-in-measurements'))).toHaveLength(Math.max(1, history))
    requests.length = 0
    await service.sync('s')
    expect(requests.filter((u) => u.includes('check-in-measurements'))).toHaveLength(history === 0 ? 1 : 3)
  }, 20000)

  it('previews seven days without writes and reports manual overrides and missing data', async () => {
    const { service, store, add } = setup()
    const id = add('water', { unit: { kind: 'text', value: 'L' }, target: { kind: 'number', value: 2 }, 'done:2026-11-16': { kind: 'number', value: 0 } })
    const before = store.getObject(id)
    const connection = service.status('s')
    const preview = await service.preview(id, { rule: 'water' })
    expect(preview).toHaveLength(7)
    expect(preview.at(-1)).toEqual({ day: '2026-11-16', value: { kind: 'number', value: 2 }, manual: { kind: 'number', value: 0 } })
    expect(store.getObject(id)).toEqual(before)
    expect(service.status('s')).toEqual(connection)
    await expect(service.preview(id, { rule: 'unknown' })).rejects.toThrow('choose')
  })

  it('requires an explicit key for a changed server and leaves the saved connection unchanged on rejection', async () => {
    const { service } = setup()
    const before = service.status('s')
    expect(() => service.connect('s', { baseUrl: 'https://other.example.com' })).toThrow('key for the new')
    expect(service.status('s')).toEqual(before)
  })

  it('replaces prior source status and values when the server or API key changes', async () => {
    const { service, store, add } = setup()
    const id = add('water', { target: { kind: 'number', value: 2 }, 'done:2026-11-16': { kind: 'number', value: 3 } })
    await service.sync('s')
    expect(service.status('s')?.workouts).not.toEqual([])
    service.connect('s', { baseUrl: 'https://fitness.example.com', apiKey: 'replacement-key' })
    expect(service.status('s')?.syncedAt).toBeNull()
    expect(service.status('s')?.workouts).toEqual([])
    expect(store.getObject(id)!.props['sf:2026-11-16']).toBeUndefined()
    expect(store.getObject(id)!.props['done:2026-11-16']).toEqual({ kind: 'number', value: 3 })
  })

  it('starts None at the date selected rather than the original connection date', async () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) store.putType(type)
    let now = '2026-10-16T12:00:00.000Z'
    const days: string[] = []
    const service = new SparkyFitnessService({ store, feed: new ChangeFeed(), now: () => now, fetch: async (url) => {
      if (url.includes('check-in-measurements')) days.push(url.match(/\d{4}-\d{2}-\d{2}/)![0])
      return Response.json([])
    } })
    service.connect('s', { baseUrl: 'https://fitness.example.com', apiKey: 'secret-key', history: 30 })
    const type = store.listTypes('s').find((t) => t.system === 'habit')!
    const habit = newObject(type, { title: 'Steps' }, 'steps', at)
    habit.props.sparkyfitness = { kind: 'select', value: ['steps'] }
    habit.props.target = { kind: 'number', value: 8000 }
    store.putObject(habit)
    now = at
    service.connect('s', { baseUrl: 'https://fitness.example.com', history: 0 })
    await service.sync('s')
    await service.sync('s')
    expect(new Set(days)).toEqual(new Set(['2026-11-16']))
    now = '2026-11-17T12:00:00.000Z'
    service.connect('s', { baseUrl: 'https://fitness.example.com', history: 0 })
    days.length = 0
    await service.sync('s')
    expect(new Set(days)).toEqual(new Set(['2026-11-16', '2026-11-17']))
  })

  it('rejects unknown water units in preview and sync without writing values', async () => {
    const { service, store, add } = setup()
    const id = add('water', { unit: { kind: 'text', value: 'bottles' }, target: { kind: 'number', value: 8 } })
    await expect(service.preview(id, { rule: 'water' })).rejects.toThrow('water habit unit')
    await service.sync('s')
    expect(service.status('s')?.error).toContain('water habit unit')
    expect(Object.keys(store.getObject(id)!.props).some((k) => k.startsWith('sf:'))).toBe(false)
  })

  it.each([[0, 'h', 7], [0, '', 7], [0, 'hours', 7], [0, 'min', 420], [0, 'minutes', 420]])('converts sleep to the habit unit %#', (_n, unit, amount) => {
    expect(sparkySleep(7 * 3600, unit)).toBe(amount)
  })

  it('stores sleep in the habit\'s unit and needs a goal for steps, water and sleep', async () => {
    const { store, service, add } = setup()
    const minutes = add('sleep', { target: { kind: 'number', value: 450 }, unit: { kind: 'text', value: 'minutes' } })
    const noGoal = add('steps')
    await service.sync('s')
    expect(store.getObject(minutes)!.props['sf:2026-11-16']).toEqual({ kind: 'number', value: 420 })
    expect(Object.keys(store.getObject(noGoal)!.props).some((k) => k.startsWith('sf:'))).toBe(false)
    await expect(service.preview(noGoal, { rule: 'steps' })).rejects.toThrow('daily goal')
    expect(await service.preview(noGoal, { rule: 'steps', target: 8000 })).toHaveLength(7)
  })

  it('reads again from two days before the last good sync, so a long outage is caught up', async () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) store.putType(type)
    let now = at
    const days: string[] = []
    const service = new SparkyFitnessService({ store, feed: new ChangeFeed(), now: () => now, fetch: async (url) => {
      if (url.includes('check-in-measurements')) days.push(url.match(/\d{4}-\d{2}-\d{2}/)![0])
      return Response.json([])
    } })
    service.connect('s', { baseUrl: 'https://fitness.example.com', apiKey: 'secret-key', history: 90 })
    const habit = newObject(store.listTypes('s').find((t) => t.system === 'habit')!, { title: 'Steps' }, 'steps', at)
    habit.props = { sparkyfitness: { kind: 'select', value: ['steps'] }, target: { kind: 'number', value: 8000 } }
    store.putObject(habit)
    await service.sync('s')
    days.length = 0
    // Twenty days without a sync (the last good one was on the 16th): it reads from the 14th to the 6th of December.
    now = '2026-12-06T12:00:00.000Z'
    await service.sync('s')
    expect(days[0]).toBe('2026-11-14')
    expect(days.at(-1)).toBe('2026-12-06')
    expect(days).toHaveLength(23)
  }, 20000)

  it('does not rewrite a habit when its link changed but nothing was imported', async () => {
    const { store, service, add } = setup()
    const id = add('steps', { target: { kind: 'number', value: 8000 } })
    store.putObject({ ...store.getObject(id)!, props: { ...store.getObject(id)!.props, 'sf:2026-11-15': { kind: 'number', value: 1 } } })
    await service.sync('s')
    const object = store.getObject(id)!
    store.putObject({ ...object, props: { ...Object.fromEntries(Object.entries(object.props).filter(([k]) => !k.startsWith('sf:'))), unit: { kind: 'text', value: 'steps' } } })
    // The link's unit changed and no sf: value is left to remove: the habit is only read, not rewritten first.
    const spy = store.putObject.bind(store)
    let removals = 0
    store.putObject = ((object: Parameters<typeof spy>[0]) => {
      if (object.id === id && !Object.keys(object.props).some((k) => k.startsWith('sf:'))) removals++
      return spy(object)
    }) as typeof store.putObject
    await service.sync('s')
    expect(removals).toBe(0)
  })

  it('imports as nobody, whoever started it', async () => {
    const { store, service, add } = setup()
    store.actor = currentActor
    const id = add('steps', { target: { kind: 'number', value: 8000 } })
    await runAs('some-user', () => service.sync('s'))
    expect(store.getObject(id)!.props['sf:2026-11-16']).toBeDefined()
    expect(store.getObject(id)!.updatedBy).toBeUndefined()
  })

  it('disconnects keeping the days, or removing them with the links and the properties it added', async () => {
    const { store, service, add } = setup()
    const id = add('steps', { target: { kind: 'number', value: 8000 }, 'done:2026-11-16': { kind: 'number', value: 5 } })
    await service.sync('s')
    service.disconnect('s')
    expect(store.getObject(id)!.props['sf:2026-11-15']).toBeDefined()
    service.connect('s', { baseUrl: 'https://fitness.example.com', apiKey: 'secret-key', history: 7 })
    service.disconnect('s', { remove: true })
    const props = store.getObject(id)!.props
    expect(Object.keys(props).some((k) => k.startsWith('sf:'))).toBe(false)
    expect(props.sparkyfitness).toBeUndefined()
    expect(props['done:2026-11-16']).toEqual({ kind: 'number', value: 5 })
    expect(store.listTypes('s').find((t) => t.system === 'habit')!.properties.some((p) => p.id === 'sparkyfitness' || p.id === 'sparkyfitness-workouts')).toBe(false)
  })

  it.each([['ml', 2000], ['mL', 2000], ['', 2000], ['litres', 2], ['l', 2], ['oz', 2000 / 29.5735], ['fl oz', 2000 / 29.5735], ['glasses', 8], ['cups', 8]])('converts water to %s', (unit, amount) => {
    expect(sparkyWater(2000, unit)).toBe(amount)
  })

  it('never returns keys and enforces space access on every route', async () => {
    const { store, service } = setup()
    const app = createApp({ store, sparkyfitness: service, media: new NodeMediaStore(mkdtempSync(`${tmpdir()}/vasta-sparky-`)) })
    const user = asUser(app, store)
    const response = await user.request('/api/spaces/s/sparkyfitness')
    const json = await response.text()
    expect(json).not.toContain('secret-key')
    expect(json).toContain('hasKey')
    const habitId = store.listTypes('s').find((t) => t.system === 'habit')!.id
    const habit = newObject(store.getType(habitId)!, { title: 'Preview' }, 'preview-habit', at)
    store.putObject(habit)
    const preview = await user.request('/api/objects/preview-habit/sparkyfitness/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rule: 'unknown' }) })
    expect(preview.status).toBe(400)
    const outsider = asUser(app, store, { spaces: [] })
    expect((await outsider.request('/api/objects/preview-habit/sparkyfitness/preview', { method: 'POST' })).status).toBe(404)
    const put = await user.request('/api/spaces/s/sparkyfitness', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'ftp://fitness.example.com', apiKey: 'k' }) })
    expect(put.status).toBe(400)
    expect(((await put.json()) as { error: string }).error).toContain('https://')
    const history = await user.request('/api/spaces/s/sparkyfitness', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://fitness.example.com', history: 5 }) })
    expect(((await history.json()) as { error: string }).error).toBe('choose a history range')
    for (const [method, suffix] of [['GET', ''], ['PUT', ''], ['DELETE', ''], ['POST', '/sync']]) {
      expect((await outsider.request(`/api/spaces/s/sparkyfitness${suffix}`, { method })).status).toBe(404)
    }
  })
})
