import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyDef, PropertyValue, QuickActionDef } from '../src/model.ts'
import { askOf, defaultQuickActions, isClosedTask, nextStepFieldOf, quickActionChanges, quickActionsOf } from '../src/task-actions.ts'

const AT = '2026-11-13T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!
const context = { today: '2026-11-13', nextWeek: '2026-11-15', me: 'u1' }

/** The built-in task with "Scheduled", "Dropped", a "Do date" and a "Next step", as a space set up for triage has. */
function triageTask(quickActions?: ObjectType['quickActions']): ObjectType {
  const properties: PropertyDef[] = task.properties.map((p) =>
    p.id === 'status' && p.kind === 'select'
      ? { ...p, options: [...p.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'dropped', label: 'Dropped', status: 'done' }] }
      : p
  )
  const added: PropertyDef[] = [{ id: 'dodate', kind: 'date', name: 'Do date' }, { id: 'next', kind: 'text', name: 'Next step' }]
  return { ...task, properties: [...properties, ...added], ...(quickActions ? { quickActions } : {}) }
}

const status = (id: string): PropertyValue => ({ kind: 'select', value: [id] })
const day = (value: string, rrule?: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })
const names = (type: ObjectType) => quickActionsOf(type).map((a) => a.name)

describe('default quick actions', () => {
  it('are Done and Defer (the due date) on the built-in task', () => {
    expect(names(task)).toEqual(['Done', 'Defer'])
    expect(askOf(task, quickActionsOf(task)[1]!)?.def.id).toBe('due')
  })

  it('add Drop for a second option meaning done, and Next step for a next step field', () => {
    expect(names(triageTask({ nextStepField: 'next' }))).toEqual(['Done', 'Defer', 'Drop', 'Next step'])
  })

  it('follow the older settings, falling back when they name something gone or of the wrong kind', () => {
    const defer = defaultQuickActions(triageTask({ deferField: 'dodate', deferStatus: 'scheduled' })).find((a) => a.id === 'defer')!
    expect(defer.changes).toEqual([{ field: 'dodate', value: { kind: 'ask' } }, { field: 'status', value: { kind: 'value', value: status('scheduled') } }])
    const fallback = defaultQuickActions(triageTask({ deferField: 'priority', deferStatus: 'gone', dropStatus: 'done', nextStepField: 'dodate' }))
    expect(fallback.map((a) => a.id)).toEqual(['done', 'defer', 'drop'])
    expect(fallback[1]!.changes).toEqual([{ field: 'due', value: { kind: 'ask' } }])
    expect(nextStepFieldOf(triageTask({ nextStepField: 'dodate' }))).toBeUndefined()
  })

  it('are none on other types', () => {
    expect(quickActionsOf(page)).toEqual([])
    expect(quickActionsOf(undefined)).toEqual([])
  })
})

describe('a type\'s own quick actions', () => {
  const waiting: QuickActionDef = {
    id: 'w',
    name: 'Waiting',
    changes: [
      { field: 'status', value: { kind: 'value', value: status('scheduled') } },
      { field: 'dodate', value: { kind: 'day', days: 7 } },
    ],
  }

  it('replace the defaults, in their order', () => {
    const type = triageTask({ actions: [waiting, { id: 'u', name: 'Urgent', changes: [{ field: 'priority', value: { kind: 'value', value: { kind: 'select', value: ['high'] } } }] }] })
    expect(names(type)).toEqual(['Waiting', 'Urgent'])
  })

  it('leave out changes that no longer fit, and actions left with none', () => {
    const type = triageTask({
      actions: [
        { id: 'a', name: 'A', changes: [{ field: 'gone', value: { kind: 'clear' } }, { field: 'dodate', value: { kind: 'me' } }] },
        { id: 'b', name: 'B', changes: [{ field: 'status', value: { kind: 'value', value: status('nope') } }, { field: 'blocked', value: { kind: 'ask' } }, { field: 'next', value: { kind: 'clear' } }] },
        { id: 'c', name: 'C', changes: [{ field: 'dodate', value: { kind: 'ask' } }, { field: 'next', value: { kind: 'ask' } }] },
      ],
    })
    expect(quickActionsOf(type)).toEqual([
      { id: 'b', name: 'B', changes: [{ field: 'next', value: { kind: 'clear' } }] },
      { id: 'c', name: 'C', changes: [{ field: 'dodate', value: { kind: 'ask' } }] },
    ])
  })
})

describe('quickActionChanges', () => {
  const type = triageTask()
  const run = (changes: QuickActionDef['changes'], props: Record<string, PropertyValue> = {}, answer?: PropertyValue) =>
    quickActionChanges(type, { props }, { id: 'x', name: 'X', changes }, context, answer)

  it('sets fixed values, days, next week, me, and clears', () => {
    expect(
      run([
        { field: 'status', value: { kind: 'value', value: status('scheduled') } },
        { field: 'dodate', value: { kind: 'day', days: 1 } },
        { field: 'due', value: { kind: 'next-week' } },
        { field: 'assignee', value: { kind: 'me' } },
        { field: 'next', value: { kind: 'clear' } },
      ])
    ).toEqual({ status: status('scheduled'), dodate: day('2026-11-14'), due: day('2026-11-15'), assignee: { kind: 'person', value: ['u1'] }, next: undefined })
  })

  it('uses the answer to what it asks, and does nothing without one', () => {
    const changes: QuickActionDef['changes'] = [{ field: 'next', value: { kind: 'ask' } }]
    expect(run(changes, {}, { kind: 'text', value: 'Ask Nabil' })).toEqual({ next: { kind: 'text', value: 'Ask Nabil' } })
    expect(run(changes)).toBeUndefined()
  })

  it('keeps a repeating date repeating', () => {
    const props = { due: day('2026-11-13', 'FREQ=WEEKLY') }
    expect(run([{ field: 'due', value: { kind: 'ask' } }], props, day('2026-11-20'))).toEqual({ due: day('2026-11-20', 'FREQ=WEEKLY') })
    expect(run([{ field: 'due', value: { kind: 'day', days: 0 } }], props)).toEqual({ due: day('2026-11-13', 'FREQ=WEEKLY') })
  })
})

describe('isClosedTask', () => {
  it('is true for any option meaning done', () => {
    const type = triageTask()
    expect(isClosedTask(type, { props: { status: status('done') } })).toBe(true)
    expect(isClosedTask(type, { props: { status: status('dropped') } })).toBe(true)
    expect(isClosedTask(type, { props: { status: status('scheduled') } })).toBe(false)
    expect(isClosedTask(type, { props: {} })).toBe(false)
    expect(isClosedTask(page, { props: { status: status('done') } })).toBe(false)
  })
})
