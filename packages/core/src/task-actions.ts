// A type's quick actions: buttons on its page and rows that change its fields in one click (Type
// settings › Quick actions, any type). A type lists its own (`quickActions.actions`), each a set of
// changes: a fixed value, a day from today or next week, the user pressing it, nothing, or a value
// asked for when pressed (one per action: a day on a small calendar, a line of text). Only a task
// gets defaults without a list of its own: Done (the first status option meaning done, the one
// checkboxes set), Defer (asks for a day for the type's plan date, the Do date, and leaves the
// deadline alone), Drop (another option meaning done, a "Dropped", which ends a task without doing
// it, as in completeRepeat) and Next step (asks for the text of the type's next step field). Changes
// naming a property the type no longer has, or a value that does not fit it, are left out.
import { REVIEWED_PROPERTY_ID, SNOOZED_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DateValue, Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionChange, QuickActionDef, QuickActionValue, SelectOption, TextPropertyDef } from './model.ts'
import { statusProperty } from './metrics.ts'
import { reviewFieldOf } from './task-review.ts'
import { doneOptionOf, dropOptionOf, reopenOptionOf } from './task-status.ts'
import { taskDatesOf } from './task-dates.ts'
import { addDays, dayOfDate, moveDateToDay } from './time.ts'

/** Kinds of property whose value an action can ask for when pressed. */
export const ASKABLE_KINDS: readonly PropertyDef['kind'][] = ['date', 'text', 'number', 'url']
/** Kinds of property an action can change. */
export const CHANGEABLE_KINDS: readonly PropertyDef['kind'][] = ['select', 'date', 'text', 'number', 'url', 'checkbox', 'person', 'relation']

/** Whether a change's value fits the property it changes. */
export function valueFits(def: PropertyDef, value: QuickActionValue): boolean {
  if (!CHANGEABLE_KINDS.includes(def.kind)) return false
  switch (value.kind) {
    case 'value':
      if (value.value.kind !== def.kind) return false
      return def.kind !== 'select' || (value.value.kind === 'select' && value.value.value.every((id) => def.options.some((o) => o.id === id)))
    case 'day':
    case 'next-week':
      return def.kind === 'date'
    case 'me':
      return def.kind === 'person'
    case 'ask':
      return ASKABLE_KINDS.includes(def.kind)
    case 'clear':
      return true
  }
}

/** The type's next step field: a text property shown under a task's title in lists. */
export function nextStepFieldOf(type: ObjectType | undefined): TextPropertyDef | undefined {
  const id = type?.system === 'task' ? type.quickActions?.nextStepField : undefined
  const def = id ? type!.properties.find((p) => p.id === id) : undefined
  return def?.kind === 'text' ? def : undefined
}

const setStatus = (option: SelectOption, field: Id = STATUS_PROPERTY_ID): QuickActionChange => ({ field, value: { kind: 'value', value: { kind: 'select', value: [option.id] } } })

/** Mark done, Defer, Drop and Next step, as the type's properties allow: Defer needs a plan date. */
export function defaultQuickActions(type: ObjectType): QuickActionDef[] {
  // Only the task's own status select: its options are what the buttons set.
  const options = statusProperty(type)?.id === STATUS_PROPERTY_ID ? statusProperty(type)!.options : []
  const done = options.length ? doneOptionOf(type) : undefined
  const drop = options.length ? dropOptionOf(type) : undefined
  const plan = taskDatesOf(type).plan
  const nextStep = nextStepFieldOf(type)
  const actions: QuickActionDef[] = []
  if (done) actions.push(plainStatusAction(type, done))
  if (plan) actions.push({ id: 'defer', name: 'Defer', icon: { kind: 'icon', value: 'ph:clock-clockwise' }, changes: [{ field: plan.id, value: { kind: 'ask' } }] })
  if (drop) actions.push(plainStatusAction(type, drop))
  if (nextStep) actions.push({ id: 'next-step', name: nextStep.name, icon: { kind: 'icon', value: 'ph:pencil-simple-line' }, changes: [{ field: nextStep.id, value: { kind: 'ask' } }] })
  return actions
}

/**
 * A type's quick actions: its own list (any type), or the task defaults; none for other types without
 * a list. Changes that no longer fit are left out, and so is an action left with none; an action
 * asks for one value at most.
 */
