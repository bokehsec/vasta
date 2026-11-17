// A type's quick actions: buttons on its page and rows that change its fields in one click (Type
// settings › Quick actions, any type). A type lists its own (`quickActions.actions`), each a set of
// changes: a fixed value, a day from today or next week, the user pressing it, nothing, or a value
// asked for when pressed (one per action: a day on a small calendar, a line of text). Only a task
// gets defaults without a list of its own: Done (the first status option meaning done, the one
// checkboxes set), Defer (asks for a day for the due date, or the date the type names, and may set a
// status such as "Scheduled"), Drop (another option meaning done, a "Dropped", which ends a task
// without doing it, as in completeRepeat) and Next step (asks for the text of the type's next step
// field). Changes naming a property the type no longer has, or a value that does not fit it, are
// left out.
import { DUE_PROPERTY_ID, REVIEWED_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionChange, QuickActionDef, QuickActionValue, SelectOption, TextPropertyDef } from './model.ts'
import { statusProperty } from './metrics.ts'
import { reviewFieldOf } from './task-review.ts'
import { doneOptionOf, dropOptionOf, reopenOptionOf } from './task-status.ts'
import { addDays } from './time.ts'

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

/** Mark done, Defer, Drop and Next step, as the type's settings and properties allow. */
export function defaultQuickActions(type: ObjectType): QuickActionDef[] {
  const settings = type.quickActions ?? {}
  // Only the task's own status select: its options are what the buttons set.
  const options = statusProperty(type)?.id === STATUS_PROPERTY_ID ? statusProperty(type)!.options : []
  const option = (id: Id | undefined) => (id ? options.find((o) => o.id === id) : undefined)
  const dateField = (id: Id | undefined) => {
    const def = id ? type.properties.find((p) => p.id === id) : undefined
    return def?.kind === 'date' ? def : undefined
  }
  const done = options.length ? doneOptionOf(type) : undefined
  const drop = options.length ? dropOptionOf(type) : undefined
  const deferField = dateField(settings.deferField) ?? dateField(DUE_PROPERTY_ID)
  const deferStatus = option(settings.deferStatus)
  const nextStep = nextStepFieldOf(type)
  const actions: QuickActionDef[] = []
  if (done) actions.push(plainStatusAction(type, done))
  if (deferField) actions.push({ id: 'defer', name: 'Defer', icon: { kind: 'icon', value: 'ph:clock-clockwise' }, changes: [{ field: deferField.id, value: { kind: 'ask' } }, ...(deferStatus ? [setStatus(deferStatus)] : [])] })
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

/** A task's work date, as configured for Defer/Schedule; Due remains its deadline. */
export function plannedDateFieldOf(type: ObjectType | undefined): DatePropertyDef | undefined {
  if (type?.system !== 'task') return undefined
  const configured = type.properties.find((p) => p.id === type.quickActions?.deferField)
  if (configured?.kind === 'date' && configured.id !== DUE_PROPERTY_ID) return configured
  const action = quickActionsOf(type).find((a) => a.id === 'defer' || a.id === 'schedule')
  const asked = action && askOf(type, action)?.def
  return asked?.kind === 'date' && asked.id !== DUE_PROPERTY_ID ? asked : undefined
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
   * A day asked for another date (Defer's "Do date") that lands after the due date takes the due
   * date along (the question's "Move the due date too"), so a task put off is not left overdue.
   */
  moveDue?: boolean
  /** The day a timed date falls on for the user (default: its UTC day). */
  dayOfTime?: (iso: string) => string
}

/**
 * The property values an action writes (key → value; undefined clears), or undefined when it asks
 * and got no answer. A day is all-day; a date that repeats keeps its rule, moved to start there.
 */
export function quickActionChanges(
  type: ObjectType,
  object: Pick<ObjectRecord, 'props'>,
  action: QuickActionDef,
  context: QuickActionContext,
  answer?: PropertyValue
): Record<Id, PropertyValue | undefined> | undefined {
  const values: Record<Id, PropertyValue | undefined> = {}
  const onDay = (field: Id, day: string): PropertyValue => {
    const current = object.props[field]
    const rrule = current?.kind === 'date' ? current.value.rrule : undefined
    return { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } }
  }
  let asked: { field: Id; day: string } | undefined
  for (const { field, value } of action.changes) {
    switch (value.kind) {
      case 'value':
        values[field] = value.value
        break
      case 'day':
        values[field] = onDay(field, addDays(context.today, value.days))
        break
      case 'next-week':
        values[field] = onDay(field, context.nextWeek)
        break
      case 'me':
        if (context.me) values[field] = { kind: 'person', value: [context.me] }
        break
      case 'ask':
        if (!answer) return undefined
        values[field] = answer.kind === 'date' ? onDay(field, answer.value.start.slice(0, 10)) : answer
        if (answer.kind === 'date' && context.moveDue) asked = { field, day: answer.value.start.slice(0, 10) }
        break
      case 'clear':
        values[field] = undefined
        break
    }
  }
  if (asked && asked.field !== DUE_PROPERTY_ID && !(DUE_PROPERTY_ID in values)) {
    const due = dueMovedTo(type, object, asked.day, context.dayOfTime)
    if (due) values[DUE_PROPERTY_ID] = due
  }
  return values
}

const DAY_MS = 86_400_000

/**
 * The due date moved to `day` when it falls before it, keeping a time of day (and the length of a
 * span); undefined when there is nothing to move: no due date, one on or after the day, or one that
 * repeats (moving it would move the whole series, which putting one task off does not mean).
 */
export function dueMovedTo(type: ObjectType, object: Pick<ObjectRecord, 'props'>, day: string, dayOfTime: (iso: string) => string = (iso) => iso.slice(0, 10)): PropertyValue | undefined {
  const def = type.properties.find((p) => p.id === DUE_PROPERTY_ID)
  const due = object.props[DUE_PROPERTY_ID]
  if (def?.kind !== 'date' || due?.kind !== 'date' || due.value.rrule) return undefined
  const from = dayOfValue(due, dayOfTime)
  if (!from || from >= day) return undefined
  const shift = Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)
  const moved = (iso: string) => new Date(Date.parse(iso) + Math.round(shift / DAY_MS) * DAY_MS).toISOString()
  return { kind: 'date', value: { ...due.value, start: moved(due.value.start), ...(due.value.end ? { end: moved(due.value.end) } : {}) } }
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
  const values = quickActionChanges(type, object, action, context, answer)
  if (!values) return undefined
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, object.props[key]]))
  // Done on a repeating task is saved as its next occurrence (completeRepeat moves the due date and
  // puts the status back), so Undo has to put the due date back too, not only the status.
  if (!(DUE_PROPERTY_ID in before) && endsRepeat(type, object, values)) before[DUE_PROPERTY_ID] = object.props[DUE_PROPERTY_ID]
  // A new status marks the task reviewed when saved (reviewedByStatusChange): Undo puts that day back too.
  const reviewed = reviewFieldOf(type)
  if (reviewed && STATUS_PROPERTY_ID in values && !(reviewed.id in before)) before[reviewed.id] = object.props[reviewed.id]
  return { id: object.id, values, before }
}

