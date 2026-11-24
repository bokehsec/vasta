// Review dates, as in OmniFocus: a task's Last reviewed day (the built-in `reviewed` date) and how
// often it comes up in Review again (Type settings › Review, `review.every`: 7 days unless
// set; 0 every time). A review shows the open tasks due for one, never reviewed or last reviewed
// that many days ago or more, and Reviewed sets the day to today, so a task that is fine as it is
// needs nothing else; so does any change of its status, wherever it is made (reviewedByStatusChange,
// on every save). A review's other decisions (Keep, a next step) record it themselves. A type without the
// date reviews every open task every time, as before.
// Snooze hides a task from Review (new tasks and check-ins) until a day (the built-in `snoozed` date,
// `review.snooze` days from today, 1 unless set): nothing else changes, it is not marked reviewed,
// and any other decision made on it clears the day.
import { REVIEWED_PROPERTY_ID, SNOOZED_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, ObjectRecord, ObjectType, QuickActionDef } from './model.ts'
import { isClosedTask, needsTriage } from './task-status.ts'
import { daysBetween } from './time.ts'

export const DEFAULT_REVIEW_EVERY = 7
export const DEFAULT_SNOOZE_DAYS = 1
/** The id of the Snooze action, which Review runs as a decision of its own (it records one without placing a new task). */
export const SNOOZE_ACTION_ID = 'snooze'

/** The built-in filter field "Due for review" (query.ts): checked on a task in Review's check-ins (isCheckInDue). */
export const REVIEW_DUE_FIELD = 'reviewDue'

/** The type's Last reviewed date (tasks), unless it was deleted or changed kind. */
export function reviewFieldOf(type: ObjectType | undefined): DatePropertyDef | undefined {
  if (type?.system !== 'task') return undefined
  const def = type.properties.find((p) => p.id === REVIEWED_PROPERTY_ID)
  return def?.kind === 'date' ? def : undefined
}

/** Days between reviews of a task: the type's setting, else a week. */
export function reviewEveryOf(type: ObjectType | undefined): number {
  const every = type?.review?.every
  return typeof every === 'number' && Number.isInteger(every) && every >= 0 ? every : DEFAULT_REVIEW_EVERY
}

/** The type's Snoozed until date (tasks), unless it was deleted or changed kind. */
export function snoozeFieldOf(type: ObjectType | undefined): DatePropertyDef | undefined {
  if (type?.system !== 'task') return undefined
  const def = type.properties.find((p) => p.id === SNOOZED_PROPERTY_ID)
  return def?.kind === 'date' ? def : undefined
}

/** Days Snooze hides a task from Review: the type's setting (a whole number from 1), else a day. */
export function snoozeDaysOf(type: ObjectType | undefined): number {
  const days = type?.review?.snooze
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 ? days : DEFAULT_SNOOZE_DAYS
}

/** The day an object is snoozed until ("YYYY-MM-DD"), if it has one. */
export function snoozedUntil(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): string | undefined {
  const field = snoozeFieldOf(type)
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'date' ? value.value.start.slice(0, 10) : undefined
}

/** Whether Review leaves the object out on `today`: it is snoozed until a later day (on that day it is back). */
export function isSnoozed(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, today: string): boolean {
  const day = snoozedUntil(type, object)
  return !!day && day > today
}

/** Snooze: Snoozed until set `review.snooze` days from today, nothing else. None without the date. */
export function snoozeAction(type: ObjectType | undefined): QuickActionDef | undefined {
  const field = snoozeFieldOf(type)
  return field ? { id: SNOOZE_ACTION_ID, name: 'Snoozed', icon: { kind: 'icon', value: 'ph:moon' }, changes: [{ field: field.id, value: { kind: 'day', days: snoozeDaysOf(type) } }] } : undefined
}

/** The day an object was last reviewed ("YYYY-MM-DD"), if it has been. */
export function lastReviewedDay(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): string | undefined {
  const field = reviewFieldOf(type)
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'date' ? value.value.start.slice(0, 10) : undefined
}

/** Whether an object is due for review on `today`: never reviewed, or reviewed `review.every` days ago or more. */
export function dueForReview(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, today: string): boolean {
  if (!reviewFieldOf(type)) return true
  const every = reviewEveryOf(type)
  const last = lastReviewedDay(type, object)
  return !every || !last || daysBetween(last, today) >= every
}

/**
 * Whether a task is in Review's check-ins on `today`: open, not new (a new task is Review's first
 * queue, whatever its Last reviewed day), not snoozed and due for review. What the "Due for review" filter and
 * the queues of a Review both ask.
 */
export function isCheckInDue(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, today: string): boolean {
  return type?.system === 'task' && !isClosedTask(type, object) && !needsTriage(type, object) && !isSnoozed(type, object, today) && dueForReview(type, object, today)
}

/** Reviewed: today as the Last reviewed day, nothing else changed. None without the date. */
export function reviewedAction(type: ObjectType | undefined): QuickActionDef | undefined {
  const field = reviewFieldOf(type)
  return field ? { id: 'reviewed', name: 'Reviewed', icon: { kind: 'icon', value: 'ph:check' }, changes: [{ field: field.id, value: { kind: 'day', days: 0 } }] } : undefined
}

/**
 * A review's decision that leaves the task's status as it is (a next step, Schedule on a task already
 * where Schedule puts it) also marks it reviewed today, unless the action sets that date itself (Snooze never does). One
 * that changes the status needs nothing added: saving it marks the task reviewed (reviewedByStatusChange).
 */
export function withReviewed(type: ObjectType | undefined, action: QuickActionDef, object: Pick<ObjectRecord, 'props'>): QuickActionDef {
  const field = reviewFieldOf(type)
  const snooze = snoozeFieldOf(type)
  if (!field || action.changes.some((c) => c.field === field.id || c.field === snooze?.id)) return action
  const status = action.changes.find((c) => c.field === STATUS_PROPERTY_ID)
  const current = JSON.stringify(object.props[STATUS_PROPERTY_ID])
  if (status && (status.value.kind === 'clear' ? current !== undefined : status.value.kind === 'value' && JSON.stringify(status.value.value) !== current)) return action
  return { ...action, changes: [...action.changes, { field: field.id, value: { kind: 'day', days: 0 } }] }
}

/** A decision on a task that has a Snoozed until day also clears it, so no stale day stays (Undo puts it back); a Snooze sets its own. */
export function withSnoozeCleared(type: ObjectType | undefined, action: QuickActionDef, object: Pick<ObjectRecord, 'props'>): QuickActionDef {
  const field = snoozeFieldOf(type)
  if (!field || !object.props[field.id] || action.changes.some((c) => c.field === field.id)) return action
  return { ...action, changes: [...action.changes, { field: field.id, value: { kind: 'clear' } }] }
}

/**
 * A task whose status changes in this save counts as reviewed: its Last reviewed day becomes `today`
 * (the saving user's), unless the save sets that date itself. `stored` is the task being replaced;
 * nothing without one, without the date, or when the status is as it was.
 */
export function reviewedByStatusChange(object: ObjectRecord, stored: ObjectRecord | undefined, type: ObjectType | undefined, today: string): ObjectRecord {
  const field = reviewFieldOf(type)
  const same = (key: string) => JSON.stringify(object.props[key]) === JSON.stringify(stored?.props[key])
  if (!field || !stored || same(STATUS_PROPERTY_ID) || !same(field.id)) return object
  return { ...object, props: { ...object.props, [field.id]: { kind: 'date', value: { start: `${today}T00:00:00.000Z`, resolution: 'day' } } } }
}
