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
import { DUE_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionChange, QuickActionDef, QuickActionValue, SelectOption, TextPropertyDef } from './model.ts'
import { statusProperty } from './metrics.ts'
import { addDays } from './time.ts'

/** Kinds of property whose value an action can ask for when pressed. */
export const ASKABLE_KINDS: readonly PropertyDef['kind'][] = ['date', 'text', 'number', 'url']
/** Kinds of property an action can change. */
export const CHANGEABLE_KINDS: readonly PropertyDef['kind'][] = ['select', 'date', 'text', 'number', 'url', 'checkbox', 'person', 'relation']

const statusOptions = (type: ObjectType): SelectOption[] => {
  const def = type.properties.find((p) => p.id === STATUS_PROPERTY_ID)
  return def?.kind === 'select' ? def.options : []
}

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

const setStatus = (option: SelectOption): QuickActionChange => ({ field: STATUS_PROPERTY_ID, value: { kind: 'value', value: { kind: 'select', value: [option.id] } } })

/** Done, Defer, Drop and Next step, as the type's settings and properties allow. */
export function defaultQuickActions(type: ObjectType): QuickActionDef[] {
  const settings = type.quickActions ?? {}
  const options = statusOptions(type)
  const option = (id: Id | undefined) => (id ? options.find((o) => o.id === id) : undefined)
  const dateField = (id: Id | undefined) => {
    const def = id ? type.properties.find((p) => p.id === id) : undefined
    return def?.kind === 'date' ? def : undefined
  }
  const closing = options.filter((o) => o.status === 'done')
  const done = closing[0]
  const chosenDrop = option(settings.dropStatus)
  const drop = chosenDrop && chosenDrop.id !== done?.id ? chosenDrop : closing[1]
  const deferField = dateField(settings.deferField) ?? dateField(DUE_PROPERTY_ID)
  const deferStatus = option(settings.deferStatus)
  const nextStep = nextStepFieldOf(type)
  const actions: QuickActionDef[] = []
  if (done) actions.push({ id: 'done', name: done.label, icon: { kind: 'icon', value: 'ph:check-circle' }, changes: [setStatus(done)] })
  if (deferField) actions.push({ id: 'defer', name: 'Defer', icon: { kind: 'icon', value: 'ph:clock-clockwise' }, changes: [{ field: deferField.id, value: { kind: 'ask' } }, ...(deferStatus ? [setStatus(deferStatus)] : [])] })
  if (drop) actions.push({ id: 'drop', name: 'Drop', icon: { kind: 'icon', value: 'ph:x-circle' }, changes: [setStatus(drop)] })
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

/**
 * Whether an object's status is one meaning done (done, dropped…): its quick actions are behind it.
 * The status is a task's own, or another type's select with status categories (a project's); a type
 * without one is never closed.
 */
export function isClosedTask(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): boolean {
  const def = statusProperty(type)
  if (!def) return false
  const value = object.props[def.id]
  const ids = value?.kind === 'select' ? value.value : []
  return def.options.some((o) => o.status === 'done' && ids.includes(o.id))
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
 * An action run on one or many objects, with one answer for all: each object's own values (a date
 * that repeats keeps its own rule) and what they were before. Objects it writes nothing on (an
 * unanswered ask) are left out.
 */
export function quickActionEdits(
  type: ObjectType,
  objects: readonly Pick<ObjectRecord, 'id' | 'props'>[],
  action: QuickActionDef,
  context: QuickActionContext,
  answer?: PropertyValue
): QuickActionEdit[] {
  return objects.flatMap((object) => {
    const values = quickActionChanges(type, object, action, context, answer)
    if (!values) return []
    const before = Object.fromEntries(Object.keys(values).map((key) => [key, object.props[key]]))
    // Done on a repeating task is saved as its next occurrence (completeRepeat moves the due date and
    // puts the status back), so Undo has to put the due date back too, not only the status.
    if (!(DUE_PROPERTY_ID in before) && endsRepeat(type, object, values)) before[DUE_PROPERTY_ID] = object.props[DUE_PROPERTY_ID]
    return [{ id: object.id, values, before }]
  })
}

/** Whether `values` close a task whose due date repeats: what completeRepeat rewrites when saved. */
function endsRepeat(type: ObjectType, object: Pick<ObjectRecord, 'props'>, values: Record<Id, PropertyValue | undefined>): boolean {
  const due = object.props[DUE_PROPERTY_ID]
  const next = values[STATUS_PROPERTY_ID]
  if (type.system !== 'task' || due?.kind !== 'date' || !due.value.rrule || next?.kind !== 'select') return false
  return statusOptions(type).some((o) => o.status === 'done' && next.value.includes(o.id))
}

/** The day a date value falls on ("YYYY-MM-DD"); a timed one in the zone `dayOfTime` gives. */
function dayOfValue(value: PropertyValue | undefined, dayOfTime: (iso: string) => string): string | undefined {
  if (value?.kind !== 'date') return undefined
  return value.value.resolution === 'day' ? value.value.start.slice(0, 10) : dayOfTime(value.value.start)
}

/**
 * The notice after an action: its name and the days it set ("Defer · Do date Fri Nov 20"), the
 * number of objects when there are several, a day set past one object's due date, and how many
 * failed to save.
 */
export function quickActionMessage(
  type: ObjectType,
  action: QuickActionDef,
  edits: readonly QuickActionEdit[],
  options: { longDay: (day: string) => string; dayOfTime: (iso: string) => string; due?: PropertyValue; failed?: number; noun?: (count: number) => string }
): string {
  const first = edits[0]
  // A due date the action does not name was taken along by the day asked for (moveDue): said in words, not as a day of its own.
  const takesDue = !action.changes.some((c) => c.field === DUE_PROPERTY_ID)
  const movedDue = takesDue ? edits.filter((e) => e.values[DUE_PROPERTY_ID]).length : 0
  const days = first
    ? Object.entries(first.values).flatMap(([field, value]) => {
        if (takesDue && field === DUE_PROPERTY_ID) return []
        const day = dayOfValue(value, options.dayOfTime)
        const def = type.properties.find((p) => p.id === field)
        return day && def ? [{ field, day, name: def.name }] : []
      })
    : []
  const parts = [action.name, ...days.map((d) => `${d.name} ${options.longDay(d.day)}`)]
  if (edits.length > 1) parts.push(options.noun ? options.noun(edits.length) : `${edits.length} tasks`)
  let message = parts.join(' · ')
  const due = edits.length === 1 && !movedDue ? dayOfValue(options.due, options.dayOfTime) : undefined
  const late = due && days.find((d) => d.field !== DUE_PROPERTY_ID && d.day > due)
  if (late && due) message += ` (after its due date, ${options.longDay(due)})`
  if (movedDue) message += edits.length === 1 ? ' · due date moved too' : ` · ${movedDue} due ${movedDue === 1 ? 'date' : 'dates'} moved too`
  if (options.failed) message += ` · ${options.failed} not saved`
  return message
}
