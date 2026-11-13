// A task's quick actions: buttons on its page and rows that change its fields in one click (Type
// settings › Quick actions). A type lists its own (`quickActions.actions`), each a set of changes: a
// fixed value, a day from today or next week, the user pressing it, nothing, or a value asked for
// when pressed (one per action: a day on a small calendar, a line of text). Without a list, the
// defaults: Done (the first status option meaning done, the one checkboxes set), Defer (asks for a
// day for the due date, or the date the type names, and may set a status such as "Scheduled"), Drop
// (another option meaning done, a "Dropped", which ends a task without doing it, as in
// completeRepeat) and Next step (asks for the text of the type's next step field). Changes naming a
// property the type no longer has, or a value that does not fit it, are left out.
import { DUE_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionChange, QuickActionDef, QuickActionValue, SelectOption, TextPropertyDef } from './model.ts'
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
 * A task type's quick actions: its own list, or the defaults; none for other types. Changes that no
 * longer fit are left out, and so is an action left with none; an action asks for one value at most.
 */
export function quickActionsOf(type: ObjectType | undefined): QuickActionDef[] {
  if (type?.system !== 'task') return []
  const own = type.quickActions?.actions
  if (!own) return defaultQuickActions(type)
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

/** Whether a task's status is one meaning done (done, dropped…): its quick actions are behind it. */
export function isClosedTask(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): boolean {
  if (type?.system !== 'task') return false
  const value = object.props[STATUS_PROPERTY_ID]
  const ids = value?.kind === 'select' ? value.value : []
  return statusOptions(type).some((o) => o.status === 'done' && ids.includes(o.id))
}

export interface QuickActionContext {
  /** Today and the first day of next week, in the user's calendar ("YYYY-MM-DD"). */
  today: string
  nextWeek: string
  /** The user pressing it. */
  me?: Id
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
        break
      case 'clear':
        values[field] = undefined
        break
    }
  }
  return values
}
