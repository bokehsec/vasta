import { describe, expect, it } from 'vitest'
import { builtinTypeId, createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyDef } from '../src/model.ts'
import { ensureBuiltinTypes } from '../src/operations.ts'
import { deferActionOf, quickActionsOf } from '../src/task-actions.ts'
import { taskDatesOf } from '../src/task-dates.ts'
import { NodeStore } from '../src/store-node.ts'

const AT = '2026-11-16T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!

describe('date roles', () => {
  it('the built-in task has a Due deadline and a Do date plan', () => {
    const { plan, deadline } = taskDatesOf(task)
    expect([deadline?.id, deadline?.role]).toEqual(['due', 'deadline'])
    expect([plan?.id, plan?.name, plan?.role]).toEqual(['dodate', 'Do date', 'plan'])
  })

  it('are found by role, whatever the properties are called, and only on tasks', () => {
    const renamed: ObjectType = { ...task, properties: task.properties.map((p) => (p.id === 'dodate' ? { ...p, id: 'work', name: 'Plan', role: 'plan' } : p.id === 'due' ? { ...p, id: 'deadline-2', role: 'deadline' } : p)) }
    expect(taskDatesOf(renamed).plan?.id).toBe('work')
    expect(taskDatesOf(renamed).deadline?.id).toBe('deadline-2')
    expect(taskDatesOf(page)).toEqual({})
    expect(taskDatesOf(undefined)).toEqual({})
    expect(taskDatesOf({ ...page, properties: task.properties })).toEqual({})
  })

  it('treat a Due without a role as the deadline, and a date without a role as neither', () => {
    const bare: ObjectType = { ...task, properties: task.properties.map((p): PropertyDef => (p.kind === 'date' ? { ...p, role: undefined } : p)) }
    expect(taskDatesOf(bare).deadline?.id).toBe('due')
    expect(taskDatesOf(bare).plan).toBeUndefined()
    expect(deferActionOf(bare)).toBeUndefined()
  })
})

describe('the migration giving task dates their roles (2026-11-16)', () => {
  const status = (id: string) => ({ kind: 'value' as const, value: { kind: 'select' as const, value: [id] } })
  /** A task type as it was before roles: Due, a "Do date" and "Check back", and the old Defer and Drop settings. */
  function legacy(quickActions: Record<string, unknown>, mutate: (properties: PropertyDef[]) => PropertyDef[] = (p) => p): ObjectType {
    const properties = task.properties
      .filter((p) => p.id !== 'dodate')
      .map((p): PropertyDef => (p.id === 'due' && p.kind === 'date' ? { id: 'due', kind: 'date', name: 'Due', withTime: true } : p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'dropped', label: 'Dropped', status: 'done' }] } : p))
    return { ...task, properties: mutate([...properties, { id: 'work', kind: 'date', name: 'Do date' }, { id: 'checkback', kind: 'date', name: 'Check back' }]), quickActions: quickActions as ObjectType['quickActions'] }
  }
  const run = (type: ObjectType) => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'S', sidebar: [], createdAt: AT })
    for (const t of types) store.putType(t.id === type.id ? type : t)
    ensureBuiltinTypes(store, AT)
    return { store, type: store.getType(type.id)!, again: () => (ensureBuiltinTypes(store, AT), store.getType(type.id)!) }
  }

  it('makes Due the deadline and the date Defer set the plan, and writes Defer and Drop as the settings had them', () => {
    const { type } = run(legacy({ deferField: 'work', deferStatus: 'scheduled', dropStatus: 'dropped', nextStepField: 'next', reviewEvery: 14 }))
    const { plan, deadline } = taskDatesOf(type)
    expect([plan?.id, deadline?.id]).toEqual(['work', 'due'])
    expect(type.properties.find((p) => p.id === 'checkback')).not.toHaveProperty('role')
    expect(type.quickActions).toEqual({ nextStepField: 'next', actions: expect.any(Array) })
    expect(type.review).toEqual({ every: 14 })
    const defer = quickActionsOf(type).find((a) => a.id === 'defer')!
    expect(defer.changes).toEqual([{ field: 'work', value: { kind: 'ask' } }, { field: 'status', value: status('scheduled') }])
    const drop = quickActionsOf(type).find((a) => a.id === 'drop')!
    expect(drop).toMatchObject({ name: 'Drop', changes: [{ field: 'status', value: status('dropped') }] })
    expect(JSON.stringify(type)).not.toMatch(/deferField|deferStatus|dropStatus/)
  })

  it('leaves a type with its own actions, or none to write, as it is, apart from the roles', () => {
    const own = [{ id: 'defer', name: 'Later', changes: [{ field: 'checkback', value: { kind: 'ask' as const } }] }]
    const { type } = run(legacy({ deferField: 'work', actions: own }))
    expect(type.quickActions).toEqual({ actions: own })
    const plain = run(legacy({ deferField: 'work' })).type
    expect(plain.quickActions).toBeUndefined()
    expect(deferActionOf(plain)?.changes).toEqual([{ field: 'work', value: { kind: 'ask' } }])
  })

  it('adds a Do date plan after Due to a type that has none, or takes the one called that', () => {
    const none = run(legacy({}, (p) => p.filter((x) => x.id !== 'work')))
    expect(none.type.properties.map((p) => p.id).slice(0, 4)).toContain('dodate')
    expect(taskDatesOf(none.type).plan).toMatchObject({ id: 'dodate', name: 'Do date', role: 'plan' })
    expect(none.type.properties.findIndex((p) => p.id === 'dodate')).toBe(none.type.properties.findIndex((p) => p.id === 'due') + 1)
    // Named but not set up as Defer's date (no deferField): it is the plan, not a second one.
    const named = run(legacy({}))
    expect(named.type.properties.filter((p) => p.kind === 'date' && p.role === 'plan').map((p) => p.id)).toEqual(['work'])
    expect(named.type.properties.filter((p) => p.name === 'Do date')).toHaveLength(1)
  })

  it('runs once: a role taken off afterwards stays off', () => {
    const { store, type, again } = run(legacy({ deferField: 'work' }))
    store.putType({ ...type, properties: type.properties.map((p) => { const { role: _role, ...rest } = p as PropertyDef & { role?: string }; return rest as PropertyDef }) })
    expect(taskDatesOf(again()).plan).toBeUndefined()
    expect(store.getType(builtinTypeId('s', 'page'))).toEqual(page)
  })

  it('moves Review\'s settings out of the quick actions and drops the Hold status', () => {
    const { type, again } = run({ ...legacy({ reviewEvery: 0, triageStatuses: ['inbox'], holdStatus: 'hold', nextStepField: 'next' }) })
    expect(type.review).toEqual({ every: 0, incoming: ['inbox'] })
    expect(type.quickActions).toEqual({ nextStepField: 'next' })
    expect(JSON.stringify(type.quickActions)).not.toMatch(/reviewEvery|triageStatuses|holdStatus/)
    // Once: a second start changes nothing.
    expect(again()).toEqual(type)
    // Only the Hold setting: it goes, and no empty review block appears.
    const { type: held } = run(legacy({ holdStatus: 'hold' }))
    expect(held).not.toHaveProperty('review')
    expect(held).not.toHaveProperty('quickActions')
  })
})
