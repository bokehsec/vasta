// Tasks on the calendar: a task's plan (the day to work on it) and deadline are dates of its own,
// never evidence of completion. One task is one entry a day: its plan and deadline on the same day
// are merged (mergeTaskDates), and the badges, the warning and the note an entry shows come from
// here too, so the day, week, month, agenda and the small month agree.
import type { CalendarEntry, DateValue, Id, ObjectSummary, ObjectType } from '@vasta/core'
import { closingOf, dayOfDate, taskDatesOf } from '@vasta/core'

export type TaskDateRole = 'plan' | 'deadline'

export function taskDateRole(type: ObjectType | undefined, field: string | undefined): TaskDateRole | undefined {
  const { plan, deadline } = taskDatesOf(type)
  if (!field) return undefined
  return field === deadline?.id ? 'deadline' : field === plan?.id ? 'plan' : undefined
}

export function taskDate(object: Pick<ObjectSummary, 'props'> | undefined, field: string | undefined): DateValue | undefined {
  const value = field && object?.props[field]
  return value && value.kind === 'date' ? value.value : undefined
}

/** A repeating deadline is completed only at its current occurrence, not from a stale plan. */
export function taskEntryCheckable(entry: CalendarEntry, type: ObjectType | undefined, object: Pick<ObjectSummary, 'props'> | undefined): boolean {
  const role = taskDateRole(type, entry.field)
  if (!role || (entry.recurring && !entry.current)) return false
  return role === 'deadline' || (!entry.recurring && !taskDate(object, taskDatesOf(type).deadline?.id)?.rrule)
}

/** Whether the plan is on a later day than the deadline: the work is planned for when it is already due. */
export function plannedAfterDeadline(object: Pick<ObjectSummary, 'props'> | undefined, type: ObjectType | undefined, timeZone: string): boolean {
  const { plan, deadline } = taskDatesOf(type)
  const planned = taskDate(object, plan?.id)
  const due = taskDate(object, deadline?.id)
  return !!planned && !!due && dayOfDate(planned, timeZone) > dayOfDate(due, timeZone)
}

type Lookup = (id: Id) => ObjectSummary | undefined

/**
 * A task's plan and deadline that fall on the same day, in any slot, as one entry carrying both
 * (`alsoField`: the other date). Only one plan and one deadline of a day are paired, and only
 * single-day ones, so a repeating task's occurrences and a span are never collapsed. The entry kept
 * is the deadline's (it owns a repeating task's checkbox) unless only the plan has a time.
 * Late entries (overdue) stand for the task, not a day, and are left alone.
 */
export function mergeTaskDates(entries: CalendarEntry[], object: Lookup, types: Map<Id, ObjectType>): CalendarEntry[] {
  const roleOf = (entry: CalendarEntry) => (entry.objectId && !entry.overdue && entry.startDay === entry.endDay ? taskDateRole(types.get(object(entry.objectId)?.typeId ?? ''), entry.field) : undefined)
  const taken = new Set<CalendarEntry>()
  const gone = new Set<CalendarEntry>()
  const kept = new Map<CalendarEntry, CalendarEntry>()
  for (const plan of entries) {
    if (roleOf(plan) !== 'plan' || taken.has(plan)) continue
    const deadline = entries.find((e) => !taken.has(e) && e.objectId === plan.objectId && e.startDay === plan.startDay && roleOf(e) === 'deadline')
    if (!deadline) continue
    taken.add(plan).add(deadline)
    const [keep, other] = deadline.allDay && !plan.allDay ? [plan, deadline] : [deadline, plan]
    kept.set(keep, { ...keep, alsoField: other.field! })
    gone.add(other)
  }
  return entries.flatMap((entry) => (gone.has(entry) ? [] : [kept.get(entry) ?? entry]))
}

export interface EntryBadge {
  label: string
  tone: 'plan' | 'deadline' | 'done' | 'late' | 'field'
}

