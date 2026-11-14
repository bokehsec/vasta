import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue } from '../src/model.ts'
import { quickActionEdits, quickActionMessage } from '../src/task-actions.ts'
import { dueForReview, holdAction, holdOptionOf, reviewEveryOf, reviewFieldOf, reviewedAction, withReviewed } from '../src/task-review.ts'

const AT = '2026-11-14T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!
const context = { today: '2026-11-14', nextWeek: '2026-11-16' }
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

  it('Reviewed sets today, and an action made in a review sets it too, without saying so in the notice', () => {
    const reviewed = reviewedAction(task)!
    const [edit] = quickActionEdits(task, [{ id: 'a', props: {} }], reviewed, context)
    expect(edit!.values).toEqual({ reviewed: day('2026-11-14') })
    expect(edit!.before).toEqual({ reviewed: undefined })
    const done = withReviewed(task, { id: 'done', name: 'Done', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['done'] } } }] })
    expect(done.changes.map((c) => c.field)).toEqual(['status', 'reviewed'])
    expect(withReviewed(task, reviewed)).toBe(reviewed)
    expect(withReviewed(page, done)).toBe(done)
    const edits = quickActionEdits(task, [{ id: 'a', props: {} }], done, context)
    expect(quickActionMessage(task, done, edits, { longDay: (d) => d, dayOfTime: (iso) => iso.slice(0, 10) })).toBe('Done')
    expect(reviewedAction(page)).toBeUndefined()
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
