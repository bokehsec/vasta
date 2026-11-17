import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { DateValue, ObjectType, PropertyDef, PropertyValue, QuickActionDef } from '../src/model.ts'
import { completeRepeat, moveOccurrenceTo } from '../src/calendar.ts'
import type { ObjectRecord } from '../src/model.ts'
import { dropOptionOf, isClosedTask } from '../src/task-status.ts'
import { askOf, defaultQuickActions, deferActionOf, nextStepFieldOf, quickActionChanges, quickActionEdit, quickActionMessage, quickActionsOf, withAskCleared } from '../src/task-actions.ts'

const AT = '2026-11-13T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!
const context = { today: '2026-11-13', nextWeek: '2026-11-15', me: 'u1', timeZone: 'UTC' }

/** The built-in task (it has a "Do date") with "Scheduled", "Dropped" and a "Next step", as a space set up for triage has. */
function triageTask(quickActions?: ObjectType['quickActions']): ObjectType {
  const properties: PropertyDef[] = task.properties.map((p) =>
    p.id === 'status' && p.kind === 'select'
      ? { ...p, options: [...p.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'dropped', label: 'Dropped', status: 'done' }] }
      : p
  )
  const added: PropertyDef[] = [{ id: 'next', kind: 'text', name: 'Next step' }]
  return { ...task, properties: [...properties, ...added], ...(quickActions ? { quickActions } : {}) }
}

const status = (id: string): PropertyValue => ({ kind: 'select', value: [id] })
const day = (value: string, rrule?: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })
const names = (type: ObjectType) => quickActionsOf(type).map((a) => a.name)

describe('default quick actions', () => {
  it('are Mark done and Defer (the Do date, never the deadline) on the built-in task', () => {
    expect(names(task)).toEqual(['Mark done', 'Defer'])
    expect(askOf(task, quickActionsOf(task)[1]!)?.def.id).toBe('dodate')
    expect(deferActionOf(task)?.id).toBe('defer')
  })

  it('add Drop for a second option meaning done, and Next step for a next step field', () => {
    expect(names(triageTask({ nextStepField: 'next' }))).toEqual(['Mark done', 'Defer', 'Drop', 'Next step'])
  })

  it('defer the date with the plan role, and have no Defer without one', () => {
    const moved = { ...task, properties: task.properties.map((p) => (p.id === 'dodate' ? { ...p, id: 'work' } : p)) }
    expect(defaultQuickActions(moved).find((a) => a.id === 'defer')?.changes).toEqual([{ field: 'work', value: { kind: 'ask' } }])
    const unplanned = { ...task, properties: task.properties.filter((p) => p.id !== 'dodate') }
    expect(names(unplanned)).toEqual(['Mark done'])
    expect(deferActionOf(unplanned)).toBeUndefined()
    expect(nextStepFieldOf(triageTask({ nextStepField: 'dodate' }))).toBeUndefined()
  })

  it('drop with the status the type\'s own Drop action sets, else the second option meaning done', () => {
    const extra = { ...triageTask(), properties: triageTask().properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'cancelled', label: 'Cancelled', status: 'done' as const }] } : p)) }
    expect(dropOptionOf(extra)?.id).toBe('dropped')
    const own = { ...extra, quickActions: { actions: [{ id: 'drop', name: 'Drop', changes: [{ field: 'status', value: { kind: 'value' as const, value: status('cancelled') } }] }] } }
    expect(dropOptionOf(own)?.id).toBe('cancelled')
    // Done itself is never Drop.
    expect(dropOptionOf({ ...own, quickActions: { actions: [{ id: 'drop', name: 'Drop', changes: [{ field: 'status', value: { kind: 'value' as const, value: status('done') } }] }] } })?.id).toBe('dropped')
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

