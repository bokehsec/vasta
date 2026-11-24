// Task workflows use status to distinguish incoming work from commitments. Review recency and
// a next-step edit never hide an unresolved incoming task. Saved views are independent of this.
// A Review of tasks always starts with every new task in the space, then the check-ins of the
// place it was started from (a view, or the whole space). A snoozed task is in neither until its day.
import { REVIEWED_PROPERTY_ID, SNOOZED_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, ObjectRecord, ObjectType, QuickActionDef, SelectOption } from './model.ts'
import { deferActionOf, quickActionsOf } from './task-actions.ts'
import { taskDatesOf } from './task-dates.ts'
import { needsTriage, triageOptionsOf } from './task-status.ts'
import { isCheckInDue, isSnoozed, snoozeAction, snoozeFieldOf } from './task-review.ts'
import { statusProperty } from './metrics.ts'
import { daysBetween, dayOfDate } from './time.ts'

/** Sister queues within the supplied tasks: incoming work, then commitments due for review. */
export function taskWorkflowQueues<T extends Pick<ObjectRecord, 'props'>>(type: ObjectType | undefined, objects: readonly T[], today: string): { triage: T[]; review: T[] } {
  const triage: T[] = []
  const review: T[] = []
  if (type?.system !== 'task') return { triage, review }
  for (const object of objects) {
    if (needsTriage(type, object)) {
      if (!isSnoozed(type, object, today)) triage.push(object)
    }
    else if (isCheckInDue(type, object, today)) review.push(object)
  }
  return { triage, review }
}

/**
 * What a Review of tasks goes through: the new tasks of the whole space (`space`, oldest first),
 * then the check-ins due among `place`'s tasks, in its order (the view it started from; the space
 * itself for a sweep of all). Counts are these lists' lengths.
 */
export function reviewQueues<T extends Pick<ObjectRecord, 'props' | 'createdAt' | 'id'>>(type: ObjectType | undefined, space: readonly T[], place: readonly T[], today: string): { incoming: T[]; checkIns: T[] } {
  const oldestFirst = [...space].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return { incoming: taskWorkflowQueues(type, oldestFirst, today).triage, checkIns: taskWorkflowQueues(type, place, today).review }
}

/** A decision explicitly places/closes the task. Dates or notes alone leave triage unfinished. */
export function settlesTriage(type: ObjectType, action: QuickActionDef): boolean {
  const status = statusProperty(type)
  if (!status) return false
  const change = action.changes.findLast((c) => c.field === status.id)
  if (change?.value.kind !== 'value' || change.value.value.kind !== 'select') return false
  const object = { props: { [status.id]: change.value.value } }
  return !needsTriage(type, object)
}

/** One of a review's choices: a status a task can be placed in, and the action that places it. */
export interface ReviewChoice {
  option: SelectOption
  action: QuickActionDef
}

/**
 * The statuses a review offers as buttons: each one that is not incoming, the open ones first and
 * those that close the task last, in the status's own order. A status reuses an action already set
 * up to place a task there and nothing else (Defer's date question, Mark done), so choosing
 * Scheduled still asks for its date; any other status gets a plain one. The action is named after
 * the status, which is what the review's totals count. None for a type without the built-in status.
 */
export function reviewChoices(type: ObjectType | undefined): ReviewChoice[] {
  if (type?.system !== 'task') return []
  const status = statusProperty(type)
  if (!status || status.id !== STATUS_PROPERTY_ID) return []
  const incoming = new Set(triageOptionsOf(type).map((o) => o.id))
  const actions = quickActionsOf(type)
  const places = (action: QuickActionDef, option: SelectOption) => {
    const change = action.changes.findLast((c) => c.field === status.id)
    const sets = change?.value.kind === 'value' && change.value.value.kind === 'select' && change.value.value.value.length === 1 && change.value.value.value[0] === option.id
    return sets && action.changes.every((c) => c.field === status.id || c.value.kind === 'ask')
  }
  const options = status.options.filter((o) => !incoming.has(o.id))
  return [...options.filter((o) => o.status !== 'done'), ...options.filter((o) => o.status === 'done')].map((option) => {
    const action = actions.find((a) => places(a, option)) ?? {
      id: `status:${option.id}`,
      name: option.label,
      icon: { kind: 'icon', value: statusIcon(option, options) },
      changes: [{ field: status.id, value: { kind: 'value', value: { kind: 'select', value: [option.id] } } }],
    }
    return { option, action: { ...action, name: option.label } }
  })
}

