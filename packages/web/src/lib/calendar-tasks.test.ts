import { describe, expect, it } from 'vitest'
import { createBuiltinTypes, newObject, taskDatesOf, type CalendarEntry, type DateValue, type Id, type ObjectSummary, type ObjectType } from '@vasta/core'
import { objectEntries } from '@vasta/core/calendar'
import {
  DEFAULT_SCHEDULE_MINUTES,
  canComplete,
  classifyScheduleItems,
  dayTaskGroups,
  entryBadges,
  entryNote,
  isObjectDone,
  mergeTaskDates,
  movedEntryTimes,
  plannedAfterDeadline,
  primaryDateProperty,
  schedulableTypes,
  scheduledDateForDrop,
  taskDateRole,
  taskEntryCheckable,
} from './calendar-tasks.ts'

const at = '2026-11-16T12:00:00.000Z'
const base = createBuiltinTypes('space', at).find((t) => t.system === 'task')!
const task = { ...base, properties: [...base.properties.map((p) => (p.id === 'dodate' ? { ...p, id: 'work' } : p)), { id: 'checkback', kind: 'date' as const, name: 'Check back' }] }
const types = new Map([[task.id, task]])
const day = (n: number): DateValue => ({ start: `2026-11-${n}T00:00:00.000Z`, resolution: 'day' })
const timed = (hour: string): DateValue => ({ start: `2026-11-15T${hour}:00.000Z`, resolution: 'time' })
const object = (plan?: DateValue, due?: DateValue, status = 'todo'): ObjectSummary => ({ ...newObject(task, { title: 'Task', props: { status: { kind: 'select', value: [status] }, ...(plan ? { work: { kind: 'date', value: plan } } : {}), ...(due ? { due: { kind: 'date', value: due } } : {}) } }, 'task', at), preview: '' })
const entries = (o: ObjectSummary) => objectEntries([o], types, { from: '2026-11-15', to: '2026-11-30' }, 'America/Toronto')
const merged = (o: ObjectSummary) => mergeTaskDates(entries(o), () => o, types)
const groups = (o: ObjectSummary, on = '2026-11-15', retained = (_e: CalendarEntry) => false) => dayTaskGroups(merged(o).filter((e) => e.startDay <= on && e.endDay >= on), () => o, types, retained)