describe('quick actions on a type that is not a task', () => {
  const reviewed: QuickActionDef = { id: 'reviewed', name: 'Reviewed', changes: [{ field: 'nextreview', value: { kind: 'day', days: 7 } }] }
  const project: ObjectType = {
    ...page,
    properties: [...page.properties, { id: 'nextreview', kind: 'date', name: 'Next review' }],
    quickActions: { actions: [reviewed] },
  }

  it('are the type’s own list, and none without one', () => {
    expect(names(project)).toEqual(['Reviewed'])
    expect(quickActionsOf({ ...page, properties: project.properties })).toEqual([])
  })

  it('run as a task’s do, with Undo values and a message', () => {
    expect(quickActionChanges(project, { props: {} }, reviewed, context)).toEqual({ nextreview: day('2026-11-20') })
    const edit = quickActionEdit(project, { id: 'p1', props: {} }, reviewed, context)
    expect(edit).toEqual({ id: 'p1', values: { nextreview: day('2026-11-20') }, before: { nextreview: undefined }, days: { nextreview: '2026-11-20' } })
  })

  it('hide behind a status option meaning done, as a task’s do', () => {
    const withStatus: ObjectType = {
      ...project,
      properties: [...project.properties, { id: 'status', kind: 'select', name: 'Status', multiple: false, options: [{ id: 'active', label: 'Active', status: 'todo' }, { id: 'archived', label: 'Archived', status: 'done' }] }],
    }
    expect(isClosedTask(withStatus, { props: { status: status('archived') } })).toBe(true)
    expect(isClosedTask(withStatus, { props: { status: status('active') } })).toBe(false)
    expect(isClosedTask(withStatus, { props: {} })).toBe(false)
  })

  it('read a status of the type’s own (not the built-in id) when its options have categories', () => {
    const custom: ObjectType = {
      ...project,
      properties: [...project.properties, { id: 'phase', kind: 'select', name: 'Phase', multiple: false, options: [{ id: 'on', label: 'On', status: 'doing' }, { id: 'over', label: 'Over', status: 'done' }] }],
    }
    expect(isClosedTask(custom, { props: { phase: { kind: 'select', value: ['over'] } } })).toBe(true)
    expect(isClosedTask(custom, { props: { phase: { kind: 'select', value: ['on'] } } })).toBe(false)
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

  it('moves only this occurrence of a repeating date, never the series', () => {
    const props = { dodate: day('2026-11-13', 'FREQ=WEEKLY') }
    const withRule = { ...context, moveOccurrence: (value: DateValue, to: string) => moveOccurrenceTo(value, to, 'UTC') }
    const moved = quickActionChanges(type, { props }, { id: 'x', name: 'X', changes: [{ field: 'dodate', value: { kind: 'ask' } }] }, withRule, day('2026-11-17'))!.dodate
    expect(moved).toEqual({ kind: 'date', value: { start: '2026-11-13T00:00:00.000Z', resolution: 'day', rrule: 'FREQ=WEEKLY', exceptions: { '2026-11-13T00:00:00.000Z': { start: '2026-11-17T00:00:00.000Z' } } } })
    // Moved again to where the rule puts it, the exception goes and the series is as it was.
    const again = quickActionChanges(type, { props: { dodate: moved! } }, { id: 'x', name: 'X', changes: [{ field: 'dodate', value: { kind: 'day', days: 0 } }] }, withRule)!.dodate
    expect(again).toEqual(props.dodate)
    // Without the rule parser a repeating date is left as it is.
    expect('dodate' in run([{ field: 'dodate', value: { kind: 'ask' } }], props, day('2026-11-17'))!).toBe(false)
  })

  it('keeps the time of day, the end and what else a date holds when moving it to a day', () => {
    const timed: PropertyValue = { kind: 'date', value: { start: '2026-11-18T15:30:00.000Z', end: '2026-11-18T16:30:00.000Z', resolution: 'time', timeZone: 'UTC' } }
    expect(run([{ field: 'dodate', value: { kind: 'ask' } }], { dodate: timed }, day('2026-11-20'))!.dodate).toEqual({ kind: 'date', value: { start: '2026-11-20T15:30:00.000Z', end: '2026-11-20T16:30:00.000Z', resolution: 'time', timeZone: 'UTC' } })
    const span: PropertyValue = { kind: 'date', value: { start: '2026-11-18T00:00:00.000Z', end: '2026-11-19T00:00:00.000Z', resolution: 'day' } }
    expect(run([{ field: 'dodate', value: { kind: 'ask' } }], { dodate: span }, day('2026-11-20'))!.dodate).toEqual({ kind: 'date', value: { start: '2026-11-20T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z', resolution: 'day' } })
    // A time in a zone that changes its clock keeps the wall-clock time (9:00 Toronto before and after 1 Nov).
    const toronto: PropertyValue = { kind: 'date', value: { start: '2026-10-30T13:00:00.000Z', resolution: 'time' } }
    expect(quickActionChanges(type, { props: { dodate: toronto } }, { id: 'x', name: 'X', changes: [{ field: 'dodate', value: { kind: 'ask' } }] }, { ...context, timeZone: 'America/Toronto' }, day('2026-11-03'))!.dodate).toEqual({ kind: 'date', value: { start: '2026-11-03T14:00:00.000Z', resolution: 'time' } })
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

describe('an action on an object', () => {
  const type = triageTask()
  // The type's own Defer, which also sets the Scheduled status.
  const defer: QuickActionDef = { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }, { field: 'status', value: { kind: 'value', value: status('scheduled') } }] }
  const objects: { id: string; props: Record<string, PropertyValue> }[] = [
    { id: 'a', props: { status: status('todo'), dodate: day('2026-11-01') } },
    { id: 'b', props: { dodate: day('2026-11-02', 'FREQ=WEEKLY') } },
    { id: 'c', props: {} },
  ]
  const format = { longDay: (d: string) => `<${d}>`, timeZone: 'UTC' }

  it('writes its values with the values before', () => {
    const [a, b, c] = objects.map((o) => quickActionEdit(type, o, defer, { ...context, moveOccurrence: (v, to) => moveOccurrenceTo(v, to, 'UTC') }, day('2026-11-20'))!)
    expect(a!.values).toEqual({ dodate: day('2026-11-20'), status: status('scheduled') })
    expect(b!.values.dodate).toMatchObject({ kind: 'date', value: { rrule: 'FREQ=WEEKLY', start: '2026-11-02T00:00:00.000Z', exceptions: { '2026-11-02T00:00:00.000Z': { start: '2026-11-20T00:00:00.000Z' } } } })
    expect(a!.before).toEqual({ dodate: day('2026-11-01'), status: status('todo') })
    expect(c!.before).toEqual({ dodate: undefined, status: undefined })
  })

  it('writes nothing without the answer it asks for', () => {
    expect(quickActionEdit(type, objects[0]!, defer, context)).toBeUndefined()
  })

  it('clears the asked field for an empty answer', () => {
    const nextStep = quickActionsOf(triageTask({ nextStepField: 'next' })).find((a) => a.id === 'next-step')!
    const edit = quickActionEdit(type, { id: 'a', props: { next: { kind: 'text', value: 'Call' } } }, withAskCleared(type, nextStep), context)
    expect(edit).toEqual({ id: 'a', values: { next: undefined }, before: { next: { kind: 'text', value: 'Call' } }, days: {} })
  })

  it('keeps the due date of a repeating task in Undo when Done closes it, as completeRepeat moves it', () => {
    const done = quickActionsOf(type).find((a) => a.id === 'done')!
    const weekly = day('2026-11-13', 'FREQ=WEEKLY')
    const repeating = { id: 'r', props: { status: status('todo'), due: weekly } as Record<string, PropertyValue> }
    const edit = quickActionEdit(type, repeating, done, context)!
    expect(edit.before).toEqual({ status: status('todo'), due: weekly })
    expect(quickActionEdit(type, { id: 'p', props: { status: status('todo'), due: day('2026-11-13') } }, done, context)!.before).toEqual({ status: status('todo') })
    expect(quickActionEdit(type, { id: 'n', props: { status: status('todo') } }, done, context)!.before).toEqual({ status: status('todo') })
    // Saving Done really moves the date; the edit's `before` puts both fields back.
    const stored = { id: 'r', typeId: task.id, title: 'T', props: repeating.props } as unknown as ObjectRecord
    const saved = completeRepeat({ ...stored, props: { ...stored.props, ...edit.values } } as ObjectRecord, stored, task, 'UTC')
    expect(saved.props.due).not.toEqual(weekly)
    expect({ ...saved.props, ...edit.before }).toEqual(stored.props)
    // Not for an action that leaves the task open, nor for a type that is not a task.
    const reopen: QuickActionDef = { id: 'r', name: 'R', changes: [{ field: 'status', value: { kind: 'value', value: status('scheduled') } }] }
    expect(quickActionEdit(type, repeating, reopen, context)!.before).toEqual({ status: status('todo') })
  })

  it('takes the due date along when the day asked for another date is after it (moveDue)', () => {
    const moving = { ...context, moveDue: true }
    const late = { id: 'l', props: { due: day('2026-11-18') } }
    // After the due date: both move; Undo has both.
    const edit = quickActionEdit(type, late, defer, moving, day('2026-11-20'))!
    expect(edit.values.dodate).toEqual(day('2026-11-20'))
    expect(edit.values.due).toEqual(day('2026-11-20'))
    expect(edit.before).toMatchObject({ dodate: undefined, due: day('2026-11-18') })
    expect(quickActionMessage(type, defer, edit, { ...format, due: day('2026-11-18') })).toBe('Defer · Do date <2026-11-20> · due date moved too')
    // On or before the due date, without a due date, or with the box off: the due date stays.
    expect('due' in quickActionChanges(type, late, defer, moving, day('2026-11-18'))!).toBe(false)
    expect('due' in quickActionChanges(type, late, defer, moving, day('2026-11-15'))!).toBe(false)
    expect('due' in quickActionChanges(type, { props: {} }, defer, moving, day('2026-11-20'))!).toBe(false)
    expect('due' in quickActionChanges(type, late, defer, context, day('2026-11-20'))!).toBe(false)
    // A due date that repeats is a series, not a deadline to push: left alone.
    expect('due' in quickActionChanges(type, { props: { due: day('2026-11-18', 'FREQ=WEEKLY') } }, defer, moving, day('2026-11-20'))!).toBe(false)
    // A timed deadline keeps its time of day, and a span its length.
    const timed: PropertyValue = { kind: 'date', value: { start: '2026-11-18T15:30:00.000Z', end: '2026-11-18T16:30:00.000Z', resolution: 'time' } }
    expect(quickActionChanges(type, { props: { due: timed } }, defer, moving, day('2026-11-20'))!.due).toEqual({ kind: 'date', value: { start: '2026-11-20T15:30:00.000Z', end: '2026-11-20T16:30:00.000Z', resolution: 'time' } })
    // An action that sets the deadline itself has nothing to take along.
    const dueDefer: QuickActionDef = { id: 'due', name: 'Due', changes: [{ field: 'due', value: { kind: 'ask' } }] }
    expect(quickActionChanges(task, late, dueDefer, moving, day('2026-11-20'))).toEqual({ due: day('2026-11-20') })
    // A deadline at 9:00 Toronto moved across the 1 Nov clock change is still 9:00.
    const nine: PropertyValue = { kind: 'date', value: { start: '2026-10-30T13:00:00.000Z', resolution: 'time' } }
    expect(quickActionChanges(type, { props: { due: nine } }, defer, { ...moving, timeZone: 'America/Toronto' }, day('2026-11-03'))!.due).toEqual({ kind: 'date', value: { start: '2026-11-03T14:00:00.000Z', resolution: 'time' } })
  })

  it('says the days set and a day past the due date', () => {
    const edit = quickActionEdit(type, objects[0]!, defer, context, day('2026-11-20'))!
    expect(quickActionMessage(type, defer, edit, { ...format, due: day('2026-11-18') })).toBe('Defer · Do date <2026-11-20> (after its due date, <2026-11-18>)')

    // A button named for what it does ("Mark done") says what happened ("Done").
    const markDone = quickActionsOf(task)[0]!
    expect(markDone.name).toBe('Mark done')
    expect(quickActionMessage(task, markDone, quickActionEdit(task, objects[0]!, markDone, context)!, format)).toBe('Done')
  })

  it('puts the Last reviewed day back in Undo when it sets a status', () => {
    const markDone = quickActionsOf(task)[0]!
    const reviewedBefore = day('2026-11-01')
    expect(quickActionEdit(task, { id: 'a', props: { status: status('todo'), reviewed: reviewedBefore } }, markDone, context)!.before).toEqual({ status: status('todo'), reviewed: reviewedBefore })
    expect(quickActionEdit(task, { id: 'a', props: {} }, markDone, context)!.before).toEqual({ status: undefined, reviewed: undefined })
    // Not for an action that leaves the status alone.
    expect(quickActionEdit(type, objects[0]!, quickActionsOf(triageTask({ nextStepField: 'next' })).find((a) => a.id === 'next-step')!, context, { kind: 'text', value: 'x' })!.before).toEqual({ next: undefined })
  })
})
