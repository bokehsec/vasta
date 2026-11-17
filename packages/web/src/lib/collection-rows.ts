// What a table row and a list row both ask about an object (components/ObjectTable, ObjectRows):
// its type, whether it has quick actions here, how its title looks (struck once done), how far its
// steps are. One answer for both layouts.
import { isClosedTask, parentFieldOf, quickActionsOf, subtaskProgress } from '@vasta/core'
import type { ObjectSummary, ObjectType } from '@vasta/core'
import { computed, inject } from 'vue'
import { COMPLETION_FEEDBACK } from './completion-feedback.ts'
import type { Group } from './query.ts'
import { subtasksOf } from './subtasks.ts'
import { typesById } from './state.ts'

/** A group, whether it is folded, and how many of its objects are drawn. */
export interface Section {
  group: Group
  collapsed: boolean
  limit: number
}

export function useRowTypes(readonly: () => boolean | undefined) {
  const completion = inject(COMPLETION_FEEDBACK, undefined)
  const typeOf = (object: ObjectSummary) => typesById.value.get(object.typeId)
  // Any type with quick actions gets them; a task's next step line is tasks only.
  const actionableTypes = computed(() => new Set([...typesById.value.values()].filter((t) => quickActionsOf(t).length).map((t) => t.id)))
  /** The type whose quick actions this object's row has: none where nothing changes (readonly) or the type has none. */
  const actionType = (object: ObjectSummary): ObjectType | undefined => {
    const type = readonly() ? undefined : typeOf(object)
    return type && actionableTypes.value.has(type.id) ? type : undefined
  }
  const isDoneTask = (object: ObjectSummary) => typeOf(object)?.system === 'task' && (completion?.done(object) ?? isClosedTask(typeOf(object), object))
  const titleClass = (object: ObjectSummary) => ['task-title transition-colors duration-150 motion-reduce:transition-none', isDoneTask(object) ? 'task-title-done text-ink-faint line-through' : '']
  /** How far an object's steps are, when it has any: counting every step, also those the filter leaves out. */
  function progressOf(object: ObjectSummary) {
    const type = typeOf(object)
    if (!parentFieldOf(type)) return undefined
    const steps = subtasksOf(type, object.id)
    return steps.length ? subtaskProgress(type, object, steps) : undefined
  }
  return { completion, typeOf, actionType, isDoneTask, titleClass, progressOf }
}
