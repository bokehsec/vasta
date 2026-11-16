// Task workflows use status to distinguish incoming work from commitments. Review recency and
// a next-step edit never hide an unresolved incoming task. Saved views are independent of this.
import { STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { ObjectRecord, ObjectType, QuickActionDef, SelectOption } from './model.ts'
import { askOf, isClosedTask, quickActionsOf } from './task-actions.ts'
import { dueForReview, holdAction } from './task-review.ts'
import { statusProperty } from './metrics.ts'

export function triageOptionsOf(type: ObjectType | undefined): SelectOption[] {
  if (type?.system !== 'task') return []
  const options = statusProperty(type)?.options.filter((o) => o.status !== 'done') ?? []
  if (Array.isArray(type.quickActions?.triageStatuses)) return options.filter((o) => type.quickActions!.triageStatuses!.includes(o.id))
  const inbox = options.filter((o) => /^inbox$/i.test(o.label.trim()))
  return inbox.length ? inbox : options.filter((o) => /^to[\s-]?do$/i.test(o.label.trim()))
}

export function needsTriage(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): boolean {
  if (type?.system !== 'task' || isClosedTask(type, object)) return false
  const status = statusProperty(type)
  const value = status && object.props[status.id]
  const ids = value?.kind === 'select' ? value.value.filter((id) => status!.options.some((o) => o.id === id)) : []
  return !ids.length || triageOptionsOf(type).some((o) => ids.includes(o.id))
}

/** Global sister queues: all incoming tasks, or established commitments due for review. */
export function taskWorkflowQueues<T extends Pick<ObjectRecord, 'props'>>(type: ObjectType | undefined, objects: readonly T[], today: string): { triage: T[]; review: T[] } {
  const triage: T[] = []
  const review: T[] = []
  if (type?.system !== 'task') return { triage, review }
  for (const object of objects) {
    if (isClosedTask(type, object)) continue
    if (needsTriage(type, object)) triage.push(object)
    else if (dueForReview(type, object, today)) review.push(object)
  }
  return { triage, review }
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

/** Existing status choices, never invented states. Incoming statuses are not dispositions. */
export function triageDispositionActions(type: ObjectType): QuickActionDef[] {
  const incoming = new Set(triageOptionsOf(type).map((o) => o.id))
  const status = statusProperty(type)
  if (!status || status.id !== STATUS_PROPERTY_ID) return []
  const actions = quickActionsOf(type)
  return status.options.filter((o) => !incoming.has(o.id)).map((o) => {
    // A scheduled disposition uses the configured date question as well as its status. Choosing
    // Scheduled must not bypass the date/other changes already defined by Defer or a custom action.
    const schedule = actions.find((a) => askOf(type, a)?.def.kind === 'date' && a.changes.some((c) => c.field === status.id && c.value.kind === 'value' && c.value.value.kind === 'select' && c.value.value.value.length === 1 && c.value.value.value[0] === o.id))
    return schedule ?? {
    id: `triage-status:${o.id}`,
    name: o.label,
    icon: { kind: 'icon', value: o.status === 'done' ? 'ph:check-circle' : 'ph:arrow-right' },
    changes: [{ field: status.id, value: { kind: 'value', value: { kind: 'select', value: [o.id] } } }],
    }
  })
}

/** One of a review's choices: a status a task can be placed in, and the action that places it. */
export interface ReviewChoice {
  option: SelectOption
  action: QuickActionDef
}

/**
 * The statuses a review offers as buttons: each one that is not incoming, the open ones first and
 * those that close the task last, in the status's own order. A status reuses an action already set
 * up to place a task there and nothing else (Defer's date question, Mark done, Hold), so choosing
 * Scheduled still asks for its date; any other status gets a plain one. The action is named after
 * the status, which is what the review's totals count. None for a type without the built-in status.
 */
export function reviewChoices(type: ObjectType | undefined): ReviewChoice[] {
  if (type?.system !== 'task') return []
  const status = statusProperty(type)
  if (!status || status.id !== STATUS_PROPERTY_ID) return []
  const incoming = new Set(triageOptionsOf(type).map((o) => o.id))
  const hold = holdAction(type)
  const actions = [...quickActionsOf(type), ...(hold ? [hold] : [])]
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
  if (/wait|delegat/.test(label)) return 'ph:hourglass-medium'
  if (/sched|later|defer/.test(label)) return 'ph:calendar-blank'
  if (/hold|someday|paus/.test(label)) return 'ph:pause-circle'
  return 'ph:arrow-right'
}
