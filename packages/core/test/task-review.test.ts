import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectRecord, ObjectType, PropertyValue, QuickActionDef } from '../src/model.ts'
import type { ObjectSummary } from '../src/model.ts'
import { fieldKind, matchesFilter } from '../src/query.ts'
import { quickActionEdit, quickActionMessage } from '../src/task-actions.ts'
import { taskWorkflowQueues } from '../src/task-workflows.ts'
import { DEFAULT_SNOOZE_DAYS, dueForReview, hasDayAhead, isCheckInDue, isSnoozed, reviewEveryOf, reviewFieldOf, reviewedAction, reviewedByStatusChange, snoozeAction, snoozeDaysOf, snoozeFieldOf, withReviewed, withSnoozeCleared } from '../src/task-review.ts'

const AT = '2026-11-14T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!
const context = { today: '2026-11-14', nextWeek: '2026-11-16', timeZone: 'UTC' }
const day = (value: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day' } })
const reviewedOn = (value?: string): { props: Record<string, PropertyValue> } => ({ props: value ? { reviewed: day(value) } : {} })
describe('review dates', () => {
  it('a task has Last reviewed; other types and a task without it have none', () => {
    expect(reviewFieldOf(task)?.name).toBe('Last reviewed')
    expect(reviewFieldOf(page)).toBeUndefined()
    expect(reviewFieldOf({ ...task, properties: task.properties.filter((p) => p.id !== 'reviewed') })).toBeUndefined()
  })

  it('come up again after a week unless the type says otherwise', () => {
    expect(reviewEveryOf(task)).toBe(7)
    expect(reviewEveryOf({ ...task, review: { every: 14 } })).toBe(14)
    expect(reviewEveryOf({ ...task, review: { every: -1 } })).toBe(7)
    expect(dueForReview(task, reviewedOn(), '2026-11-14')).toBe(true)
    expect(dueForReview(task, reviewedOn('2026-11-08'), '2026-11-14')).toBe(false)
    expect(dueForReview(task, reviewedOn('2026-11-07'), '2026-11-14')).toBe(true)
    expect(dueForReview({ ...task, review: { every: 0 } }, reviewedOn('2026-11-14'), '2026-11-14')).toBe(true)
    // Without the date every open task is reviewed every time, as before.
    expect(dueForReview(page, reviewedOn('2026-11-14'), '2026-11-14')).toBe(true)
  })

  it('a task whose Snoozed until day has come is due on it, even reviewed a day earlier, but not before or after a review since', () => {
    const waiting = (snoozed: string, reviewed?: string) => ({ props: { status: { kind: 'select' as const, value: ['todo'] }, snoozed: day(snoozed), ...(reviewed ? { reviewed: day(reviewed) } : {}) } as Record<string, PropertyValue> })
    // Reviewed the day it was put off: its week has not passed, the day has.
    expect(dueForReview(task, waiting('2026-11-21', '2026-11-14'), '2026-11-20')).toBe(false)
    expect(dueForReview(task, waiting('2026-11-21', '2026-11-14'), '2026-11-21')).toBe(true)
    expect(isCheckInDue(task, waiting('2026-11-21', '2026-11-14'), '2026-11-21')).toBe(true)
    expect(isCheckInDue(task, waiting('2026-11-21', '2026-11-14'), '2026-11-20')).toBe(false)
    expect(dueForReview(task, waiting('2026-11-21', '2026-11-14'), '2026-11-23')).toBe(true)
    // Reviewed on or after that day: the usual weekly cadence again.
    expect(dueForReview(task, waiting('2026-11-21', '2026-11-21'), '2026-11-22')).toBe(false)
    expect(dueForReview(task, waiting('2026-11-21', '2026-11-22'), '2026-11-23')).toBe(false)
    expect(dueForReview(task, waiting('2026-11-21'), '2026-11-21')).toBe(true)
  })

  it('a check-in is for a task with no date or one that has passed; one with a day ahead waits for it', () => {
    const plan = task.properties.find((p) => p.kind === 'date' && p.role === 'plan')!.id
    const placed = (dates: Record<string, string>) => ({ props: { status: { kind: 'select' as const, value: ['todo'] }, ...Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, day(v)])) } as Record<string, PropertyValue> })
    expect(isCheckInDue(task, placed({}), '2026-11-14')).toBe(true)
    expect(isCheckInDue(task, placed({ [plan]: '2026-11-13' }), '2026-11-14')).toBe(true)
    expect(isCheckInDue(task, placed({ due: '2026-11-10' }), '2026-11-14')).toBe(true)
    // Planned or due today, or later: not yet.
    expect(isCheckInDue(task, placed({ [plan]: '2026-11-14' }), '2026-11-14')).toBe(false)
    expect(isCheckInDue(task, placed({ due: '2026-12-01' }), '2026-11-14')).toBe(false)
    expect(hasDayAhead(task, placed({ [plan]: '2026-11-20', due: '2026-12-01' }), '2026-11-14')).toBe(true)
    // Planned ahead but already overdue: it has passed.
    expect(isCheckInDue(task, placed({ [plan]: '2026-11-20', due: '2026-11-13' }), '2026-11-14')).toBe(true)
    // A timed Due is read in the viewer's zone: 03:00 UTC on the 14th is still the 13th in Toronto.
    const timed = { props: { status: { kind: 'select' as const, value: ['todo'] }, due: { kind: 'date', value: { start: '2026-11-14T03:00:00.000Z', resolution: 'time' } } } as Record<string, PropertyValue> }
    expect(isCheckInDue(task, timed, '2026-11-14', 'UTC')).toBe(false)
    expect(isCheckInDue(task, timed, '2026-11-14', 'America/Toronto')).toBe(true)
    // A span is passed only once it has ended, as on the overdue list.
    const span = (start: string, end: string) => ({ props: { status: { kind: 'select' as const, value: ['todo'] }, [plan]: { kind: 'date', value: { start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z`, resolution: 'day' } } } as Record<string, PropertyValue> })
    expect(isCheckInDue(task, span('2026-11-10', '2026-11-20'), '2026-11-14')).toBe(false)
    expect(isCheckInDue(task, span('2026-11-10', '2026-11-13'), '2026-11-14')).toBe(true)
    // A repeating date is read at its current occurrence (the next one not done), as on the overdue list.
    const repeating = (start: string) => ({ props: { status: { kind: 'select' as const, value: ['todo'] }, due: { kind: 'date', value: { start: `${start}T00:00:00.000Z`, resolution: 'day', rrule: 'FREQ=WEEKLY' } } } as Record<string, PropertyValue> })
    expect(isCheckInDue(task, repeating('2026-11-20'), '2026-11-14')).toBe(false)
    expect(isCheckInDue(task, repeating('2026-11-06'), '2026-11-14')).toBe(true)
    // Back from Waiting… on its day (its Do date moved there): in the check-ins even so.
    expect(isCheckInDue(task, { props: { ...placed({ [plan]: '2026-11-21', snoozed: '2026-11-21', reviewed: '2026-11-14' }).props } }, '2026-11-21')).toBe(true)
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

describe('snooze', () => {
  const snoozedOn = (value: string, status = 'todo'): { props: Record<string, PropertyValue> } => ({ props: { status: { kind: 'select', value: [status] }, snoozed: day(value) } })

  it('a task has Snoozed until; other types and a task without it have none', () => {
    expect(snoozeFieldOf(task)?.name).toBe('Snoozed until')
    expect(snoozeFieldOf(page)).toBeUndefined()
    expect(snoozeAction({ ...task, properties: task.properties.filter((p) => p.id !== 'snoozed') })).toBeUndefined()
  })

  it('hides a task for a day unless the type says otherwise; a bad number means the default', () => {
    expect(DEFAULT_SNOOZE_DAYS).toBe(1)
    expect(snoozeDaysOf(task)).toBe(1)
    expect(snoozeDaysOf({ ...task, review: { snooze: 3 } })).toBe(3)
    for (const bad of [0, -2, 1.5]) expect(snoozeDaysOf({ ...task, review: { snooze: bad } })).toBe(1)
    const edit = quickActionEdit(task, { id: 'a', props: {} }, snoozeAction({ ...task, review: { snooze: 3 } })!, context)!
    expect(edit.values).toEqual({ snoozed: day('2026-11-17') })
    expect(edit.before).toEqual({ snoozed: undefined })
  })

  it('is hidden until its day, then back; in the check-ins and the Due for review filter alike', () => {
    expect(isSnoozed(task, snoozedOn('2026-11-15'), '2026-11-14')).toBe(true)
    expect(isSnoozed(task, snoozedOn('2026-11-14'), '2026-11-14')).toBe(false)
    expect(isSnoozed(task, { props: {} }, '2026-11-14')).toBe(false)
    expect(isCheckInDue(task, snoozedOn('2026-11-15'), '2026-11-14')).toBe(false)
    expect(isCheckInDue(task, snoozedOn('2026-11-15'), '2026-11-15')).toBe(true)
  })

  it('changes nothing else and is not a review; any other decision clears it, and Undo has it back', () => {
    const snooze = snoozeAction(task)!
    expect(withReviewed(task, snooze, { props: {} })).toBe(snooze)
    expect(withSnoozeCleared(task, snooze, snoozedOn('2026-11-10'))).toBe(snooze)
    const keep = reviewedAction(task)!
    expect(withSnoozeCleared(task, keep, { props: {} })).toBe(keep)
    const cleared = withSnoozeCleared(task, keep, snoozedOn('2026-11-10'))
    const edit = quickActionEdit(task, { id: 'a', ...snoozedOn('2026-11-10') }, cleared, context)!
    expect(edit.values).toEqual({ reviewed: day('2026-11-14'), snoozed: undefined })
    expect(edit.before.snoozed).toEqual(day('2026-11-10'))
    expect(withSnoozeCleared(page, keep, snoozedOn('2026-11-10'))).toBe(keep)
  })

  it('reads "Snoozed until Wed" in the notice', () => {
    const edit = quickActionEdit(task, { id: 'a', props: {} }, snoozeAction(task)!, context)!
    expect(quickActionMessage(task, snoozeAction(task)!, edit, { longDay: (d) => `day ${d}`, timeZone: 'UTC' })).toBe('Snoozed until day 2026-11-15')
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
    const fortnight = { ...task, review: { every: 14 } }
    expect(matches(fortnight, '2026-11-07')).toBe(false)
    expect(matches({ ...task, review: { every: 3 } }, '2026-11-10')).toBe(true)
    expect(matches(page)).toBe(false)
  })

  it('leaves out a task with a day ahead', () => {
    const dated = { ...summary(task), props: { ...summary(task).props, due: day('2026-12-01') } } as ObjectSummary
    expect(matchesFilter(dated, due, { types: new Map([[task.id, task]]), today: '2026-11-14', timeZone: 'UTC' })).toBe(false)
    expect(matchesFilter(dated, due, { types: new Map([[task.id, task]]), today: '2026-12-02', timeZone: 'UTC' })).toBe(true)
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
