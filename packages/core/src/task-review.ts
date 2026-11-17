// Review dates, as in OmniFocus: a task's Last reviewed day (the built-in `reviewed` date) and how
// often it comes up in Review again (Type settings › Quick actions, `reviewEvery`: 7 days unless
// set; 0 every time). A review shows the open tasks due for one, never reviewed or last reviewed
// that many days ago or more, and Reviewed sets the day to today, so a task that is fine as it is
// needs nothing else; so does any change of its status, wherever it is made (reviewedByStatusChange,
// on every save). A review's other decisions (Keep, a next step) record it themselves. Hold puts a
// task aside without a date (a status such as "On hold"); it still comes up in its turn. A type
// without the date reviews every open task every time, as before.
import { REVIEWED_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, ObjectRecord, ObjectType, QuickActionDef, SelectOption } from './model.ts'
import { isClosedTask, needsTriage } from './task-status.ts'
import { daysBetween } from './time.ts'

export const DEFAULT_REVIEW_EVERY = 7

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
  const every = type?.quickActions?.reviewEvery
  return typeof every === 'number' && Number.isInteger(every) && every >= 0 ? every : DEFAULT_REVIEW_EVERY
}

/** The day an object was last reviewed ("YYYY-MM-DD"), if it has been. */
export function lastReviewedDay(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): string | undefined {
  const field = reviewFieldOf(type)
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'date' ? value.value.start.slice(0, 10) : undefined
}

/** Whether an object is due for review on `today`: never reviewed, or reviewed `reviewEvery` days ago or more. */
export function dueForReview(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, today: string): boolean {
  if (!reviewFieldOf(type)) return true
  const every = reviewEveryOf(type)
  const last = lastReviewedDay(type, object)
  return !every || !last || daysBetween(last, today) >= every
}

/**
 * Whether a task is in Review's check-ins on `today`: open, not new (a new task is Review's first
 * queue, whatever its Last reviewed day) and due for review. What the "Due for review" filter and
 * the queues of a Review both ask.
 */
export function isCheckInDue(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, today: string): boolean {
  return type?.system === 'task' && !isClosedTask(type, object) && !needsTriage(type, object) && dueForReview(type, object, today)
}

/** Reviewed: today as the Last reviewed day, nothing else changed. None without the date. */
export function reviewedAction(type: ObjectType | undefined): QuickActionDef | undefined {
  const field = reviewFieldOf(type)
  return field ? { id: 'reviewed', name: 'Reviewed', icon: { kind: 'icon', value: 'ph:check' }, changes: [{ field: field.id, value: { kind: 'day', days: 0 } }] } : undefined
}

/**
 * A review's decision that leaves the task's status as it is (a next step, Defer on a task already
 * where Defer puts it) also marks it reviewed today, unless the action sets that date itself. One
 * that changes the status needs nothing added: saving it marks the task reviewed (reviewedByStatusChange).
 */
export function withReviewed(type: ObjectType | undefined, action: QuickActionDef, object: Pick<ObjectRecord, 'props'>): QuickActionDef {
  const field = reviewFieldOf(type)
  if (!field || action.changes.some((c) => c.field === field.id)) return action
  const status = action.changes.find((c) => c.field === STATUS_PROPERTY_ID)
  const current = JSON.stringify(object.props[STATUS_PROPERTY_ID])
  if (status && (status.value.kind === 'clear' ? current !== undefined : status.value.kind === 'value' && JSON.stringify(status.value.value) !== current)) return action
  return { ...action, changes: [...action.changes, { field: field.id, value: { kind: 'day', days: 0 } }] }
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

/** The status option Hold sets: the type's setting, else one called "On hold"; never one meaning done. */
export function holdOptionOf(type: ObjectType | undefined): SelectOption | undefined {
  if (type?.system !== 'task') return undefined
  const def = type.properties.find((p) => p.id === STATUS_PROPERTY_ID)
  if (def?.kind !== 'select') return undefined
  const open = def.options.filter((o) => o.status !== 'done')
  const chosen = type.quickActions?.holdStatus
  return chosen ? open.find((o) => o.id === chosen) : open.find((o) => /^on[\s-]?hold$/i.test(o.label.trim()))
}

/** Hold (in a review's More): sets the hold status, named as the option is ("On Hold"). */
export function holdAction(type: ObjectType | undefined): QuickActionDef | undefined {
  const option = holdOptionOf(type)
  return option ? { id: 'hold', name: option.label, icon: { kind: 'icon', value: 'ph:pause-circle' }, changes: [{ field: STATUS_PROPERTY_ID, value: { kind: 'value', value: { kind: 'select', value: [option.id] } } }] } : undefined
}
