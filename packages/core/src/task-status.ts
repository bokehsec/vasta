// What a task's status means, said once. A status option carries a category (`status`: todo, doing
// or done); everything that asks "is it closed?", "which option is Done?", "what reopens it?" or
// "is it incoming?" asks here, so a list, the calendar, a board, a review and the server agree.
//   - closed: the status is an option meaning done. Done is the first of those; any other (a
//     "Dropped", "Cancelled") ends the task without doing it: closed as "dropped".
//   - Drop: the status the type's own Drop action sets (a closed option other than Done), else the
//     second option meaning done.
//   - reopening: the status the task had before when it is known and open, else the first to-do
//     option that is not incoming, so a reopened task does not fall back into triage.
//   - incoming: the options a review treats as new work: the type's own list, else those called
//     "Inbox", else none (a task with no status at all is new either way).
// The status is a task's own, or another type's select with status categories (a project's); a type
// without one is never closed.
import { statusProperty } from './metrics.ts'
import type { Id, ObjectRecord, ObjectType, PropertyValue, SelectOption } from './model.ts'

type Item = Pick<ObjectRecord, 'props'>

/** The options of the type's status select. */
export const statusOptionsOf = (type: ObjectType | undefined): SelectOption[] => statusProperty(type)?.options ?? []

/** The options meaning done, in the status's own order: Done first, then the ones that drop a task. */
export const closedOptionsOf = (type: ObjectType | undefined): SelectOption[] => statusOptionsOf(type).filter((o) => o.status === 'done')

/** The ids of a type's status options meaning done. */
export const closedStatusIds = (type: ObjectType | undefined): Id[] => closedOptionsOf(type).map((o) => o.id)

/** The option that means done: the first one that does, the one checkboxes set. */
export const doneOptionOf = (type: ObjectType | undefined): SelectOption | undefined => closedOptionsOf(type)[0]

/** The option Drop sets: the one the type's own Drop action sets (an option meaning done other than Done), else the next one meaning done. */
export function dropOptionOf(type: ObjectType | undefined): SelectOption | undefined {
  const closed = closedOptionsOf(type)
  const status = statusProperty(type)
  const change = status ? type?.quickActions?.actions?.find((a) => a.id === 'drop')?.changes.find((c) => c.field === status.id) : undefined
  const chosen = change?.value.kind === 'value' && change.value.value.kind === 'select' ? change.value.value.value[0] : undefined
  const option = chosen ? closed.find((o) => o.id === chosen) : undefined
  return option && option.id !== closed[0]?.id ? option : closed[1]
}

/** How a task is closed: 'done', or 'dropped' (an option meaning done other than Done); undefined while open. */
export function closingOf(type: ObjectType | undefined, object: Item): 'done' | 'dropped' | undefined {
  const def = statusProperty(type)
  const value = def ? object.props[def.id] : undefined
  const ids = value?.kind === 'select' ? value.value : []
  const closed = closedOptionsOf(type).filter((o) => ids.includes(o.id))
  if (!closed.length) return undefined
  return closed.some((o) => o.id === doneOptionOf(type)?.id) ? 'done' : 'dropped'
}

/** Whether a task's status is one meaning done (done, dropped…): its quick actions are behind it. */
export const isClosedTask = (type: ObjectType | undefined, object: Item): boolean => closingOf(type, object) !== undefined

/**
 * The options a review treats as incoming: the type's own list (`quickActions.triageStatuses`),
 * else those labelled Inbox, else none. Tasks of a task type only; never an option meaning done.
 */
export function triageOptionsOf(type: ObjectType | undefined): SelectOption[] {
  if (type?.system !== 'task') return []
  const options = statusOptionsOf(type).filter((o) => o.status !== 'done')
  const own = type.quickActions?.triageStatuses
  if (Array.isArray(own)) return options.filter((o) => own.includes(o.id))
  return options.filter((o) => /^inbox$/i.test(o.label.trim()))
}

/** A new task: of a task type, open, and with no status or an incoming one. */
export function needsTriage(type: ObjectType | undefined, object: Item): boolean {
  if (type?.system !== 'task' || isClosedTask(type, object)) return false
  const status = statusProperty(type)
  const value = status && object.props[status.id]
  const ids = value?.kind === 'select' ? value.value.filter((id) => status!.options.some((o) => o.id === id)) : []
  return !ids.length || triageOptionsOf(type).some((o) => ids.includes(o.id))
}

/**
 * The option that reopens a closed task: `previous` (the status it had, when known) if it is an
 * open option, else the first to-do option that is not incoming, else the first open one.
 */
export function reopenOptionOf(type: ObjectType | undefined, previous?: PropertyValue): SelectOption | undefined {
  const open = statusOptionsOf(type).filter((o) => o.status !== 'done')
  const before = previous?.kind === 'select' ? open.find((o) => previous.value.includes(o.id)) : undefined
  if (before) return before
  const incoming = new Set(triageOptionsOf(type).map((o) => o.id))
  return open.find((o) => o.status === 'todo' && !incoming.has(o.id)) ?? open.find((o) => !incoming.has(o.id)) ?? open[0]
}
