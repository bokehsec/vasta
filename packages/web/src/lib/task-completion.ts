// Finishing and reopening a task from a circle or checkbox (lists, tables, cards, queries, the
// calendar): one path for all of them. A task is done with the type's own Done action, as its Done
// button does (core task-actions.ts doneActionOf), so what else that action changes happens here
// too; it runs through the quick-action runner (lib/quick-actions.ts), which says what happened in
// a notice with Undo and asks about open subtasks. Reopening sets the status that reopens a task.
import type { Id, ObjectRecord, ObjectType } from '@vasta/core'
import { doneActionOf, reopenActionOf } from '@vasta/core'
import { setProperties } from './actions.ts'
import { api } from './api.ts'
import { runQuickAction } from './quick-actions.ts'

const taskSaves = new Set<Id>()

/**
 * Marks a task done, or reopens it: loads it, runs the action and returns the object saved
 * (undefined when nothing was, or one change of this task is still being made).
 */
export async function setTaskDone(objectId: Id, type: ObjectType | undefined, done: boolean): Promise<ObjectRecord | undefined> {
  const action = done ? doneActionOf(type) : reopenActionOf(type)
  if (!type || !action || taskSaves.has(objectId)) return undefined
  taskSaves.add(objectId)
  try {
    const object = await api.object(objectId)
    let saved: ObjectRecord | undefined
    await runQuickAction(type, object, action, { save: async (id, values) => { saved = await setProperties(id, values) } })
    return saved
  } finally {
    taskSaves.delete(objectId)
  }
}
