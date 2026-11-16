import { describe, expect, it } from 'vitest'
import { createBuiltinTypes, newObject, plannedDateFieldOf, type CalendarEntry, type DateValue, type ObjectSummary } from '@vasta/core'
import { objectEntries } from '@vasta/core/calendar'
import { dayTaskGroups, taskDateRole, taskEntryCheckable } from './calendar-tasks.ts'

const at = '2026-11-16T12:00:00.000Z'
const base = createBuiltinTypes('space', at).find((t) => t.system === 'task')!
const task = { ...base, properties: [...base.properties, { id: 'work', kind: 'date' as const, name: 'Do date' }], quickActions: { deferField: 'work' } }
const types = new Map([[task.id, task]])
const day = (n: number): DateValue => ({ start: `2026-11-${n}T00:00:00.000Z`, resolution: 'day' })
const timed = (hour: string): DateValue => ({ start: `2026-11-15T${hour}:00.000Z`, resolution: 'time' })
const object = (plan?: DateValue, due?: DateValue, status = 'todo'): ObjectSummary => ({ ...newObject(task, { title: 'Task', props: { status: { kind: 'select', value: [status] }, ...(plan ? { work: { kind: 'date', value: plan } } : {}), ...(due ? { due: { kind: 'date', value: due } } : {}) } }, 'task', at), preview: '' })
const entries = (o: ObjectSummary) => objectEntries([o], types, { from: '2026-11-15', to: '2026-11-30' }, 'America/Toronto')
const groups = (o: ObjectSummary, on = '2026-11-15', retained = (_e: CalendarEntry) => false) => dayTaskGroups(entries(o).filter((e) => e.startDay <= on && e.endDay >= on), () => o, types, retained)

describe('task calendar dates', () => {
  it('uses the configured plan field, not arbitrary date properties or the type icon', () => {
    expect(taskDateRole(task, 'work')).toBe('planned')
    expect(taskDateRole(task, 'due')).toBe('due')
    expect(taskDateRole(task, 'reviewed')).toBeUndefined()
    expect(taskDateRole(task, 'checkback')).toBeUndefined()
    expect(plannedDateFieldOf(base)).toBeUndefined()
    expect(plannedDateFieldOf({ ...task, system: undefined })).toBeUndefined()
    expect(plannedDateFieldOf({ ...task, quickActions: { actions: [{ id: 'schedule', name: 'Schedule', changes: [{ field: 'work', value: { kind: 'ask' } }] }] } })?.id).toBe('work')
  })
  it('combines the same-day all-day plan and deadline into one planned row', () => {
    const g = groups(object(day(15), day(15)))
    expect(g.planned).toHaveLength(1)
    expect(g.due).toHaveLength(0)
    expect(g.completed).toHaveLength(0)
  })
  it('keeps earlier plans and later deadlines on their own days, still open', () => {
    const o = object(day(15), day(22))
    expect(groups(o).planned).toHaveLength(1)
    expect(groups(o, '2026-11-22').due).toHaveLength(1)
    expect(groups(o).completed).toHaveLength(0)
    const moved = object(day(22), day(15))
    expect(groups(moved).planned).toHaveLength(0)
    expect(groups(moved).due).toHaveLength(1)
    expect(groups(moved, '2026-11-22').planned).toHaveLength(1)
  })
  it('keeps distinct timed appointments, even for the same task and day', () => {
    const g = groups(object(timed('14:00'), timed('18:00')))
    expect(g.planned).toHaveLength(1)
    expect(g.due).toHaveLength(1)
  })
  it('retains completed plans without needing a due date, and distinguishes Dropped', () => {
    expect(groups(object(day(15), undefined, 'done')).completed).toHaveLength(1)
    expect(groups(object(day(15)), undefined, () => true).completed).toHaveLength(1)
    const status = task.properties.find((p) => p.id === 'status')!
    if (status.kind !== 'select') throw new Error('status')
    const withDrop = { ...task, properties: task.properties.map((p) => p.id === 'status' ? { ...status, options: [...status.options, { id: 'drop', label: 'Dropped', status: 'done' as const }] } : p) }
    const o = object(day(15), undefined, 'drop')
    const g = dayTaskGroups(entries(o), () => o, new Map([[task.id, withDrop]]), () => false)
    expect(g.dropped).toHaveLength(1)
    expect(g.completed).toHaveLength(0)
  })
  it('keeps administrative dates separate from planned work and deadlines', () => {
    const o = object()
    o.props.reviewed = { kind: 'date', value: day(15) }
    expect(groups(o).scheduled).toHaveLength(1)
    expect(groups(o).planned).toHaveLength(0)
  })
  it('only completes the current repeating due occurrence, never a stale plan', () => {
    const o = object(day(15), { ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' })
    const feed = entries(o)
    const plan = feed.find((e) => e.field === 'work')!
    const due = feed.filter((e) => e.field === 'due')
    expect(taskEntryCheckable(plan, task, o)).toBe(false)
    expect(due.map((e) => taskEntryCheckable(e, task, o))).toEqual([true, false, false])
    const g = groups(o)
    expect(g.planned).toHaveLength(1)
    expect(g.planned[0]?.entry.field).toBe('due')
    expect(taskEntryCheckable(g.planned[0]!.entry, task, o)).toBe(true)
  })
  it('does not collapse multiple same-time repeats into a single plan', () => {
    const o = object(day(15), day(15)), feed = entries(o)
    const deadline = feed.find((e) => e.field === 'due')!
    const second = { ...deadline, key: deadline.key + ':other', occurrence: 'other', recurring: true }
    const g = dayTaskGroups([...feed, second], () => o, types, () => false)
    expect(g.planned.length + g.due.length).toBe(2)
  })
  it('does not close a whole repeating plan from its first occurrence', () => {
    const o = object({ ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' })
    expect(entries(o).map((e) => taskEntryCheckable(e, task, o))).toEqual([false, false, false])
    const withDue = object({ ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' }, day(15))
    expect(groups(withDue).planned[0]?.entry.field).toBe('due')
  })
})
