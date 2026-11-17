import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue, QuickActionDef } from '../src/model.ts'
import { reviewButtons, reviewChoices, settlesTriage, taskWorkflowQueues, triageDispositionActions } from '../src/task-workflows.ts'
import { needsTriage, triageOptionsOf } from '../src/task-status.ts'

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
    // Without an Inbox option nothing is incoming by status: To do is a commitment, only a task with no status is new.
    expect(triageOptionsOf(base)).toEqual([])
    expect(needsTriage(base, object('a', 'todo'))).toBe(false)
    expect(needsTriage(base, object('a'))).toBe(true)
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
    const configured = { ...task, quickActions: { actions: [{ id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' as const } }, { field: 'status', value: { kind: 'value' as const, value: { kind: 'select' as const, value: ['next'] } } }] }] } }
    const choices = triageDispositionActions(configured)
    const schedule = choices.find((a) => a.id === 'defer')!
    expect(schedule.changes).toContainEqual({ field: 'dodate', value: { kind: 'ask' } })
    expect(choices.some((a) => a.id === 'triage-status:next')).toBe(false)
    expect(settlesTriage(configured, schedule)).toBe(true)
  })

  it('offers every status that is not incoming as a review choice, open first, reusing actions that only place the task', () => {
    const configured: ObjectType = { ...task, quickActions: { holdStatus: 'hold', actions: [
      { id: 'done', name: 'Mark done', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['done'] } } }] },
      { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }, { field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['wait'] } } }] },
      { id: 'start', name: 'Start now', changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['next'] } } }, { field: 'priority', value: { kind: 'value', value: { kind: 'select', value: ['high'] } } }] },
    ] } }
    const choices = reviewChoices(configured)
    expect(choices.map((c) => c.option.id)).toEqual(['next', 'wait', 'hold', 'done', 'drop'])
    expect(choices.map((c) => c.action.name)).toEqual(['Next', 'Waiting', 'On Hold', 'Done', 'Dropped'])
    // Waiting keeps Defer's date question; Next is not taken from an action that also sets a priority.
    expect(choices[1]!.action.id).toBe('defer')
    expect(choices[1]!.action.changes[0]!.value.kind).toBe('ask')
    expect(choices[0]!.action.id).toBe('status:next')
    expect(choices[2]!.action.id).toBe('hold')
    expect(choices[3]!.action.id).toBe('done')
    expect(choices[4]!.action.icon).toEqual({ kind: 'icon', value: 'ph:x-circle' })
    expect(reviewChoices({ ...task, system: undefined })).toEqual([])
  })

  describe('review buttons', () => {
    const set = (id: string): QuickActionDef['changes'][number] => ({ field: 'status', value: { kind: 'value', value: { kind: 'select', value: [id] } } })
    const typed: ObjectType = { ...task, properties: task.properties.map((p) => p.id === 'status' && p.kind === 'select' ? { ...p, options: [
      { id: 'in', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' }, { id: 'sched', label: 'Scheduled', status: 'todo' },
      { id: 'wait', label: 'Waiting', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }, { id: 'hold', label: 'On Hold' },
    ] } : p), quickActions: { holdStatus: 'hold', actions: [
      { id: 'done', name: 'Mark done', changes: [set('done')] },
      { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }, set('sched')] },
      { id: 'drop', name: 'Drop', changes: [set('drop')] },
    ] } }
    const shape = (r: ReturnType<typeof reviewButtons>) => ({ main: r.main.map((b) => `${b.role}:${b.label}`), more: r.more.map((b) => b.label) })

    it('a new task: Next, Defer, Done, Drop; the other open statuses as links', () => {
      expect(shape(reviewButtons(typed, 'in', true))).toEqual({ main: ['next:Next', 'defer:Defer', 'done:Done', 'drop:Drop'], more: ['Waiting', 'On Hold'] })
    })

    it('a check-in never offers the status it has; Next becomes a link', () => {
      expect(shape(reviewButtons(typed, 'next', false))).toEqual({ main: ['defer:Defer', 'done:Done', 'drop:Drop'], more: ['Waiting', 'On Hold'] })
      expect(shape(reviewButtons(typed, 'wait', false))).toEqual({ main: ['defer:Defer', 'done:Done', 'drop:Drop'], more: ['Next', 'On Hold'] })
      expect(shape(reviewButtons(typed, 'sched', false)).main[0]).toBe('defer:Defer')
    })

    it('Defer is the type\'s own Defer action, as rows and the task page run it', () => {
      const { main, covered } = reviewButtons(typed, 'next', false)
      const defer = main.find((b) => b.role === 'defer')!
      expect(defer.action).toEqual(typed.quickActions!.actions![1])
      expect(defer.option?.id).toBe('sched')
      expect(covered).toContain('defer')
      expect(main.find((b) => b.role === 'done')!.action.name).toBe('Done')
    })

    it('has no Defer for a type without one, and its Scheduled status is a link', () => {
      const plain = { ...typed, quickActions: { holdStatus: 'hold' }, properties: typed.properties.filter((p) => p.id !== 'dodate') }
      expect(shape(reviewButtons(plain, 'next', false)).main).toEqual(['done:Done', 'drop:Drop'])
      expect(shape(reviewButtons(plain, 'next', false)).more).toContain('Scheduled')
    })

    it('no buttons without the built-in status', () => {
      expect(reviewButtons({ ...task, system: undefined }, undefined, true)).toEqual({ main: [], more: [], covered: [] })
    })
  })
})