export function quickActionsOf(type: ObjectType | undefined): QuickActionDef[] {
  if (!type) return []
  const own = type.quickActions?.actions
  if (!own) return type.system === 'task' ? defaultQuickActions(type) : []
  return own.flatMap((action) => {
    let asked = false
    const changes = action.changes.filter((change) => {
      const def = type.properties.find((p) => p.id === change.field)
      if (!def || !valueFits(def, change.value)) return false
      if (change.value.kind !== 'ask') return true
      if (asked) return false
      return (asked = true)
    })
    return changes.length ? [{ ...action, changes }] : []
  })
}

/** The change of an action that asks for its value when pressed, with the property it fills. */
export function askOf(type: ObjectType, action: QuickActionDef): { change: QuickActionChange; def: PropertyDef } | undefined {
  const change = action.changes.find((c) => c.value.kind === 'ask')
  const def = change && type.properties.find((p) => p.id === change.field)
  return change && def ? { change, def } : undefined
}

/** The type's Defer: its quick action with that id, else the first that asks for its plan date; none for a type without. Rows, a task's page and a review all run it. */
export function deferActionOf(type: ObjectType | undefined): QuickActionDef | undefined {
  const actions = quickActionsOf(type)
  const plan = taskDatesOf(type).plan
  return actions.find((a) => a.id === 'defer') ?? (plan ? actions.find((a) => askOf(type!, a)?.def.id === plan.id) : undefined)
}

/** Whether an action sets the status to this option (a change with it among its values). */
export const actionSetsStatus = (type: ObjectType, action: QuickActionDef, option: SelectOption): boolean => {
  const field = statusProperty(type)?.id
  return action.changes.some((c) => c.field === field && c.value.kind === 'value' && c.value.value.kind === 'select' && c.value.value.value.includes(option.id))
}

/** A plain action setting just the status: Done and Drop as the defaults are named, any other option by its label. */
export function plainStatusAction(type: ObjectType, option: SelectOption): QuickActionDef {
  const done = option.id === doneOptionOf(type)?.id
  const dropped = option.id === dropOptionOf(type)?.id
  return {
    id: done ? 'done' : dropped ? 'drop' : `status:${option.id}`,
    name: done ? `Mark ${option.label.toLowerCase()}` : dropped ? 'Drop' : option.label,
    icon: { kind: 'icon', value: done ? 'ph:check-circle' : option.status === 'done' ? 'ph:x-circle' : 'ph:arrow-right' },
    changes: [setStatus(option, statusProperty(type)?.id)],
  }
}

/**
 * The action that sets a status option: the type's own one that does (so a customised Done, with
 * what else it changes, is the Done everywhere), else a plain one setting just the status.
 */
export function statusActionOf(type: ObjectType, option: SelectOption): QuickActionDef {
  return quickActionsOf(type).find((a) => actionSetsStatus(type, a, option)) ?? plainStatusAction(type, option)
}

/** The type's Done: its quick action that sets the Done option, else the built-in; none without a status meaning done. */
export function doneActionOf(type: ObjectType | undefined): QuickActionDef | undefined {
  const option = doneOptionOf(type)
  return type && option ? statusActionOf(type, option) : undefined
}

/** The type's Drop: its quick action that sets the Drop option, else the built-in; none without a second option meaning done. */
export function dropActionOf(type: ObjectType | undefined): QuickActionDef | undefined {
  const option = dropOptionOf(type)
  return type && option ? statusActionOf(type, option) : undefined
}

/** The action that reopens a closed task (`previous`: the status it had, when known); named for the notice. */
export function reopenActionOf(type: ObjectType | undefined, previous?: PropertyValue): QuickActionDef | undefined {
  const option = reopenOptionOf(type, previous)
  const field = statusProperty(type)?.id
  return option && field ? { id: 'reopen', name: 'Reopened', icon: { kind: 'icon', value: 'ph:arrow-counter-clockwise' }, changes: [setStatus(option, field)] } : undefined
}

export interface QuickActionContext {
  /** Today and the first day of next week, in the user's calendar ("YYYY-MM-DD"). */
  today: string
  nextWeek: string
  /** The user pressing it. */
  me?: Id
  /**
   * A day asked for another date (Defer's "Do date") that lands after the deadline takes the
   * deadline along, when the question's "Move the due date too" is ticked (it is not at first), so
   * a task put off is not left overdue.
   */
  moveDue?: boolean
  /** The user's time zone: the day a timed date falls on, and the time of day it keeps when moved. */
  timeZone: string
  /**
   * Moves one occurrence of a repeating date to a day, the others staying (calendar.ts
   * `moveOccurrenceTo`, which needs the rule parser the app loads only for that). Without it a
   * repeating date is left as it is.
   */
  moveOccurrence?: (value: DateValue, day: string) => DateValue
}

