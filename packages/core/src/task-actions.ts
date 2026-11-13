// A task's quick actions: Done, Defer and Drop, one click each on its page. What they set comes from
// the type's `quickActions` (Type settings › Quick actions), checked against the type as it is now:
// a property or option that is gone, or of the wrong kind, falls back to the default. Done is the
// first status option meaning done (the one checkboxes set); Drop another option meaning done (a
// "Dropped", which ends a task without doing it, as in completeRepeat); Defer a date property, by
// default the due date, and optionally a status ("Scheduled").
import { DUE_PROPERTY_ID, STATUS_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, Id, ObjectRecord, ObjectType, PropertyValue, SelectOption } from './model.ts'

export interface ResolvedQuickActions {
  done?: SelectOption
  /** The date property Defer sets; absent when the type has none. */
  deferField?: DatePropertyDef
  deferStatus?: SelectOption
  drop?: SelectOption
}

const statusOptions = (type: ObjectType): SelectOption[] => {
  const def = type.properties.find((p) => p.id === STATUS_PROPERTY_ID)
  return def?.kind === 'select' ? def.options : []
}

/** The status options and date property a task type's quick actions set; empty for other types. */
export function resolveQuickActions(type: ObjectType | undefined): ResolvedQuickActions {
  if (type?.system !== 'task') return {}
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
  return {
    ...(done ? { done } : {}),
    ...(deferField ? { deferField } : {}),
    ...(deferStatus ? { deferStatus } : {}),
    ...(drop ? { drop } : {}),
  }
}

/** Whether a task's status is one meaning done (done, dropped…): its quick actions are behind it. */
export function isClosedTask(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): boolean {
  if (type?.system !== 'task') return false
  const value = object.props[STATUS_PROPERTY_ID]
  const ids = value?.kind === 'select' ? value.value : []
  return statusOptions(type).some((o) => o.status === 'done' && ids.includes(o.id))
}

export type QuickAction = { kind: 'done' } | { kind: 'drop' } | { kind: 'defer'; day: string }

/**
 * The property values a quick action writes (key → value), or undefined when the type cannot do it
 * (no option meaning done, no date property, no second option meaning done). Defer sets an all-day
 * date on `day` (YYYY-MM-DD); a date that repeats keeps its rule, moved to start there.
 */
export function quickActionValues(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>, action: QuickAction): Record<Id, PropertyValue> | undefined {
  const resolved = resolveQuickActions(type)
  const status = (option: SelectOption | undefined): Record<Id, PropertyValue> | undefined => (option ? { [STATUS_PROPERTY_ID]: { kind: 'select', value: [option.id] } } : undefined)
  if (action.kind === 'done') return status(resolved.done)
  if (action.kind === 'drop') return status(resolved.drop)
  const field = resolved.deferField
  if (!field) return undefined
  const current = object.props[field.id]
  const rrule = current?.kind === 'date' ? current.value.rrule : undefined
  const date: PropertyValue = { kind: 'date', value: { start: `${action.day}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } }
  return { [field.id]: date, ...status(resolved.deferStatus) }
}