describe('task calendar dates', () => {
  it('uses the configured plan field, not arbitrary date properties or the type icon', () => {
    expect(taskDateRole(task, 'work')).toBe('plan')
    expect(taskDateRole(task, 'due')).toBe('deadline')
    expect(taskDateRole(task, 'reviewed')).toBeUndefined()
    expect(taskDateRole(task, 'checkback')).toBeUndefined()
    expect(taskDatesOf(task).plan?.id).toBe('work')
    const unplanned = { ...task, properties: task.properties.map((p) => (p.id === 'work' && p.kind === 'date' ? { ...p, role: undefined } : p)) }
    expect(taskDateRole(unplanned, 'work')).toBeUndefined()
    expect(taskDateRole({ ...task, system: undefined }, 'work')).toBeUndefined()
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
  it('combines a plan and a deadline of the same day in any slot: one entry, the timed one kept', () => {
    const g = groups(object(day(15), timed('18:00')))
    expect(g.planned).toHaveLength(1)
    expect(g.due).toHaveLength(0)
    expect(g.planned[0]).toMatchObject({ field: 'due', allDay: false, alsoField: 'work' })
    expect(groups(object(timed('14:00'), timed('18:00'))).planned[0]).toMatchObject({ field: 'due', alsoField: 'work' })
    expect(groups(object(timed('14:00'), day(15))).planned[0]).toMatchObject({ field: 'work', alsoField: 'due' })
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
    o.props.checkback = { kind: 'date', value: day(15) }
    expect(groups(o).scheduled).toHaveLength(1)
    expect(groups(o).planned).toHaveLength(0)
    // The Last reviewed day, set by every status change, is not on the calendar at all.
    o.props.reviewed = { kind: 'date', value: day(16) }
    expect(entries(o).map((e) => e.field)).not.toContain('reviewed')
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
    expect(g.planned[0]?.field).toBe('due')
    expect(taskEntryCheckable(g.planned[0]!, task, o)).toBe(true)
  })
  it('does not collapse multiple same-time repeats into a single plan', () => {
    const o = object(day(15), day(15)), feed = entries(o)
    const deadline = feed.find((e) => e.field === 'due')!
    const second = { ...deadline, key: deadline.key + ':other', occurrence: 'other', recurring: true }
    const g = dayTaskGroups(mergeTaskDates([...feed, second], () => o, types), () => o, types, () => false)
    expect(g.planned.length + g.due.length).toBe(2)
  })
  it('does not close a whole repeating plan from its first occurrence', () => {
    const o = object({ ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' })
    expect(entries(o).map((e) => taskEntryCheckable(e, task, o))).toEqual([false, false, false])
    const withDue = object({ ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' }, day(15))
    expect(groups(withDue).planned[0]?.field).toBe('due')
  })
})

describe('one entry per task per day', () => {
  it('merges a plan and a deadline on the same day only, once each', () => {
    expect(merged(object(day(15), day(15)))).toHaveLength(1)
    expect(merged(object(day(15), day(22)))).toHaveLength(2)
    // A span covering the deadline's day keeps being a span.
    expect(merged(object({ start: day(15).start, end: day(18).start, resolution: 'day' }, day(16)))).toHaveLength(2)
    // Two plans of one day, two deadlines: each deadline pairs with one plan.
    const o = object(day(15), day(15))
    const [plan, deadline] = entries(o)
    const more = [plan!, deadline!, { ...plan!, key: 'other-plan' }]
    expect(mergeTaskDates(more, () => o, types)).toHaveLength(2)
  })
  it('keeps the checkable repeating deadline and marks the plan it stands for', () => {
    const o = object(day(15), { ...day(15), rrule: 'FREQ=WEEKLY;COUNT=3' })
    const feed = merged(o)
    expect(feed).toHaveLength(3)
    expect(feed[0]).toMatchObject({ field: 'due', alsoField: 'work', current: true })
    expect(feed.filter((e) => e.alsoField)).toHaveLength(1)
  })
  it('leaves other objects, role-less dates and late entries alone', () => {
    const o = object(day(15), day(15))
    o.props.checkback = { kind: 'date', value: day(15) }
    expect(merged(o)).toHaveLength(2)
    expect(mergeTaskDates(entries(o).map((e) => ({ ...e, overdue: [{ field: e.field!, day: '2026-11-14' }] })), () => o, types)).toHaveLength(3)
  })
})

describe('what an entry says', () => {
  const say = (day: string) => day
  const feed = (o: ObjectSummary) => Object.fromEntries(merged(o).map((e) => [e.field!, e]))
  it('names the role, both when merged, the date for a plain date, Done once closed', () => {
    const o = object(day(15), day(22))
    o.props.checkback = { kind: 'date', value: day(17) }
    const e = feed(o)
    expect(entryBadges(e.work!, task, undefined, say).map((b) => b.label)).toEqual(['Planned'])
    expect(entryBadges(e.due!, task, undefined, say).map((b) => b.label)).toEqual(['Due'])
    expect(entryBadges(e.checkback!, task, undefined, say).map((b) => b.label)).toEqual(['Check back'])
    expect(entryBadges(merged(object(day(15), day(15)))[0]!, task, undefined, say).map((b) => b.label)).toEqual(['Planned', 'Due'])
    expect(entryBadges(e.work!, task, 'done', say).map((b) => b.label)).toEqual(['Done'])
    expect(entryBadges(e.work!, task, 'dropped', say).map((b) => b.label)).toEqual(['Dropped'])
  })
  it('says what is late, the deadline first, and notes the dates that are not late', () => {
    const o = object(day(15), day(22))
    const late = { ...entries(o)[0]!, overdue: [{ field: 'due', day: '2026-11-10' }, { field: 'work', day: '2026-11-12' }] }
    expect(entryBadges(late, task, undefined, (d) => `on ${d}`).map((b) => b.label)).toEqual(['Due on 2026-11-10', 'Planned on 2026-11-12'])
    expect(entryNote({ ...late, overdue: [late.overdue[0]!] }, task, o, () => 'X')).toBe('Planned for X')
    expect(entryNote({ ...late, overdue: [late.overdue[1]!] }, task, o, () => 'X')).toBe('Due by X')
    expect(entryNote(late, task, o, () => 'X')).toBe('')
  })
  it('notes the other date of a plan or a deadline', () => {
    const o = object(day(15), day(22))
    const e = feed(o)
    expect(entryNote(e.work!, task, o, () => 'X')).toBe('Due by X')
    expect(entryNote(e.due!, task, o, () => 'X')).toBe('Planned for X')
    expect(entryNote(feed(object(day(15)))['work']!, task, object(day(15)), () => 'X')).toBe('No deadline')
    expect(entryNote(feed(object(undefined, day(15)))['due']!, task, object(undefined, day(15)), () => 'X')).toBe('No work date planned')
  })
  it('warns when the plan is after the deadline', () => {
    expect(plannedAfterDeadline(object(day(20), day(15)), task, 'America/Toronto')).toBe(true)
    expect(plannedAfterDeadline(object(day(15), day(15)), task, 'America/Toronto')).toBe(false)
    expect(plannedAfterDeadline(object(day(20)), task, 'America/Toronto')).toBe(false)
  })
})

function instantAt(day: string, minutes: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date, Math.floor(minutes / 60), minutes % 60).toISOString()
}

const ts = '2026-01-01T00:00:00.000Z'

const taskType: ObjectType = {
  id: 'type-task',
  spaceId: 'space-1',
  name: 'Task',
  pluralName: 'Tasks',
  system: 'task',
  color: 'emerald',
  properties: [
    {
      id: 'status',
      kind: 'select',
      name: 'Status',
      multiple: false,
      options: [
        { id: 'todo', label: 'To do', status: 'todo' },
        { id: 'done', label: 'Done', status: 'done' },
      ],
    },
    { id: 'due', kind: 'date', name: 'Due', withTime: true },
    {
      id: 'priority',
      kind: 'select',
      name: 'Priority',
      multiple: false,
      options: [
        { id: 'high', label: 'High', color: 'red' },
        { id: 'medium', label: 'Medium', color: 'amber' },
        { id: 'low', label: 'Low', color: 'sky' },
      ],
    },
  ],
  views: [],
  createdAt: ts,
  updatedAt: ts,
}

const bugType: ObjectType = {
  id: 'type-bug',
  spaceId: 'space-1',
  name: 'Bug',
  pluralName: 'Bugs',
  color: 'red',
  properties: [
    {
      id: 'state',
      kind: 'select',
      name: 'State',
      multiple: false,
      options: [
        { id: 'open', label: 'Open', status: 'todo' },
        { id: 'fixed', label: 'Fixed', status: 'done' },
      ],
    },
    { id: 'target-date', kind: 'date', name: 'Target date', withTime: true },
  ],
  views: [],
  createdAt: ts,
  updatedAt: ts,
}

const videoType: ObjectType = {
  id: 'type-video',
  spaceId: 'space-1',
  name: 'Video',
  pluralName: 'Videos',
  color: 'violet',
  properties: [{ id: 'publish', kind: 'date', name: 'Publish date', withTime: true }],
  views: [],
  createdAt: ts,
  updatedAt: ts,
}

const noteType: ObjectType = {
  id: 'type-note',
  spaceId: 'space-1',
  name: 'Page',
  pluralName: 'Pages',
  system: 'page',
  properties: [],
  views: [],
  createdAt: ts,
  updatedAt: ts,
}

const dailyNoteType: ObjectType = {
  id: 'type-daily',
  spaceId: 'space-1',
  name: 'Daily note',
  pluralName: 'Daily notes',
  system: 'daily-note',
  properties: [{ id: 'd', kind: 'date', name: 'Date' }],
  views: [],
  createdAt: ts,
  updatedAt: ts,
}

const typesById = new Map<Id, ObjectType>([
  [taskType.id, taskType],
  [bugType.id, bugType],
  [videoType.id, videoType],
  [noteType.id, noteType],
])

function makeObj(
  id: string,
  typeId: string,
  opts: { title?: string; date?: DateValue; dateField?: string; status?: string; statusField?: string; priority?: string; updatedAt?: string } = {}
): ObjectSummary {
  const props: ObjectSummary['props'] = {}
  if (opts.date) props[opts.dateField ?? 'due'] = { kind: 'date', value: opts.date }
  if (opts.status) props[opts.statusField ?? 'status'] = { kind: 'select', value: [opts.status] }
  if (opts.priority) props.priority = { kind: 'select', value: [opts.priority] }
  return {
    id,
    spaceId: 'space-1',
    typeId,
    title: opts.title ?? id,
    aliases: [],
    tagIds: [],
    collectionIds: [],
    props,
    preview: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: opts.updatedAt ?? '2026-11-20T00:00:00.000Z',
  }
}

describe('calendar-tasks helpers', () => {
  it('lists schedulable types with Task first and excludes pages and daily notes', () => {
    const result = schedulableTypes([videoType, noteType, dailyNoteType, bugType, taskType])
    expect(result.map((t) => t.id)).toEqual(['type-task', 'type-bug', 'type-video'])
  })

  it('detects completable types including custom types with non-default status ids', () => {
    expect(canComplete(taskType)).toBe(true)
    expect(canComplete(bugType)).toBe(true)
    expect(canComplete(videoType)).toBe(false)
    expect(primaryDateProperty(bugType)?.id).toBe('target-date')
    expect(isObjectDone(makeObj('b1', bugType.id, { status: 'fixed', statusField: 'state' }), bugType)).toBe(true)
    expect(isObjectDone(makeObj('b2', bugType.id, { status: 'open', statusField: 'state' }), bugType)).toBe(false)
  })

  it('classifies overdue, day-only, undated and timed items differently for week vs month views', () => {
    const today = '2026-11-23'
    const items = [
      makeObj('overdue', taskType.id, { date: { start: '2026-11-20T00:00:00.000Z', resolution: 'day' }, status: 'todo' }),
      makeObj('done-old', taskType.id, { date: { start: '2026-11-19T00:00:00.000Z', resolution: 'day' }, status: 'done' }),
      makeObj('day-today', taskType.id, { date: { start: '2026-11-23T00:00:00.000Z', resolution: 'day' }, status: 'todo' }),
      makeObj('undated-low', taskType.id, { priority: 'low', status: 'todo', updatedAt: '2026-11-22T00:00:00.000Z' }),
      makeObj('undated-high', taskType.id, { priority: 'high', status: 'todo', updatedAt: '2026-11-21T00:00:00.000Z' }),
      makeObj('timed', taskType.id, { date: { start: instantAt('2026-11-24', 600), end: instantAt('2026-11-24', 660), resolution: 'time' }, status: 'todo' }),
      makeObj('video-undated', videoType.id, { updatedAt: '2026-11-23T00:00:00.000Z' }),
    ]

    const week = classifyScheduleItems(items, typesById, { today, view: 'week', showDone: false })
    expect(week.overdue.map((o) => o.id)).toEqual(['overdue'])
    // Day-only items come first in Unscheduled on week view, followed by undated sorted by priority.
    expect(week.unscheduled.map((o) => o.id)).toEqual(['day-today', 'undated-high', 'undated-low', 'video-undated'])
    expect(week.scheduled.map((o) => o.id)).toEqual(['timed'])

    const month = classifyScheduleItems(items, typesById, { today, view: 'month', showDone: false })
    expect(month.overdue.map((o) => o.id)).toEqual(['overdue'])
    expect(month.unscheduled.map((o) => o.id)).toEqual(['undated-high', 'undated-low', 'video-undated'])
    expect(month.scheduled.map((o) => o.id)).toEqual(['day-today', 'timed'])

    const withDone = classifyScheduleItems(items, typesById, { today, view: 'week', showDone: true })
    // Completed past items are not flagged overdue.
    expect(withDone.overdue.map((o) => o.id)).toEqual(['overdue'])
    expect(withDone.unscheduled.map((o) => o.id)).toContain('done-old')
  })

  it('builds 1-hour timed blocks on hour drop, preserves existing duration, and writes day resolution on all-day/month drop', () => {
    const timed = scheduledDateForDrop(undefined, { day: '2026-11-24', minutes: 600 })
    expect(timed.resolution).toBe('time')
    expect(timed.start).toBe(instantAt('2026-11-24', 600))
    expect(Date.parse(timed.end!) - Date.parse(timed.start)).toBe(DEFAULT_SCHEDULE_MINUTES * 60_000)

    const existing90: DateValue = {
      start: instantAt('2026-11-24', 600),
      end: instantAt('2026-11-24', 690),
      resolution: 'time',
    }
    const movedTimed = scheduledDateForDrop(existing90, { day: '2026-11-25', minutes: 660 })
    expect(movedTimed.start).toBe(instantAt('2026-11-25', 660))
    expect(Date.parse(movedTimed.end!) - Date.parse(movedTimed.start)).toBe(90 * 60_000)

    const allDay = scheduledDateForDrop(existing90, { day: '2026-11-25', allDay: true })
    expect(allDay).toEqual({ start: '2026-11-25T00:00:00.000Z', resolution: 'day' })

    const monthMovedTimed = scheduledDateForDrop(existing90, { day: '2026-11-26' })
    expect(monthMovedTimed.resolution).toBe('time')
    expect(monthMovedTimed.start).toBe(instantAt('2026-11-26', 600))
  })

  it('promotes all-day entries to timed blocks and converts timed entries to all-day via movedEntryTimes', () => {
    const allDayEntry = {
      key: 'k1',
      kind: 'property' as const,
      objectId: 't1',
      field: 'due',
      start: '2026-11-23T00:00:00.000Z',
      startDay: '2026-11-23',
      endDay: '2026-11-23',
      allDay: true,
    }
    const promoted = movedEntryTimes(allDayEntry, { day: '2026-11-24', minutes: 540 })
    expect(promoted.resolution).toBe('time')
    expect(promoted.start).toBe(instantAt('2026-11-24', 540))
    expect(Date.parse(promoted.end!) - Date.parse(promoted.start)).toBe(60 * 60_000)

    const timedEntry = {
      key: 'k2',
      kind: 'property' as const,
      objectId: 't2',
      field: 'due',
      start: instantAt('2026-11-24', 540),
      end: instantAt('2026-11-24', 600),
      startDay: '2026-11-24',
      endDay: '2026-11-24',
      allDay: false,
    }
    const demoted = movedEntryTimes(timedEntry, { day: '2026-11-25', allDay: true })
    expect(demoted).toEqual({ start: '2026-11-25T00:00:00.000Z', resolution: 'day' })
  })
})