/**
 * The property values an action writes (key → value; undefined clears), or undefined when it asks
 * and got no answer. A day moves a date there, keeping its time of day, its end and the rest it
 * holds (a new one is all-day); a date that repeats changes only its current occurrence.
 */
export function quickActionChanges(
  type: ObjectType,
  object: Pick<ObjectRecord, 'props'>,
  action: QuickActionDef,
  context: QuickActionContext,
  answer?: PropertyValue
): Record<Id, PropertyValue | undefined> | undefined {
  return resolveChanges(type, object, action, context, answer)?.values
}

/** What an action writes, and the day each date it moved to a day is on (a repeating date's value starts where it did: only its occurrence moved). */
function resolveChanges(
  type: ObjectType,
  object: Pick<ObjectRecord, 'props'>,
  action: QuickActionDef,
  context: QuickActionContext,
  answer?: PropertyValue
): { values: Record<Id, PropertyValue | undefined>; days: Record<Id, string> } | undefined {
  const values: Record<Id, PropertyValue | undefined> = {}
  const days: Record<Id, string> = {}
  const onDay = (field: Id, day: string): PropertyValue | undefined => {
    const current = object.props[field]
    if (current?.kind !== 'date') return { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } }
    if (current.value.rrule) return context.moveOccurrence ? { kind: 'date', value: context.moveOccurrence(current.value, day) } : undefined
    return { kind: 'date', value: moveDateToDay(current.value, { day }, context.timeZone) }
  }
  const setDay = (field: Id, day: string) => {
    const value = onDay(field, day)
    if (!value) return
    values[field] = value
    days[field] = day
  }
  const deadline = taskDatesOf(type).deadline?.id
  let asked: { field: Id; day: string } | undefined
  for (const { field, value } of action.changes) {
    switch (value.kind) {
      case 'value':
        values[field] = value.value
        break
      case 'day':
        setDay(field, addDays(context.today, value.days))
        break
      case 'next-week':
        setDay(field, context.nextWeek)
        break
      case 'me':
        if (context.me) values[field] = { kind: 'person', value: [context.me] }
        break
      case 'ask':
        if (!answer) return undefined
        if (answer.kind === 'date') setDay(field, answer.value.start.slice(0, 10))
        else values[field] = answer
        if (answer.kind === 'date' && context.moveDue) asked = { field, day: answer.value.start.slice(0, 10) }
        break
      case 'clear':
        values[field] = undefined
        break
    }
  }
  if (asked && deadline && asked.field !== deadline && !(deadline in values)) {
    const due = deadlineMovedTo(type, object, asked.day, context.timeZone)
    if (due) values[deadline] = due
  }
  return { values, days }
}

/**
 * The deadline moved to `day` when it falls before it, keeping its time of day (and the length of a
 * span); undefined when there is nothing to move: no deadline, one on or after the day, or one that
 * repeats (moving it would move the whole series, which putting one task off does not mean).
 */
export function deadlineMovedTo(type: ObjectType, object: Pick<ObjectRecord, 'props'>, day: string, timeZone: string): PropertyValue | undefined {
  const field = taskDatesOf(type).deadline?.id
  const due = field ? object.props[field] : undefined
  if (due?.kind !== 'date' || due.value.rrule) return undefined
  if (dayOfDate(due.value, timeZone) >= day) return undefined
  return { kind: 'date', value: moveDateToDay(due.value, { day }, timeZone) }
}

/** The action with the value it asks for cleared instead: an empty answer to a line of text. */
export function withAskCleared(type: ObjectType, action: QuickActionDef): QuickActionDef {
  const ask = askOf(type, action)
  return ask ? { ...action, changes: action.changes.map((c) => (c === ask.change ? { ...c, value: { kind: 'clear' as const } } : c)) } : action
}

/** What an action writes on one object, and the values it had before (for Undo). */
export interface QuickActionEdit {
  id: Id
  values: Record<Id, PropertyValue | undefined>
  before: Record<Id, PropertyValue | undefined>
  /** The day each date set on a day by the action is now on, for the notice. */
  days: Record<Id, string>
}

