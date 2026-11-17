// The one way the app saves a type: `patchType(id, { views })` says which fields change. The change
// shows at once (the type in `workspace`, held in `unsavedTypes` so a reload of the stored copy
// meanwhile does not undo it) and is sent as a patch of just those fields (core type-patch.ts), one
// request at a time per type. Patches made before the send go together, a later one for the same
// field wins, and fields nobody here touched are never sent, so a view change made while the type's
// settings dialog was open, or on another device, is not overwritten by a copy that did not know it.
import { applyTypePatch, type Id, type ObjectType, type TypePatch } from '@vasta/core'
import { api } from './api.ts'
import { clone } from './clone.ts'
import { replaceType, typesById, unsavedTypes } from './state.ts'

interface Queue {
  /** What is waiting to be sent. */
  waiting: TypePatch
  timer?: ReturnType<typeof setTimeout>
  /** The send in progress, which every caller whose patch it carries waits on. */
  running?: Promise<void>
  listeners: { resolve: (type: ObjectType) => void; reject: (error: unknown) => void }[]
}

const queues = new Map<Id, Queue>()

/** `undefined` in a patch takes an optional field away; the wire says null. */
const wire = (patch: TypePatch): TypePatch => Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value === undefined ? null : value]))

/** The type as this app has it now: with changes not saved yet. */
export const currentType = (id: Id): ObjectType | undefined => unsavedTypes.get(id) ?? typesById.value.get(id)

/**
 * Change fields of a type. `delay`: wait that long for more changes before sending (a view's
 * settings, edited in quick succession). Resolves with the saved type; rejects, after putting the
 * stored copy back, when the server refuses or cannot be reached.
 */
export function patchType(id: Id, patch: TypePatch, options: { delay?: number } = {}): Promise<ObjectType> {
  const current = currentType(id)
  if (!current) return Promise.reject(new Error('That type is gone.'))
  let next: ObjectType
  try {
    next = applyTypePatch(clone(current), patch, new Date().toISOString())
  } catch (error) {
    return Promise.reject(error)
  }
  unsavedTypes.set(id, next)
  replaceType(next)
  const queue = queues.get(id) ?? { waiting: {}, listeners: [] }
  queues.set(id, queue)
  Object.assign(queue.waiting, patch)
  clearTimeout(queue.timer)
  const result = new Promise<ObjectType>((resolve, reject) => queue.listeners.push({ resolve, reject }))
  if (!queue.running) queue.timer = setTimeout(() => void send(id, queue), options.delay ?? 0)
  return result
}

async function send(id: Id, queue: Queue) {
  const patch = queue.waiting
  const listeners = queue.listeners
  queue.waiting = {}
  queue.listeners = []
  const run = (async () => {
    try {
      const saved = await api.patchType(id, wire(patch))
      // A later patch is waiting: the local copy is fuller than the answer. Otherwise the answer is the type.
      if (!Object.keys(queue.waiting).length) {
        unsavedTypes.delete(id)
        replaceType(saved)
      }
      for (const listener of listeners) listener.resolve(saved)
    } catch (error) {
      // What was waiting behind it was built on a change that is not saved: all of it goes.
      queue.waiting = {}
      const others = queue.listeners
      queue.listeners = []
      unsavedTypes.delete(id)
      await api.type(id).then(replaceType).catch(() => {})
      for (const listener of [...listeners, ...others]) listener.reject(error)
    }
  })()
  queue.running = run
  await run
  queue.running = undefined
  if (Object.keys(queue.waiting).length) void send(id, queue)
  else if (queues.get(id) === queue) queues.delete(id)
}

/** Edit a copy of a type's views in place and save them (rename, duplicate, add, delete a view). */
export function patchViews(type: ObjectType, change: (views: ObjectType['views']) => void, options?: { delay?: number }): Promise<ObjectType> {
  const views = clone((currentType(type.id) ?? type).views)
  change(views)
  return patchType(type.id, { views }, options)
}