/** An icon for a status without an action of its own: done, dropped, waiting, scheduled, on hold, or onward. */
function statusIcon(option: SelectOption, options: readonly SelectOption[]): string {
  if (option.status === 'done') return options.find((o) => o.status === 'done') === option ? 'ph:check-circle' : 'ph:x-circle'
  const label = option.label.trim().toLowerCase()
  if (WAITING_LABEL.test(label)) return 'ph:hourglass-medium'
  if (/sched|later|defer/.test(label)) return 'ph:calendar-blank'
  if (/hold|someday|paus/.test(label)) return 'ph:pause-circle'
  return 'ph:arrow-right'
}

/** A choice in Schedule's question beside the days: it places the task without one. */
export interface ReviewAlternative {
  id: 'no-date' | 'someday'
  label: string
  hint: string
  icon: string
  /** Puts the task in a status and clears its plan date. */
  action: QuickActionDef
}

/** A button of a review: where the task goes, as a main button or as a link under them. */
export interface ReviewButton {
  role: 'today' | 'defer' | 'wait' | 'done' | 'drop' | 'snooze' | 'move'
  label: string
  action: QuickActionDef
  option?: SelectOption
  /** Schedule only: the choices its question offers under the calendar (No date, Someday). */
  alternatives?: ReviewAlternative[]
}

/** A status for work waiting on someone else: "Waiting", "Delegated". */
export const WAITING_LABEL = /wait|delegat/i
/** A date for when to look at waiting work again: "Check back", "Follow-up". */
const CHECK_BACK_LABEL = /check\s*-?\s*back|follow\s*-?\s*up/i

/** The type's Check back date (a date that is not the plan date, deadline, Last reviewed or Snoozed until, named like it), if it has one. */
export function checkBackFieldOf(type: ObjectType | undefined): DatePropertyDef | undefined {
  if (type?.system !== 'task') return undefined
  const { plan, deadline } = taskDatesOf(type)
  const taken = [plan?.id, deadline?.id, REVIEWED_PROPERTY_ID, SNOOZED_PROPERTY_ID]
  return type.properties.find((p): p is DatePropertyDef => p.kind === 'date' && !taken.includes(p.id) && CHECK_BACK_LABEL.test(p.name))
}

/**
 * Waiting…, once its day is chosen: the button's action (the status Waiting) that also sets Check back
 * (where the type has one) and Snoozed until to `day`, so the task is out of Review until then, and
 * moves the Do date there when it is earlier (putting a task off moves its Do date, never Due; none
 * stays none). `object` is the task, `today` the user's day. The changes are days from today.
 */
export function waitingAction(type: ObjectType | undefined, base: QuickActionDef, object: Pick<ObjectRecord, 'props'>, day: string, today: string, timeZone = 'UTC'): QuickActionDef {
  const fields = [checkBackFieldOf(type), snoozeFieldOf(type)].flatMap((d) => d ?? [])
  const plan = taskDatesOf(type).plan
  const planned = plan ? object.props[plan.id] : undefined
  if (plan && planned?.kind === 'date' && dayOfDate(planned.value, timeZone) < day) fields.push(plan)
  const days = daysBetween(today, day)
  const own = new Set(fields.map((d) => d.id))
  return { ...base, changes: [...base.changes.filter((c) => !own.has(c.field)), ...fields.map((d) => ({ field: d.id, value: { kind: 'day' as const, days } }))] }
}

/** A status meant for work that has its day: "Scheduled", "Later", "Deferred". */
const SCHEDULED_LABEL = /sched|later|defer/i
/** A status for work parked for now: "On Hold", "Someday", "Paused". */
const PARKED_LABEL = /hold|someday|paus/i

/**
 * A review's buttons for a task with status `current` (`planned`: it has a plan date): few, and
 * never the status it already has (a task already placed has Keep for that). Main: Today (the plan
 * date set to today, in one press; a new task also gets the first open status that is not the
 * scheduled one, "Next"), Schedule… (the type's own Defer, asking its day and setting what it sets,
 * such as a "Scheduled" status: the same Defer as a row's or a task page's), Done, Drop and Snooze.
 * A new task given a day has its place: a Schedule that leaves the status alone puts it in the
 * status named for it ("Scheduled"; else the first open one), so it settles it and the review goes
 * on. Schedule's question also offers No date (that first open status, "Ready whenever") and
 * Someday (the "On Hold" kind of status, "Park it"), each clearing the plan date; left out when the
 * task already is there with no plan date. The other open statuses and any further closing ones
 * are links (`more`). `covered`: the quick actions these stand for. Actions are named for the
 * review's notice and totals: "Moved to Waiting", "Done", "Schedule", "Today", "Snoozed".
 * Waiting… follows Schedule where the type has a waiting status (the first open one named like
 * "Waiting" or "Delegated"): even on a task already waiting (still waiting, another week); its
 * action only sets the status, and waitingAction adds the day once it is asked for. It stands for
 * that status, which is no link then.
 */