/**
 * An action run on an object: the values it writes (a date that repeats keeps its own rule) and
 * what they were before; undefined when it writes nothing (an unanswered ask).
 */
export function quickActionEdit(
  type: ObjectType,
  object: Pick<ObjectRecord, 'id' | 'props'>,
  action: QuickActionDef,
  context: QuickActionContext,
  answer?: PropertyValue
): QuickActionEdit | undefined {
  const resolved = resolveChanges(type, object, action, context, answer)
  if (!resolved) return undefined
  const { values, days } = resolved
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, object.props[key]]))
  // Done on a repeating task is saved as its next occurrence (completeRepeat moves the deadline,
  // clears a plan that is past and puts the status back), so Undo has to put those back too, not only the status.
  const { plan, deadline } = taskDatesOf(type)
  if (deadline && !(deadline.id in before) && endsRepeat(type, object, values)) {
    before[deadline.id] = object.props[deadline.id]
    if (plan && plan.id in object.props && !(plan.id in before)) before[plan.id] = object.props[plan.id]
  }
  // A new status marks the task reviewed when saved (reviewedByStatusChange): Undo puts that day back too.
  const reviewed = reviewFieldOf(type)
  if (reviewed && STATUS_PROPERTY_ID in values && !(reviewed.id in before)) before[reviewed.id] = object.props[reviewed.id]
  return { id: object.id, values, before, days }
}

/** Whether `values` do a task whose deadline repeats (Done, not Drop): what completeRepeat rewrites when saved, the task going on to its next occurrence. */
export function endsRepeat(type: ObjectType, object: Pick<ObjectRecord, 'props'>, values: Record<Id, PropertyValue | undefined>): boolean {
  const field = taskDatesOf(type).deadline?.id
  const due = field ? object.props[field] : undefined
  const next = values[STATUS_PROPERTY_ID]
  if (type.system !== 'task' || due?.kind !== 'date' || !due.value.rrule || next?.kind !== 'select') return false
  const done = doneOptionOf(type)
  return !!done && next.value.includes(done.id)
}

/** The day a property value falls on, if it is a date. */
function dayOfValue(value: PropertyValue | undefined, timeZone: string): string | undefined {
  return value?.kind === 'date' ? dayOfDate(value.value, timeZone) : undefined
}

/** An action's name said once it is done, in notices and counts: "Mark done" is "Done". */
export function quickActionDoneName(name: string): string {
  return name.replace(/^mark\s+(\S)/i, (_, c: string) => c.toUpperCase())
}

/**
 * The notice after an action: its name and the days it set ("Defer · Do date Fri Nov 20"; a Snooze
 * reads "Snoozed until Wed, Nov 25"), a day set past the object's due date, and a due date taken along.
 */
export function quickActionMessage(
  type: ObjectType,
  action: QuickActionDef,
  edit: QuickActionEdit,
  options: { longDay: (day: string) => string; timeZone: string; due?: PropertyValue }
): string {
  const deadline = taskDatesOf(type).deadline?.id
  // A deadline the action does not name was taken along by the day asked for (moveDue): said in words, not as a day of its own.
  const takesDue = !!deadline && !action.changes.some((c) => c.field === deadline)
  const movedDue = takesDue && !!edit.values[deadline]
  const days = Object.entries(edit.values).flatMap(([field, value]) => {
    // The Last reviewed day a review adds to every action goes without saying.
    if ((takesDue && field === deadline) || field === REVIEWED_PROPERTY_ID) return []
    const day = edit.days[field] ?? dayOfValue(value, options.timeZone)
    const def = type.properties.find((p) => p.id === field)
    return day && def ? [{ field, day, name: def.name }] : []
  })
  const snoozed = days.find((d) => d.field === SNOOZED_PROPERTY_ID)
  const named = quickActionDoneName(action.name)
  // Days that are the snoozed day too (Waiting…: Check back, the Do date moved with it) are said by "until".
  let message = [snoozed ? `${named} until ${options.longDay(snoozed.day)}` : named, ...days.filter((d) => d !== snoozed && d.day !== snoozed?.day).map((d) => `${d.name} ${options.longDay(d.day)}`)].join(' · ')
  const due = movedDue ? undefined : dayOfValue(options.due, options.timeZone)
  const late = due && days.find((d) => d.field !== deadline && d !== snoozed && d.day > due)
  if (late && due) message += ` (after its due date, ${options.longDay(due)})`
  if (movedDue) message += ' · due date moved too'
  return message
}
