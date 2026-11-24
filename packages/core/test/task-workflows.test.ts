import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue, QuickActionDef } from '../src/model.ts'
import { reviewButtons, reviewChoices, reviewQueues, settlesTriage, taskWorkflowQueues } from '../src/task-workflows.ts'
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

  it('leaves a snoozed task out of both queues until its day', () => {
    const day = (d: string): Record<string, PropertyValue> => ({ snoozed: { kind: 'date', value: { start: `${d}T00:00:00.000Z`, resolution: 'day' } } })
    const objects = [
      { ...object('new'), props: { ...object('new').props, ...day('2026-11-15') } },
      { ...object('check', 'next'), props: { ...object('check', 'next').props, ...day('2026-11-15') } },
      { ...object('back', 'next'), props: { ...object('back', 'next').props, ...day('2026-11-14') } },
      object('plain', 'next'),
    ]
    const queues = taskWorkflowQueues(task, objects, '2026-11-14')
    expect(queues.triage).toEqual([])
    expect(queues.review.map((o) => o.id)).toEqual(['back', 'plain'])
    const next = taskWorkflowQueues(task, objects, '2026-11-15')
    expect(next.triage.map((o) => o.id)).toEqual(['new'])
    expect(next.review.map((o) => o.id)).toEqual(['check', 'back', 'plain'])
    // What it means to be new is untouched.
    expect(needsTriage(task, objects[0]!)).toBe(true)
  })

  it('uses configured status ids across renames, ignores closed/deleted choices, and supports no incoming statuses', () => {
    const configured = { ...task, review: { incoming: ['wait', 'gone', 'done'] } }
    expect(triageOptionsOf(configured).map((o) => o.id)).toEqual(['wait'])
    expect(needsTriage(configured, object('a', 'wait'))).toBe(true)
    expect(needsTriage(configured, object('a', 'in'))).toBe(false)
    expect(needsTriage({ ...task, review: { incoming: [] } }, object('a', 'in'))).toBe(false)
    expect(needsTriage({ ...task, review: { incoming: [] } }, object('a'))).toBe(true)
    expect(needsTriage(task, object('a', 'deleted-option'))).toBe(true)
    // Without an Inbox option nothing is incoming by status: To do is a commitment, only a task with no status is new.
    expect(triageOptionsOf(base)).toEqual([])
    expect(needsTriage(base, object('a', 'todo'))).toBe(false)
    expect(needsTriage(base, object('a'))).toBe(true)
  })

  it('a review starts with every new task in the space, then the check-ins of the place it started from', () => {
    const inSpace = [
      { ...object('c-new', 'in'), createdAt: '2026-11-03T00:00:00Z' },
      { ...object('a-new'), createdAt: '2026-11-01T00:00:00Z' },
      { ...object('view-1', 'next'), createdAt: '2026-11-02T00:00:00Z' },
      { ...object('elsewhere', 'next'), createdAt: '2026-11-02T00:00:00Z' },
      { ...object('recent', 'next', '2026-11-13'), createdAt: '2026-11-02T00:00:00Z' },
    ]
    // The view shows a check-in and a new task, and not what is elsewhere or reviewed lately.
    const inView = [inSpace[2]!, inSpace[0]!, inSpace[4]!]
    const queues = reviewQueues(task, inSpace, inView, '2026-11-14')
    expect(queues.incoming.map((o) => o.id)).toEqual(['a-new', 'c-new'])
    expect(queues.checkIns.map((o) => o.id)).toEqual(['view-1'])
    // A sweep of all uses the space as the place.
    expect(reviewQueues(task, inSpace, inSpace, '2026-11-14').checkIns.map((o) => o.id)).toEqual(['view-1', 'elsewhere'])
    expect(reviewQueues(undefined, inSpace, inView, '2026-11-14')).toEqual({ incoming: [], checkIns: [] })
  })

  it('never treats note/date-only changes as a triage decision', () => {
    const edit: QuickActionDef = { id: 'next-step', name: 'Next step', changes: [{ field: 'next', value: { kind: 'ask' } }] }
    const defer: QuickActionDef = { id: 'defer', name: 'Defer', changes: [{ field: 'due', value: { kind: 'ask' } }] }
    expect(settlesTriage(task, edit)).toBe(false)
    expect(settlesTriage(task, defer)).toBe(false)
    for (const { action } of reviewChoices(task)) expect(settlesTriage(task, action)).toBe(true)
    const next = reviewChoices(task).find((c) => c.option.label === 'Next')!.action
    expect(settlesTriage(task, { ...defer, changes: [...defer.changes, ...next.changes] })).toBe(true)
    expect(settlesTriage(task, { ...next, changes: [{ field: 'status', value: { kind: 'clear' } }] })).toBe(false)
    expect(settlesTriage(task, { ...next, changes: [{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['in'] } } }] })).toBe(false)
  })

  it('uses existing statuses only, and respects configured review intervals', () => {
    expect(reviewChoices(task).map((c) => c.action.name)).toEqual(['Next', 'Waiting', 'On Hold', 'Done', 'Dropped'])
    const held = object('held', 'hold', '2026-11-07')
    expect(taskWorkflowQueues({ ...task, review: { every: 14 } }, [held], '2026-11-14').review).toEqual([])
    expect(taskWorkflowQueues({ ...task, review: { every: 0 } }, [held], '2026-11-14').review).toEqual([held])
    expect(taskWorkflowQueues(undefined, [held], '2026-11-14')).toEqual({ triage: [], review: [] })
  })

  it('uses the configured scheduling question instead of offering a status-only shortcut', () => {
    const configured = { ...task, quickActions: { actions: [{ id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' as const } }, { field: 'status', value: { kind: 'value' as const, value: { kind: 'select' as const, value: ['next'] } } }] }] } }
    const choices = reviewChoices(configured).map((c) => c.action)
    const schedule = choices.find((a) => a.id === 'defer')!
    expect(schedule.changes).toContainEqual({ field: 'dodate', value: { kind: 'ask' } })
    expect(choices.some((a) => a.id === 'status:next')).toBe(false)
    expect(settlesTriage(configured, schedule)).toBe(true)
  })

  it('offers every status that is not incoming as a review choice, open first, reusing actions that only place the task', () => {
    const configured: ObjectType = { ...task, quickActions: { actions: [
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
    expect(choices[2]!.action.id).toBe('status:hold')
    expect(choices[3]!.action.id).toBe('done')
    expect(choices[4]!.action.icon).toEqual({ kind: 'icon', value: 'ph:x-circle' })
    expect(reviewChoices({ ...task, system: undefined })).toEqual([])
  })

  describe('review buttons', () => {
    const set = (id: string): QuickActionDef['changes'][number] => ({ field: 'status', value: { kind: 'value', value: { kind: 'select', value: [id] } } })
    const typed: ObjectType = { ...task, properties: task.properties.map((p) => p.id === 'status' && p.kind === 'select' ? { ...p, options: [
      { id: 'in', label: 'Inbox', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' }, { id: 'sched', label: 'Scheduled', status: 'todo' },
      { id: 'wait', label: 'Waiting', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }, { id: 'hold', label: 'On Hold' },
    ] } : p), quickActions: { actions: [
      { id: 'done', name: 'Mark done', changes: [set('done')] },
      { id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }, set('sched')] },
      { id: 'drop', name: 'Drop', changes: [set('drop')] },
    ] } }
    const shape = (r: ReturnType<typeof reviewButtons>) => ({ main: r.main.map((b) => `${b.role}:${b.label}`), more: r.more.map((b) => b.label) })

    it('a new task: Today, Schedule, Done, Drop, Snooze; only the statuses left over as links', () => {
      expect(shape(reviewButtons(typed, 'in', true))).toEqual({ main: ['today:Today', 'defer:Schedule', 'done:Done', 'drop:Drop', 'snooze:Snooze'], more: ['Waiting'] })
    })

    it('Schedule offers No date (the first open status that is not the scheduled one) and Someday, each clearing the plan date', () => {
      const alternatives = (current: string | undefined, isNew: boolean, planned = false) => reviewButtons(typed, current, isNew, planned).main.find((b) => b.role === 'defer')!.alternatives
      const fresh = alternatives('in', true)!
      expect(fresh.map((a) => [a.id, a.label, a.hint])).toEqual([['no-date', 'No date', 'Ready whenever'], ['someday', 'Someday', 'Park it']])
      expect(fresh[0]!.action.changes).toEqual([set('next'), { field: 'dodate', value: { kind: 'clear' } }])
      expect(fresh[1]!.action.changes).toEqual([set('hold'), { field: 'dodate', value: { kind: 'clear' } }])
      expect(settlesTriage(typed, fresh[0]!.action)).toBe(true)
      expect(settlesTriage(typed, fresh[1]!.action)).toBe(true)
      // Check-ins have them too; one already there with no plan date leaves its own out, with a plan date it stays.
      expect(alternatives('wait', false)!.map((a) => a.id)).toEqual(['no-date', 'someday'])
      expect(alternatives('next', false)!.map((a) => a.id)).toEqual(['someday'])
      expect(alternatives('hold', false)!.map((a) => a.id)).toEqual(['no-date'])
      expect(alternatives('next', false, true)!.map((a) => a.id)).toEqual(['no-date', 'someday'])
      // A type with no such status has no Someday, and the statuses behind the two are no links.
      const bare = { ...typed, properties: typed.properties.map((p) => p.id === 'status' && p.kind === 'select' ? { ...p, options: p.options.filter((o) => o.id !== 'hold') } : p) }
      expect(reviewButtons(bare, 'in', true).main.find((b) => b.role === 'defer')!.alternatives!.map((a) => a.id)).toEqual(['no-date'])
      expect(shape(reviewButtons(typed, 'wait', false)).more).toEqual([])
    })

    it('Snooze sets Snoozed until for the type\'s number of days, and changes nothing else', () => {
      const snooze = (t: ObjectType) => reviewButtons(t, 'in', true).main.find((b) => b.role === 'snooze')!.action
      expect(snooze(typed)).toMatchObject({ id: 'snooze', name: 'Snoozed', changes: [{ field: 'snoozed', value: { kind: 'day', days: 1 } }] })
      expect(snooze({ ...typed, review: { snooze: 3 } }).changes).toEqual([{ field: 'snoozed', value: { kind: 'day', days: 3 } }])
      expect(settlesTriage(typed, snooze(typed))).toBe(false)
      expect(reviewButtons(typed, 'in', true).covered).toContain('snooze')
    })

    it('Today sets the plan date to today; a new task also goes to the first open status, a placed one keeps its own', () => {
      const today = (isNew: boolean) => reviewButtons(typed, isNew ? 'in' : 'wait', isNew).main.find((b) => b.role === 'today')!.action
      expect(today(false).changes).toEqual([{ field: 'dodate', value: { kind: 'day', days: 0 } }])
      expect(today(true).changes).toEqual([{ field: 'dodate', value: { kind: 'day', days: 0 } }, set('next')])
      expect(settlesTriage(typed, today(true))).toBe(true)
      expect(today(true).name).toBe('Today')
    })

    it('a Defer that only sets the day also places a new task: in the status named for it, else the first open one', () => {
      const dayOnly = (t: ObjectType): ObjectType => ({ ...t, quickActions: { actions: t.quickActions!.actions!.map((a) => (a.id === 'defer' ? { ...a, changes: [a.changes[0]!] } : a)) } })
      const fresh = reviewButtons(dayOnly(typed), 'in', true)
      const defer = fresh.main.find((b) => b.role === 'defer')!
      expect(defer.action.changes).toEqual([{ field: 'dodate', value: { kind: 'ask' } }, set('sched')])
      expect(defer.action.id).toBe('defer')
      expect(defer.option?.id).toBe('sched')
      expect(settlesTriage(dayOnly(typed), defer.action)).toBe(true)
      expect(shape(fresh)).toEqual({ main: ['today:Today', 'defer:Schedule', 'done:Done', 'drop:Drop', 'snooze:Snooze'], more: ['Waiting'] })
      // A task that has its place keeps it: the type's Defer as it is, and Scheduled stays a link.
      const placed = reviewButtons(dayOnly(typed), 'next', false)
      expect(placed.main.find((b) => b.role === 'defer')!.action.changes).toEqual([{ field: 'dodate', value: { kind: 'ask' } }])
      expect(shape(placed).more).toEqual(['Waiting'])
      // No status for scheduled work: the first open one, which is No date's too.
      const bare = dayOnly({ ...typed, properties: typed.properties.map((p) => p.id === 'status' && p.kind === 'select' ? { ...p, options: p.options.filter((o) => o.id !== 'sched') } : p) })
      const plain = reviewButtons(bare, 'in', true)
      expect(plain.main.find((b) => b.role === 'defer')!.action.changes.at(-1)).toEqual(set('next'))
      expect(shape(plain).main.slice(0, 2)).toEqual(['today:Today', 'defer:Schedule'])
    })

    it('a check-in never offers the status it has as a link', () => {
      expect(shape(reviewButtons(typed, 'next', false))).toEqual({ main: ['today:Today', 'defer:Schedule', 'done:Done', 'drop:Drop', 'snooze:Snooze'], more: ['Waiting'] })
      expect(shape(reviewButtons(typed, 'wait', false))).toEqual({ main: ['today:Today', 'defer:Schedule', 'done:Done', 'drop:Drop', 'snooze:Snooze'], more: [] })
      expect(shape(reviewButtons(typed, 'sched', false)).main[1]).toBe('defer:Schedule')
    })

    it('Schedule is the type\'s own Defer action, as rows and the task page run it, named Schedule here', () => {
      const { main, covered } = reviewButtons(typed, 'next', false)
      const defer = main.find((b) => b.role === 'defer')!
      expect(defer.action).toEqual({ ...typed.quickActions!.actions![1], name: 'Schedule' })
      expect(defer.option?.id).toBe('sched')
      expect(covered).toContain('defer')
      expect(main.find((b) => b.role === 'done')!.action.name).toBe('Done')
    })

    it('has no Schedule for a type without one, and its Scheduled status is a link', () => {
      const plain = { ...typed, quickActions: {}, properties: typed.properties.filter((p) => p.id !== 'dodate') }
      expect(shape(reviewButtons(plain, 'next', false)).main).toEqual(['done:Done', 'drop:Drop', 'snooze:Snooze'])
      expect(shape(reviewButtons(plain, 'next', false)).more).toContain('Scheduled')
    })

    it('no buttons without the built-in status', () => {
      expect(reviewButtons({ ...task, system: undefined }, undefined, true)).toEqual({ main: [], more: [], covered: [] })
    })
  })
})
