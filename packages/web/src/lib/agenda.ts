// The agenda layout (components/AgendaView.vue): which calendar entries it shows and how they fall
// on the days. Pure, so it is tested without a browser; the component adds the data and the look.
import type { AgendaSettings, CalendarEntry, FilterGroup, Id, ObjectSummary, QueryContext } from '@vasta/core'
import { addDays, matchesFilter } from '@vasta/core'

export const DEFAULT_AGENDA_DAYS = 3
export const MAX_AGENDA_DAYS = 14

/** How many days the agenda covers: the setting, a whole number from 1 to 14; 3 when unset. */
export function agendaLength(settings: AgendaSettings | undefined): number {
  const days = Math.floor(settings?.days ?? DEFAULT_AGENDA_DAYS)
  return Number.isFinite(days) ? Math.min(MAX_AGENDA_DAYS, Math.max(1, days)) : DEFAULT_AGENDA_DAYS
}

/** Today and the days after it, as "YYYY-MM-DD". */
export const agendaDays = (today: string, settings: AgendaSettings | undefined): string[] =>
  Array.from({ length: agendaLength(settings) }, (_, i) => addDays(today, i))

/** The settings as they are saved: a value left at its default is not kept; none left, none saved. */
export function tidyAgenda(settings: AgendaSettings): AgendaSettings | undefined {
  const { field, days, calendars } = settings
  const next: AgendaSettings = {
    ...(field ? { field } : {}),
    ...(days !== undefined && days !== DEFAULT_AGENDA_DAYS ? { days: agendaLength({ days }) } : {}),
    // A chosen list stays even when empty: the choice is open, with nothing ticked yet.
    ...(calendars === true || Array.isArray(calendars) ? { calendars } : {}),
  }
  return Object.keys(next).length ? next : undefined
}

export interface AgendaSelection {
  settings: AgendaSettings | undefined
  /** The query's or view's types; empty = all. */
  typeIds: Id[]
  filter: FilterGroup | undefined
  /** An object's summary, for the filter. */
  object: (id: Id) => ObjectSummary | undefined
  context: QueryContext
}

/**
 * The entries the agenda shows: dated objects that match the query's types and filter (and the
 * chosen date field), and the events of the calendars it asks for. The calendar feed holds
 * everything dated, so the query's own (limited) result list is not what decides.
 */
export function selectEntries(entries: CalendarEntry[], { settings, typeIds, filter, object, context }: AgendaSelection): CalendarEntry[] {
  const calendars = settings?.calendars
  return entries.filter((entry) => {
    if (entry.kind === 'daily-note') return false
    if (entry.kind === 'external') return calendars === true || (Array.isArray(calendars) && !!entry.sourceId && calendars.includes(entry.sourceId))
    if (settings?.field && entry.field !== settings.field) return false
    const summary = entry.objectId ? object(entry.objectId) : undefined
    return !!summary && (!typeIds.length || typeIds.includes(summary.typeId)) && matchesFilter(summary, filter, context)
  })
}

export interface AgendaDay {
  day: string
  /** All-day entries, in the calendar's order. */
  allDay: CalendarEntry[]
  /** Timed entries by start. */
  timed: CalendarEntry[]
}

/** The entries on each day: one that spans days is on each of them within the range. */
export function placeEntries(entries: CalendarEntry[], days: string[]): AgendaDay[] {
  const placed = days.map<AgendaDay>((day) => ({ day, allDay: [], timed: [] }))
  for (const entry of entries) {
    for (const one of placed) {
      if (entry.startDay > one.day || entry.endDay < one.day) continue
      ;(entry.allDay ? one.allDay : one.timed).push(entry)
    }
  }
  for (const one of placed) one.timed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.key.localeCompare(b.key))
  return placed
}

/**
 * A day's all-day entries as the agenda shows them: events (no object behind them) as chips, objects
 * (a task due that day…) as rows, which keep their checkbox.
 */
export function splitAllDay(allDay: CalendarEntry[]): { chips: CalendarEntry[]; rows: CalendarEntry[] } {
  return { chips: allDay.filter((entry) => !entry.objectId), rows: allDay.filter((entry) => !!entry.objectId) }
}

/** Over: it ended (or, with no end, began) before `now`. */
export const isPast = (entry: CalendarEntry, now: number): boolean => Date.parse(entry.end ?? entry.start) < now

/** Where the "now" line goes among a day's timed entries: before the first that begins after `now`. */
export const nowIndex = (timed: CalendarEntry[], now: number): number => {
  const index = timed.findIndex((entry) => Date.parse(entry.start) > now)
  return index < 0 ? timed.length : index
}
