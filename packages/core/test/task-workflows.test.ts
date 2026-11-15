import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue, QuickActionDef } from '../src/model.ts'
import { needsTriage, settlesTriage, taskWorkflowQueues, triageDispositionActions, triageOptionsOf } from '../src/task-workflows.ts'

const base = createBuiltinTypes('s', '2026-11-14T12:00:00Z').find((t) => t.system === 'task')!
const task: ObjectType = {
  ...base,
  properties: base.properties.map((p) => p.id === 'status' && p.kind === 'select' ? { ...p, options: [
    { id: 'in', label: 'Inbox', status: 'todo' },
    { id: 'next', label: 'Next', status: 'todo' },
    { id: 'wait', label: 'Waiting', status: 'todo' },
    { id: 'hold', label: 'On Hold' },
    { id: 'done', label: 'Done', status: 'done' },
    { id: 'drop', label: 'Dropped', status: 'done' },
  ] } : p),
}
const object = (id: string, status?: string, reviewed?: string) => ({ id, props: {
  ...(status ? { status: { kind: 'select', value: [status] } } : {}),
  ...(reviewed ? { reviewed: { kind: 'date', value: { start: `${reviewed}T00:00:00.000Z`, resolution: 'day' } } } : {}),
} as Record<string, PropertyValue> })

describe('sister task workflows', () => {
  it('triages incoming regardless of review recency or next step, and reviews only commitments due', () => {
    const incoming = { ...object('in', 'in', '2026-11-14'), props: { ...object('in', 'in', '2026-11-14').props, next: { kind: 'text' as const, value: 'Call someone' } } }
    const objects = [incoming, object('none'), object('next', 'next'), object('hold', 'hold', '2026-11-07'), object('recent', 'wait', '2026-11-13'), object('done', 'done'), object('drop', 'drop')]
    const queues = taskWorkflowQueues(task, objects, '2026-11-14')
    expect(queues.triage.map((o) => o.id)).toEqual(['in', 'none'])
    expect(queues.review.map((o) => o.id)).toEqual(['next', 'hold'])
    expect(new Set([...queues.triage, ...queues.review]).size).toBe(4)
  })

  it('uses configured status ids across renames, ignores closed/deleted choices, and supports no incoming statuses', () => {
    const configured = { ...task, quickActions: { triageStatuses: ['wait', 'gone', 'done'] } }
    expect(triageOptionsOf(configured).map((o) => o.id)).toEqual(['wait'])
    expect(needsTriage(configured, object('a', 'wait'))).toBe(true)
    expect(needsTriage(configured, object('a', 'in'))).toBe(false)
    expect(needsTriage({ ...task, quickActions: { triageStatuses: [] } }, object('a', 'in'))).toBe(false)
    expect(needsTriage({ ...task, quickActions: { triageStatuses: [] } }, object('a'))).toBe(true)
    expect(needsTriage(task, object('a', 'deleted-option'))).toBe(true)
    expect(triageOptionsOf(base).map((o) => o.id)).toEqual(['todo'])
  })

  it('never treats note/date-only changes as a triage decision', () => {
    const edit: QuickActionDef = { id: 'next-step', name: 'Next step', changes: [{ field: 'next', value: { kind: 'ask' } }] }
    const defer: QuickActionDef = { id: 'defer', name: 'Defer', changes: [{ field: 'due', value: { kind: 'ask' } }] }
    expect(settlesTriage(task, edit)).toBe(false)
    expect(settlesTriage(task, defer)).toBe(false)
    for (const disposition of triageDispositionActions(task)) expect(settlesTriage(task, disposition)).toBe(true)
    const next = triageDispositionActions(task).find((a) => a.name === 'Next')!
    expect(settlesTriage(task, { ...defer, changes: [...defer.changes, ...next.changes] })).toBe(true)
    expect(settlesTriage(task, { ...next, changes: [{ field: 'status', value: { kind: 'clear' } }] })).toBe(false)
    expect(settlesTriage(task, { ...next, changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['in'] } } }] })).toBe(false)
  })

  it('uses existing statuses only, and respects configured review intervals', () => {
    expect(triageDispositionActions(task).map((a) => a.name)).toEqual(['Next', 'Waiting', 'On Hold', 'Done', 'Dropped'])
    const held = object('held', 'hold', '2026-11-07')
    expect(taskWorkflowQueues({ ...task, quickActions: { reviewEvery: 14 } }, [held], '2026-11-14').review).toEqual([])
    expect(taskWorkflowQueues({ ...task, quickActions: { reviewEvery: 0 } }, [held], '2026-11-14').review).toEqual([held])
    expect(taskWorkflowQueues(undefined, [held], '2026-11-14')).toEqual({ triage: [], review: [] })
  })

  it('uses the configured scheduling question instead of offering a status-only shortcut', () => {
    const configured = { ...task, quickActions: { deferStatus: 'next', deferField: 'due' } }
    const choices = triageDispositionActions(configured)
    const schedule = choices.find((a) => a.id === 'defer')!
    expect(schedule.changes).toContainEqual({ field: 'due', value: { kind: 'ask' } })
    expect(choices.some((a) => a.id === 'triage-status:next')).toBe(false)
    expect(settlesTriage(configured, schedule)).toBe(true)
  })
})