export function reviewButtons(type: ObjectType | undefined, current: string | undefined, isNew: boolean, planned = false): { main: ReviewButton[]; more: ReviewButton[]; covered: string[] } {
  const choices = reviewChoices(type)
  const status = statusProperty(type)
  if (!type || !status || !choices.length) return { main: [], more: [], covered: [] }
  const named = (action: QuickActionDef, option: SelectOption | undefined, id = action.id): QuickActionDef => ({ ...action, id, name: !option ? action.name : option.status === 'done' ? option.label : `Moved to ${option.label}` })
  const button = (role: ReviewButton['role'], choice: ReviewChoice, label = choice.option.label): ReviewButton => ({ role, label, option: choice.option, action: named(choice.action, choice.option) })
  const places = (option: SelectOption): QuickActionDef['changes'][number] => ({ field: status.id, value: { kind: 'value', value: { kind: 'select', value: [option.id] } } })
  const open = choices.filter((c) => c.option.status !== 'done')
  const closing = choices.filter((c) => c.option.status === 'done')
  const actions = quickActionsOf(type)
  const covered = choices.map((c) => c.action.id)

  // Schedule…: the type's own Defer, and the open status it puts a task in (if it does), which is no link then.
  const own = deferActionOf(type)
  const sets = own?.changes.findLast((c) => c.field === status.id)
  const placedId = sets?.value.kind === 'value' && sets.value.value.kind === 'select' ? sets.value.value.value[0] : undefined
  const scheduledStatus = own ? open.find((c) => SCHEDULED_LABEL.test(c.option.label)) : undefined
  // A new task, and a Defer that only sets the day: the review adds the status for scheduled work.
  const scheduled = isNew && own && !sets ? scheduledStatus : undefined
  const placed = (placedId ? open.find((c) => c.option.id === placedId) : undefined) ?? scheduled
  const added = scheduled ?? (isNew && own && !sets ? open[0] : undefined)
  // Named Schedule here (the question's title, the notice, the totals), whatever the type calls its Defer.
  const defer = own && { ...own, name: 'Schedule', changes: added ? [...own.changes, places(added.option)] : own.changes }
  if (own) covered.push(own.id)

  // No date: the first open status that is not the scheduled one (where Today puts a new task too).
  const first = open.find((c) => c !== placed && c !== scheduledStatus)
  const parked = open.find((c) => c !== placed && c !== first && PARKED_LABEL.test(c.option.label))
  const plan = taskDatesOf(type).plan
  const without = (choice: ReviewChoice | undefined, id: ReviewAlternative['id'], label: string, hint: string, icon: string): ReviewAlternative[] => {
    if (!plan || !choice || (choice.option.id === current && !planned)) return []
    const action = named(choice.action, choice.option, id)
    return [{ id, label, hint, icon, action: { ...action, changes: [places(choice.option), { field: plan.id, value: { kind: 'clear' } }] } }]
  }
  const alternatives = [...without(first, 'no-date', 'No date', 'Ready whenever', 'ph:calendar-x'), ...without(parked, 'someday', 'Someday', 'Park it', 'ph:pause-circle')]

  // Today: the plan date, today; a new task also gets the first open status.
  const placesNew = isNew ? first : undefined
  const today: QuickActionDef | undefined = plan && { id: 'today', name: 'Today', icon: { kind: 'icon', value: 'ph:calendar-check' }, changes: [{ field: plan.id, value: { kind: 'day', days: 0 } }, ...(placesNew ? [places(placesNew.option)] : [])] }
  const snooze = snoozeAction(type)
  if (snooze) covered.push(snooze.id)
  const waiting = open.find((c) => WAITING_LABEL.test(c.option.label))
  const [done, drop, ...otherClosing] = closing
  const main: ReviewButton[] = [
    ...(today ? [{ role: 'today' as const, label: 'Today', action: today }] : []),
    ...(defer ? [{ role: 'defer' as const, label: 'Schedule', ...(placed ? { option: placed.option } : {}), ...(alternatives.length ? { alternatives } : {}), action: defer }] : []),
    ...(waiting ? [button('wait', waiting)] : []),
    ...(done ? [button('done', done)] : []),
    ...(drop ? [button('drop', drop, actions.find((a) => a.id === 'drop' && a.id === drop.action.id)?.name ?? drop.option.label)] : []),
    ...(snooze ? [{ role: 'snooze' as const, label: 'Snooze', action: snooze }] : []),
  ]
  const more = [
    ...open.filter((c) => c !== first && c !== parked && c !== placed && c !== scheduledStatus && c !== waiting && c.option.id !== current).map((c) => button('move', c)),
    ...otherClosing.map((c) => button('move', c)),
  ]
  return { main, more, covered }
}
