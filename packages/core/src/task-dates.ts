// What a task's dates mean, said once. A date property of a task type has a role (`role`): `plan`,
// the day you will work on it (the "Do date": Defer sets it, the calendar shows it, a drag moves it),
// or `deadline`, the day it must be done by (Due). Everything that asks which date is which asks
// here: lists, the calendar, Review, the quick actions, the server and agents. A task's Due is its
// deadline unless the type says otherwise; a date without a role is a plain date.
import { DUE_PROPERTY_ID } from './builtin-types.ts'
import type { DatePropertyDef, ObjectType } from './model.ts'

/** A task type's plan date and deadline, where it has them. Tasks only: no other type has roles. */
export function taskDatesOf(type: ObjectType | undefined): { plan?: DatePropertyDef; deadline?: DatePropertyDef } {
  if (type?.system !== 'task') return {}
  const dates = type.properties.filter((p): p is DatePropertyDef => p.kind === 'date')
  const plan = dates.find((p) => p.role === 'plan')
  const deadline = dates.find((p) => p.role === 'deadline') ?? dates.find((p) => p.id === DUE_PROPERTY_ID && !p.role)
  return { ...(plan ? { plan } : {}), ...(deadline ? { deadline } : {}) }
}
