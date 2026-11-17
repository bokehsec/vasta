import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectRecord, ObjectType, PropertyValue, QuickActionDef } from '../src/model.ts'
import type { ObjectSummary } from '../src/model.ts'
import { fieldKind, matchesFilter } from '../src/query.ts'
import { quickActionEdit, quickActionMessage } from '../src/task-actions.ts'
import { taskWorkflowQueues } from '../src/task-workflows.ts'
import { dueForReview, holdAction, holdOptionOf, reviewEveryOf, reviewFieldOf, reviewedAction, reviewedByStatusChange, withReviewed } from '../src/task-review.ts'

const AT = '2026-11-14T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!
const context = { today: '2026-11-14', nextWeek: '2026-11-16', timeZone: 'UTC' }
const day = (value: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day' } })
const reviewedOn = (value?: string): { props: Record<string, PropertyValue> } => ({ props: value ? { reviewed: day(value) } : {} })
const withHold = (label: string, quickActions?: ObjectType['quickActions']): ObjectType => ({
  ...task,
  properties: task.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'hold', label }] } : p)),
  ...(quickActions ? { quickActions } : {}),
})

describe('review dates', () => {
  it('a task has Last reviewed; other types and a task without it have none', () => {
    expect(reviewFieldOf(task)?.name).toBe('Last reviewed')
    expect(reviewFieldOf(page)).toBeUndefined()
    expect(reviewFieldOf({ ...task, properties: task.properties.filter((p) => p.id !== 'reviewed') })).toBeUndefined()
  })

  it('come up again after a week unless the type says otherwise', () => {
    expect(reviewEveryOf(task)).toBe(7)
    expect(reviewEveryOf({ ...task, quickActions: { reviewEvery: 14 } })).toBe(14)
    expect(reviewEveryOf({ ...task, quickActions: { reviewEvery: -1 } })).toBe(7)
    expect(dueForReview(task, reviewedOn(), '2026-11-14')).toBe(true)
    expect(dueForReview(task, reviewedOn('2026-11-08'), '2026-11-14')).toBe(false)
    expect(dueForReview(task, reviewedOn('2026-11-07'), '2026-11-14')).toBe(true)
    expect(dueForReview({ ...task, quickActions: { reviewEvery: 0 } }, reviewedOn('2026-11-14'), '2026-11-14')).toBe(true)
    // Without the date every open task is reviewed every time, as before.
    expect(dueForReview(page, reviewedOn('2026-11-14'), '2026-11-14')).toBe(true)
  })

  it('Reviewed sets today; a decision that leaves the status alone sets it too, without saying so in the notice', () => {
    const reviewed = reviewedAction(task)!
    const edit = quickActionEdit(task, { id: 'a', props: {} }, reviewed, context)
    expect(edit!.values).toEqual({ reviewed: day('2026-11-14') })
    expect(edit!.before).toEqual({ reviewed: undefined })
    const next: QuickActionDef = { id: 'next', name: 'Next step', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['todo'] } } }] }
    const kept = withReviewed(task, next, { props: { status: { kind: 'select', value: ['todo'] } } })
    expect(kept.changes.map((c) => c.field)).toEqual(['status', 'reviewed'])
    expect(withReviewed(task, reviewed, { props: {} })).toBe(reviewed)
    expect(withReviewed(page, next, { props: {} })).toBe(next)
    // An action that changes the status is saved as reviewed anyway: nothing is added.
    const done: QuickActionDef = { id: 'done', name: 'Done', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['done'] } } }] }
    expect(withReviewed(task, done, { props: { status: { kind: 'select', value: ['todo'] } } })).toBe(done)
    expect(withReviewed(task, done, { props: {} })).toBe(done)
    expect(quickActionMessage(task, kept, quickActionEdit(task, { id: 'a', props: {} }, kept, context)!, { longDay: (d) => d, timeZone: 'UTC' })).toBe('Next step')
    expect(reviewedAction(page)).toBeUndefined()
  })

  it('a changed status marks the task reviewed on the saving day, unless the save sets the date', () => {
    const obj = (props: Record<string, PropertyValue>) => ({ id: 'a', typeId: task.id, title: 'T', props }) as unknown as ObjectRecord
    const todo: PropertyValue = { kind: 'select', value: ['todo'] }
    const stored = obj({ status: todo, reviewed: day('2026-11-01') })
    const today = '2026-11-16'
    const closed = reviewedByStatusChange(obj({ status: { kind: 'select', value: ['done'] }, reviewed: day('2026-11-01') }), stored, task, today)
    expect(closed.props.reviewed).toEqual(day(today))
    // Status unchanged, a field other than the status changed, no stored copy, or no date on the type: left alone.
    const renamed = obj({ status: todo, reviewed: day('2026-11-01'), due: day('2026-11-20') })
    expect(reviewedByStatusChange(renamed, stored, task, today)).toBe(renamed)
    expect(reviewedByStatusChange(closed, undefined, task, today)).toBe(closed)
    const bare = obj({ status: { kind: 'select', value: ['done'] } })
    expect(reviewedByStatusChange(bare, obj({ status: todo }), page, today)).toBe(bare)
    // A save that sets the date itself keeps it, even to clear it.
    const own = obj({ status: { kind: 'select', value: ['done'] }, reviewed: day('2026-11-05') })
    expect(reviewedByStatusChange(own, stored, task, today)).toBe(own)
    const cleared = obj({ status: { kind: 'select', value: ['done'] } })
    expect(reviewedByStatusChange(cleared, stored, task, today)).toBe(cleared)
    // Setting a status on a task without one counts as a change.
    expect(reviewedByStatusChange(obj({ status: todo }), obj({}), task, today).props.reviewed).toEqual(day(today))
  })
})