/** Whether `values` do a task whose due date repeats (Done, not Drop): what completeRepeat rewrites when saved, the task going on to its next occurrence. */
export function endsRepeat(type: ObjectType, object: Pick<ObjectRecord, 'props'>, values: Record<Id, PropertyValue | undefined>): boolean {
  const due = object.props[DUE_PROPERTY_ID]
  const next = values[STATUS_PROPERTY_ID]
  if (type.system !== 'task' || due?.kind !== 'date' || !due.value.rrule || next?.kind !== 'select') return false
  const done = doneOptionOf(type)
  return !!done && next.value.includes(done.id)
}

/** The day a date value falls on ("YYYY-MM-DD"); a timed one in the zone `dayOfTime` gives. */
function dayOfValue(value: PropertyValue | undefined, dayOfTime: (iso: string) => string): string | undefined {
  if (value?.kind !== 'date') return undefined
  return value.value.resolution === 'day' ? value.value.start.slice(0, 10) : dayOfTime(value.value.start)
}

/** An action's name said once it is done, in notices and counts: "Mark done" is "Done". */
export function quickActionDoneName(name: string): string {
  return name.replace(/^mark\s+(\S)/i, (_, c: string) => c.toUpperCase())
}

/**
 * The notice after an action: its name and the days it set ("Defer · Do date Fri Nov 20"), a day
 * set past the object's due date, and a due date taken along.
 */
export function quickActionMessage(
  type: ObjectType,
  action: QuickActionDef,
  edit: QuickActionEdit,
  options: { longDay: (day: string) => string; dayOfTime: (iso: string) => string; due?: PropertyValue }
): string {
  // A due date the action does not name was taken along by the day asked for (moveDue): said in words, not as a day of its own.
  const takesDue = !action.changes.some((c) => c.field === DUE_PROPERTY_ID)
  const movedDue = takesDue && !!edit.values[DUE_PROPERTY_ID]
  const days = Object.entries(edit.values).flatMap(([field, value]) => {
    // The Last reviewed day a review adds to every action goes without saying.
    if ((takesDue && field === DUE_PROPERTY_ID) || field === REVIEWED_PROPERTY_ID) return []
    const day = dayOfValue(value, options.dayOfTime)
    const def = type.properties.find((p) => p.id === field)
    return day && def ? [{ field, day, name: def.name }] : []
  })
  let message = [quickActionDoneName(action.name), ...days.map((d) => `${d.name} ${options.longDay(d.day)}`)].join(' · ')
  const due = movedDue ? undefined : dayOfValue(options.due, options.dayOfTime)
  const late = due && days.find((d) => d.field !== DUE_PROPERTY_ID && d.day > due)
  if (late && due) message += ` (after its due date, ${options.longDay(due)})`
  if (movedDue) message += ' · due date moved too'
  return message
}