const ROLE_LABEL: Record<TaskDateRole, string> = { plan: 'Planned', deadline: 'Due' }

/**
 * What an entry says it is: a task's Planned and Due (both when merged), Done or Dropped once it is
 * closed, "Due Tue" / "Planned Mon" when it is late (`lateDay` words a day), and the date's own name
 * for a date that has no role (Check back). A date of the object itself, an event, has none.
 */
export function entryBadges(entry: CalendarEntry, type: ObjectType | undefined, closing: 'done' | 'dropped' | undefined, lateDay: (day: string) => string): EntryBadge[] {
  const role = taskDateRole(type, entry.field)
  if (!role) {
    const name = entry.kind === 'property' && entry.field ? type?.properties.find((p) => p.id === entry.field)?.name : undefined
    return name ? [{ label: name, tone: 'field' }] : []
  }
  if (closing) return [{ label: closing === 'dropped' ? 'Dropped' : 'Done', tone: 'done' }]
  if (entry.overdue) return entry.overdue.map(({ field, day }) => ({ label: `${ROLE_LABEL[taskDateRole(type, field) ?? 'deadline']} ${lateDay(day)}`, tone: 'late' }))
  const roles = [...new Set([role, taskDateRole(type, entry.alsoField)])].filter((r): r is TaskDateRole => !!r).sort((a, b) => Number(b === 'plan') - Number(a === 'plan'))
  return roles.map((r) => ({ label: ROLE_LABEL[r], tone: r }))
}

/**
 * What an entry says about the task's other dates, in words: a plan names the deadline, a deadline
 * the plan, a late task the dates that are not late. Nothing for a merged entry (it shows both).
 */
export function entryNote(entry: CalendarEntry, type: ObjectType | undefined, object: Pick<ObjectSummary, 'props'> | undefined, say: (value: DateValue) => string): string {
  const { plan, deadline } = taskDatesOf(type)
  const planned = taskDate(object, plan?.id)
  const due = taskDate(object, deadline?.id)
  if (entry.overdue) {
    const late = new Set(entry.overdue.map((l) => l.field))
    return [planned && !late.has(plan!.id) ? `Planned for ${say(planned)}` : '', due && !late.has(deadline!.id) ? `Due by ${say(due)}` : ''].filter(Boolean).join(' · ')
  }
  if (entry.alsoField) return ''
  return taskDateRole(type, entry.field) === 'plan' ? (due ? `Due by ${say(due)}` : 'No deadline') : planned ? `Planned for ${say(planned)}` : 'No work date planned'
}

export interface DayTaskGroups {
  scheduled: CalendarEntry[]
  planned: CalendarEntry[]
  due: CalendarEntry[]
  completed: CalendarEntry[]
  dropped: CalendarEntry[]
}

/**
 * A day's entries as the Day view sorts them: what is scheduled, the tasks planned for it and the
 * ones due on it (a merged entry is planned), and the ones done or dropped. A task whose completion
 * the view kept counts as done.
 */
export function dayTaskGroups(
  entries: CalendarEntry[],
  object: Lookup,
  types: Map<Id, ObjectType>,
  retained: (entry: CalendarEntry) => boolean
): DayTaskGroups {
  const groups: DayTaskGroups = { scheduled: [], planned: [], due: [], completed: [], dropped: [] }
  for (const entry of entries) {
    const summary = entry.objectId ? object(entry.objectId) : undefined
    const type = types.get(summary?.typeId ?? '')
    const role = taskDateRole(type, entry.field)
    if (!role) {
      groups.scheduled.push(entry)
      continue
    }
    // Done and dropped task entries have their own groups; a dropped task is not completed work.
    const closing = summary ? closingOf(type, summary) : undefined
    const group = closing === 'done' ? 'completed' : closing ?? (retained(entry) ? 'completed' : entry.alsoField || role === 'plan' ? 'planned' : 'due')
    groups[group].push(entry)
  }
  return groups
}