describe('Hold', () => {
  it('sets an "On hold" status, or the one the type names; none when there is neither or it says none', () => {
    expect(holdAction(task)).toBeUndefined()
    const hold = holdAction(withHold('On Hold'))!
    expect(hold.name).toBe('On Hold')
    expect(hold.changes).toEqual([{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['hold'] } } }])
    expect(holdOptionOf(withHold('Someday'))).toBeUndefined()
    expect(holdOptionOf(withHold('Someday', { holdStatus: 'hold' }))?.label).toBe('Someday')
    expect(holdOptionOf(withHold('On hold', { holdStatus: 'none' }))).toBeUndefined()
    // Never an option meaning done.
    expect(holdOptionOf(withHold('On hold', { holdStatus: 'done' }))).toBeUndefined()
  })
})

describe('the Due for review filter', () => {
  const summary = (type: ObjectType, reviewed?: string, status: string | null = 'todo') => ({ id: 'a', typeId: type.id, title: 'A', tagIds: [], collectionIds: [], props: { ...(reviewed ? { reviewed: day(reviewed) } : {}), ...(status ? { status: { kind: 'select', value: [status] } } : {}) } }) as unknown as ObjectSummary
  const due = { kind: 'filter' as const, field: 'reviewDue', operator: 'is-checked' as const }
  const matches = (type: ObjectType, reviewed?: string, status?: string | null) => matchesFilter(summary(type, reviewed, status), due, { types: new Map([[type.id, type]]), today: '2026-11-14', timeZone: 'UTC' })

  it('follows the type\'s number of days', () => {
    expect(fieldKind('reviewDue')).toBe('checkbox')
    expect(matches(task)).toBe(true)
    expect(matches(task, '2026-11-10')).toBe(false)
    expect(matches(task, '2026-11-07')).toBe(true)
    const fortnight = { ...task, quickActions: { reviewEvery: 14 } }
    expect(matches(fortnight, '2026-11-07')).toBe(false)
    expect(matches({ ...task, quickActions: { reviewEvery: 3 } }, '2026-11-10')).toBe(true)
    expect(matches(page)).toBe(false)
  })

  it('is Review\'s check-ins: not closed tasks, not new ones', () => {
    const inbox = { ...task, properties: task.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [{ id: 'inbox', label: 'Inbox', status: 'todo' as const }, ...p.options] } : p)) }
    expect(matches(inbox, undefined, 'todo')).toBe(true)
    expect(matches(inbox, undefined, 'inbox')).toBe(false)
    expect(matches(inbox, undefined, null)).toBe(false)
    expect(matches(inbox, '2026-11-01', 'done')).toBe(false)
    // The same rule Review's queues use.
    const queues = taskWorkflowQueues(inbox, [summary(inbox, undefined, 'inbox'), summary(inbox, undefined, 'todo'), summary(inbox, '2026-11-14', 'todo'), summary(inbox, undefined, 'done')], '2026-11-14')
    expect(queues.triage).toHaveLength(1)
    expect(queues.review).toHaveLength(1)
  })
})
