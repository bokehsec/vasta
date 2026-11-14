// Subtasks in the open space (@vasta/core subtasks.ts): for each type with a parent field, which
// objects are steps of which, kept loaded once something asks (a list nesting its rows, a page's
// Subtasks panel) and reloaded when one of the type's objects changes. Progress counts every step,
// not only those a view's filter lets through. Also the actions on steps: adding them under a
// parent (taking its selects, relations, people and tags), moving one under another, taking one out.
import { reactive } from 'vue'
import type { Id, ObjectRecord, ObjectSummary, ObjectType, PropertyValue } from '@vasta/core'
import { STATUS_PROPERTY_ID, parentFieldOf, parentIdOf, statusProperty, subtaskProgress, wouldCycle } from '@vasta/core'
import { createObject, setProperties } from './actions.ts'
import { api } from './api.ts'
import { onChange } from './events.ts'
import type { MenuItem } from './overlays.ts'
import { promptDialog } from './overlays.ts'
import { pickObject } from './pick.ts'
import { lastError, primeSummaries, typesById } from './state.ts'

interface Index {
  /** Steps of each parent, oldest first. */
  children: Map<Id, ObjectSummary[]>
  /** Each object's parent. */
  parents: Map<Id, Id>
}

/** Parents whose steps are folded in lists, for this session. */
export const foldedSteps = reactive(new Set<Id>())

/** Per type id; a type is loaded the first time something asks for it. */
const indexes = reactive(new Map<Id, Index>())
const loading = new Map<Id, Promise<void>>()

async function load(typeId: Id) {
  const type = typesById.value.get(typeId)
  if (!parentFieldOf(type)) {
    indexes.delete(typeId)
    return
  }
  const list = await api.objectsOfType(typeId)
  primeSummaries(list)
  const children = new Map<Id, ObjectSummary[]>()
  const parents = new Map<Id, Id>()
  for (const object of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const parent = parentIdOf(type, object)
    if (!parent || parent === object.id) continue
    parents.set(object.id, parent)
    children.set(parent, [...(children.get(parent) ?? []), object])
  }
  indexes.set(typeId, { children, parents })
}

/** Loads the type's steps if they are not yet; again with `fresh`. */
export function loadSubtasks(typeId: Id | undefined, fresh = false): Promise<void> {
  if (!typeId) return Promise.resolve()
  if (!fresh && (indexes.has(typeId) || loading.has(typeId))) return loading.get(typeId) ?? Promise.resolve()
  const run = load(typeId)
    .catch(() => {})
    .finally(() => loading.delete(typeId))
  loading.set(typeId, run)
  return run
}

const timers = new Map<Id, ReturnType<typeof setTimeout>>()
onChange((event) => {
  const typeId = event.kind === 'object' ? event.typeId : event.kind === 'type' ? event.id : undefined
  if (!typeId || !indexes.has(typeId)) return
  clearTimeout(timers.get(typeId))
  timers.set(typeId, setTimeout(() => void loadSubtasks(typeId, true), 300))
})

/** The steps of an object (all of them, oldest first); empty while they load. */
export function subtasksOf(type: ObjectType | undefined, id: Id): ObjectSummary[] {
  if (!type || !parentFieldOf(type)) return []
  void loadSubtasks(type.id)
  return indexes.get(type.id)?.children.get(id) ?? []
}

/** "3 subtasks still open" for parents just closed, from the steps loaded; undefined when none are (or the type has no steps). */
export function openStepsNote(type: ObjectType | undefined, closed: readonly Pick<ObjectRecord, 'id' | 'props'>[]): string | undefined {
  if (!type || !parentFieldOf(type)) return undefined
  const open = closed.reduce((sum, parent) => {
    const progress = subtaskProgress(type, parent, subtasksOf(type, parent.id))
    return sum + progress.total - progress.done
  }, 0)
  return open ? `${open} subtask${open === 1 ? '' : 's'} still open` : undefined
}

/** The parent of an object, as the index knows it. */
export function parentOf(type: ObjectType | undefined, id: Id): Id | undefined {
  return type ? indexes.get(type.id)?.parents.get(id) : undefined
}

