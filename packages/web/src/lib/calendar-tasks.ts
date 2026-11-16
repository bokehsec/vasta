// Tasks on the calendar: a planned work day and a deadline are separate entries, never evidence
// of completion. The Day page combines the same slot, keeping distinct times/occurrences intact.
import type { CalendarEntry, DateValue, Id, ObjectSummary, ObjectType } from '@vasta/core'
import { closingOf, plannedDateFieldOf } from '@vasta/core'

export type TaskDateRole = 'planned' | 'due'

export function taskDateRole(type: ObjectType | undefined, field: string | undefined): TaskDateRole | undefined {
  if (type?.system !== 'task') return undefined
  if (field === 'due') return 'due'
  return field && field === plannedDateFieldOf(type)?.id ? 'planned' : undefined
}

export function taskDate(object: Pick<ObjectSummary, 'props'> | undefined, field: string | undefined): DateValue | undefined {
  const value = field && object?.props[field]
  return value && value.kind === 'date' ? value.value : undefined
}

/** A repeating deadline is completed only at its current due occurrence, not from a stale plan. */
export function taskEntryCheckable(entry: CalendarEntry, type: ObjectType | undefined, object: Pick<ObjectSummary, 'props'> | undefined): boolean {
  const role = taskDateRole(type, entry.field)
  if (!role || (entry.recurring && !entry.current)) return false
  return role === 'due' || (!entry.recurring && !taskDate(object, 'due')?.rrule)
}

export interface DayTaskEntry { entry: CalendarEntry; role: TaskDateRole }
export interface DayTaskGroups {
  scheduled: CalendarEntry[]
  planned: DayTaskEntry[]
  due: DayTaskEntry[]
  completed: DayTaskEntry[]
  dropped: DayTaskEntry[]
}

export function dayTaskGroups(
  entries: CalendarEntry[],
  object: (id: Id) => ObjectSummary | undefined,
  types: Map<Id, ObjectType>,
  retained: (entry: CalendarEntry) => boolean
): DayTaskGroups {
  const groups: DayTaskGroups = { scheduled: [], planned: [], due: [], completed: [], dropped: [] }
  const rows: DayTaskEntry[] = []
  const combined = new Set<DayTaskEntry>()
  for (const entry of entries) {
    const summary = entry.objectId ? object(entry.objectId) : undefined
    const role = taskDateRole(types.get(summary?.typeId ?? ''), entry.field)
    if (!role) { groups.scheduled.push(entry); continue }
    // Only combine one plan and one due entry in the exact same slot; never collapse two repeats.
    const other = rows.find((row) => !combined.has(row) && row.entry.objectId === entry.objectId && row.role !== role && row.entry.start === entry.start && row.entry.end === entry.end && row.entry.allDay === entry.allDay)
    if (other) {
      // Keep the due occurrence when it repeats: it owns the safe completion control.
      if (role === 'due' && (entry.recurring || other.entry.recurring)) other.entry = entry
      else if (role === 'planned' && !entry.recurring && !other.entry.recurring) other.entry = entry
      other.role = 'planned'
      combined.add(other)
    } else rows.push({ entry, role })
  }
  for (const row of rows) {
    const summary = row.entry.objectId ? object(row.entry.objectId) : undefined
    // Done and dropped task entries have their own groups; a dropped task is not completed work.
    const closing = summary ? closingOf(types.get(summary.typeId), summary) : undefined
    const group = closing === 'done' ? 'completed' : closing ?? (retained(row.entry) ? 'completed' : row.role)
    groups[group].push(row)
  }
  return groups
}
