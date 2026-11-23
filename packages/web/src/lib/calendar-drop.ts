// What dropping an entry on the calendar or an agenda does, one way for both (CalendarPage,
// AgendaView): the entry moves its own date, the one it stands for (an event's, a task's plan or
// deadline, any date property), and says so with Undo; a repeating date asks which occurrences
// (lib/calendar.ts changeEntryTimes). Dropping a task from the Tasks sidebar is separate
// (CalendarTasksPanel sets the type's first date). Overdue rows' "Move to today" moves the plan of a
// late task and keeps its deadline (moveToToday).
import type { CalendarEntry, DateValue, Id, IsoDateTime, PropertyValue } from '@vasta/core'
import { moveDateToDay, taskDatesOf } from '@vasta/core'
import { dayKey, setProperties } from './actions.ts'
import { api } from './api.ts'
import { changeEntryTimes, formatDayShort, formatWeekday, instantAt, movedTimes, viewerTimeZone } from './calendar.ts'
import type { DropTarget } from './calendar-drag.ts'
import { cachedSummary, lastError, notice, typesById } from './state.ts'

/** Runs a change of an entry's task (a view that keeps completed entries makes the kept one go with it). */
export type RunMove = <T>(entry: CalendarEntry, run: () => Promise<T>) => Promise<T>

const dayWords = (day: string) => (day === dayKey() ? 'today' : `${formatWeekday(day)}, ${formatDayShort(day)}`)

/** Says what moved, with Undo restoring it (none when `undo` is absent). */
function announce(message: string, undo?: () => Promise<unknown>) {
  const run = async () => {
    try {
      await undo!()
    } catch (error) {
      lastError.value = (error as Error).message
    }
  }
  notice.value = undo ? { message, action: { label: 'Undo', run } } : { message }
}

/**
 * One of a task's dates moved to a day, keeping its time of day (or at `minutes`, over the hour
 * grid), its length and the rest it holds; a date it does not have yet becomes an all-day one. A
 * repeating date moves one occurrence: `occurrence` (the one grabbed) or, without, the current one.
 * Returns the value it had, to put back; false when it already was there.
 */
async function moveTaskDate(objectId: Id, field: Id, target: Extract<DropTarget, { day: string }>, grabbed?: CalendarEntry): Promise<{ before: PropertyValue | undefined } | false> {
  const object = await api.object(objectId)
  const before = object.props[field]
  const timeZone = viewerTimeZone()
  let next: DateValue
  if (before?.kind !== 'date') next = { start: `${target.day}T00:00:00.000Z`, resolution: 'day' }
  else if (before.value.rrule) {
    const { changeOneOccurrence, moveOccurrenceTo } = await import('@vasta/core/calendar')
    if (grabbed?.occurrence) {
      const moved = moveDateToDay({ start: grabbed.start, ...(grabbed.end ? { end: grabbed.end } : {}), resolution: grabbed.allDay ? 'day' : 'time', ...(before.value.timeZone ? { timeZone: before.value.timeZone } : {}) }, target, timeZone)
      next = changeOneOccurrence(before.value, grabbed.occurrence as IsoDateTime, { start: moved.start, ...(moved.end ? { end: moved.end } : {}) })
    } else next = moveOccurrenceTo(before.value, target.day, timeZone)
  } else next = moveDateToDay(before.value, target, timeZone)
  if (before?.kind === 'date' && JSON.stringify(before.value) === JSON.stringify(next)) return false
  await setProperties(objectId, { [field]: { kind: 'date', value: next } })
  return { before }
}

/** Moves a date of the entry's task and says so; `field` is what moved ("plan" or "deadline"). */
async function moveAndSay(entry: CalendarEntry, field: Id, role: 'plan' | 'deadline', target: Extract<DropTarget, { day: string }>, run: RunMove): Promise<boolean> {
  const moved = await run(entry, () => moveTaskDate(entry.objectId!, field, target, entry.field === field ? entry : undefined))
  if (!moved) return false
  announce(`${role === 'plan' ? 'Planned for' : 'Deadline moved to'} ${dayWords(target.day)}`, () => run(entry, () => setProperties(entry.objectId!, { [field]: moved.before })))
  return true
}

/**
 * An entry dropped (or, `resize`, its end pulled) on the calendar or an agenda; true when it changed
 * (the view then reloads). Failures reach the error notice.
 */
export async function dropEntry(entry: CalendarEntry, mode: 'move' | 'resize', dropped: DropTarget, run: RunMove): Promise<boolean> {
  // Over the Tasks sidebar (`unschedule`) there is no day: the page clears the date itself.
  if (dropped.unschedule) return false
  const target = dropped
  try {
    if (mode === 'resize') return await changeIfNew(entry, { start: entry.start, end: instantAt(entry.startDay, target.minutes ?? 0) }, run)
    const times = movedTimes(entry, target)
    if (!(await changeIfNew(entry, times, run))) return false
    // A repeating date's change was asked for a scope (this, the following, all) that Undo cannot know, so that one only says it.
    const previous = { start: entry.start, ...(entry.end ? { end: entry.end } : {}) }
    announce(`Moved to ${formatWeekday(target.day)}, ${formatDayShort(target.day)}`, entry.recurring ? undefined : () => run(entry, () => changeEntryTimes(entry, previous)))
    return true
  } catch (error) {
    lastError.value = (error as Error).message
    return false
  }
}

async function changeIfNew(entry: CalendarEntry, times: { start: string; end?: string }, run: RunMove): Promise<boolean> {
  if (times.start === entry.start && (times.end ?? '') === (entry.end ?? '')) return false
  return await run(entry, () => changeEntryTimes(entry, times))
}

/** An overdue task's plan moved to today, its deadline kept (D4); true when it moved. */
export async function moveToToday(entry: CalendarEntry, run: RunMove = (_entry, go) => go()): Promise<boolean> {
  const plan = taskDatesOf(typesById.value.get(cachedSummary(entry.objectId ?? '')?.typeId ?? '')).plan
  if (!entry.objectId || !plan) return false
  try {
    return await moveAndSay(entry, plan.id, 'plan', { day: dayKey() }, run)
  } catch (error) {
    lastError.value = (error as Error).message
    return false
  }
}