/** Whether `parentId` can take `childId` as a step: not itself, nor one of its own steps. */
export function canBeParent(type: ObjectType | undefined, childId: Id, parentId: Id): boolean {
  return !!type && !wouldCycle(childId, parentId, (id) => parentOf(type, id))
}

/**
 * What a new step takes from its parent, so views filtered by Area or Project still show it beside
 * it: select values (not the status: the type's status select, whatever its id), relations (not the parent field), people and tags; not dates
 * or text.
 */
export function inheritedValues(type: ObjectType, parent: Pick<ObjectRecord, 'props' | 'tagIds'>): { props: Record<Id, PropertyValue>; tagIds: Id[] } {
  const field = parentFieldOf(type)
  const status = statusProperty(type)
  const props: Record<Id, PropertyValue> = {}
  for (const def of type.properties) {
    const value = parent.props[def.id]
    if (!value || def.id === field?.id || def.id === status?.id || def.id === STATUS_PROPERTY_ID) continue
    if ((def.kind === 'select' && value.kind === 'select') || (def.kind === 'relation' && value.kind === 'relation') || (def.kind === 'person' && value.kind === 'person')) props[def.id] = value
  }
  return { props, tagIds: [...parent.tagIds] }
}

/** Adds a step under a parent, titled as given; returns it. */
export async function addSubtask(type: ObjectType, parent: Pick<ObjectRecord, 'id' | 'props' | 'tagIds'>, title: string): Promise<ObjectRecord | undefined> {
  const field = parentFieldOf(type)
  if (!field || !title.trim()) return undefined
  const { props, tagIds } = inheritedValues(type, parent)
  props[field.id] = { kind: 'relation', value: [parent.id] }
  const created = await createObject(type.id, { title: title.trim(), props, tagIds }, false)
  await loadSubtasks(type.id, true)
  return created
}

/** Makes an object a step of another (`parentId`), or a top-level one (undefined). */
export async function setParent(type: ObjectType, id: Id, parentId: Id | undefined): Promise<ObjectRecord | undefined> {
  const field = parentFieldOf(type)
  if (!field || (parentId && !canBeParent(type, id, parentId))) return undefined
  const saved = await setProperties(id, { [field.id]: parentId ? { kind: 'relation', value: [parentId] } : undefined })
  await loadSubtasks(type.id, true)
  return saved
}

/** An object and every step under it, at any depth (what cannot become its parent). */
export function withDescendants(type: ObjectType, id: Id): Id[] {
  const out: Id[] = []
  const walk = (at: Id) => {
    if (out.includes(at)) return
    out.push(at)
    for (const child of indexes.get(type.id)?.children.get(at) ?? []) walk(child.id)
  }
  walk(id)
  return out
}

/**
 * A row's or page's menu items for steps: Add subtask…, Make subtask of… (a search among the type's
 * objects, leaving out the object and its own steps) and Remove from parent. `done` hears a save.
 */
export function subtaskMenuItems(type: ObjectType | undefined, object: Pick<ObjectRecord, 'id' | 'props' | 'tagIds'>, done?: (saved: ObjectRecord) => void): MenuItem[] {
  const field = parentFieldOf(type)
  if (!type || !field) return []
  void loadSubtasks(type.id)
  const run = (work: () => Promise<ObjectRecord | undefined>) => async () => {
    try {
      const saved = await work()
      if (saved) done?.(saved)
    } catch (error) {
      lastError.value = (error as Error).message
    }
  }
  const items: MenuItem[] = [
    {
      label: 'Add subtask…',
      icon: 'ph:plus',
      run: run(async () => {
        const title = await promptDialog({ title: 'Add subtask', placeholder: 'What is the next step?', confirmLabel: 'Add' })
        return title?.trim() ? addSubtask(type, object, title) : undefined
      }),
    },
    {
      label: 'Make subtask of…',
      icon: 'ph:tree-structure',
      run: run(async () => {
        const parent = await pickObject({ title: `Make a subtask of…`, typeIds: [type.id], exclude: withDescendants(type, object.id) })
        return parent ? setParent(type, object.id, parent.id) : undefined
      }),
    },
  ]
  if (parentIdOf(type, object)) items.push({ label: 'Remove from parent', icon: 'ph:arrow-elbow-up-left', run: run(() => setParent(type, object.id, undefined)) })
  return items
}
