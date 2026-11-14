// Subtasks: an object split into steps. A type names one single relation to itself as its parent
// field (`ObjectType.subtasks`, Type settings › Subtasks; "Part of" for tasks); an object that
// points to another through it is one of that object's steps. Lists draw the steps nested under
// their parent, its page lists them with their progress, and a parent whose steps are all closed is
// "ready to close" (never closed by itself). Nothing here writes; it reads objects as given.
import { statusProperty } from './metrics.ts'
import type { Id, ObjectRecord, ObjectType, RelationPropertyDef } from './model.ts'

type Item = Pick<ObjectRecord, 'id' | 'props'>

/** Whether an object's status (the type's select with status meanings) is one meaning done. */
function closed(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): boolean {
  const def = statusProperty(type)
  const value = def ? object.props[def.id] : undefined
  const ids = value?.kind === 'select' ? value.value : []
  return !!def?.options.some((o) => o.status === 'done' && ids.includes(o.id))
}

/** Single relations of the type that can point to an object of the type itself. */
export function eligibleParentFields(type: ObjectType): RelationPropertyDef[] {
  return type.properties.filter((p): p is RelationPropertyDef => p.kind === 'relation' && !p.multiple && (p.targetTypeIds.length === 0 || p.targetTypeIds.includes(type.id)))
}

/** The type's parent field, while it is still one of its eligible relations. */
export function parentFieldOf(type: ObjectType | undefined): RelationPropertyDef | undefined {
  const id = type?.subtasks?.parentField
  return id ? eligibleParentFields(type!).find((p) => p.id === id) : undefined
}

/** The object this one is a step of, if any. */
export function parentIdOf(type: ObjectType | undefined, object: Pick<ObjectRecord, 'props'>): Id | undefined {
  const field = parentFieldOf(type)
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'relation' ? value.value[0] : undefined
}

export interface OutlineRow<T> {
  object: T
  /** 0 for a top-level row, 1 for its steps, and so on. */
  depth: number
  /** Steps of it follow among the rows. */
  hasChildren: boolean
}

/**
 * Objects as an outline: each one's steps right after it, nested; top-level objects (no parent, or
 * one not among them) keep the order given, and so do steps among themselves. A loop of parents
 * cannot hang it: an object already placed is not placed again, and objects caught only in a loop
 * come out at the top level.
 */
export function outlineRows<T extends { id: Id }>(objects: readonly T[], parentOf: (object: T) => Id | undefined): OutlineRow<T>[] {
  const ids = new Set(objects.map((o) => o.id))
  const children = new Map<Id, T[]>()
  const roots: T[] = []
  for (const object of objects) {
    const parent = parentOf(object)
    if (parent && parent !== object.id && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), object])
    else roots.push(object)
  }
  const rows: OutlineRow<T>[] = []
  const placed = new Set<Id>()
  const place = (object: T, depth: number) => {
    if (placed.has(object.id)) return
    placed.add(object.id)
    const row: OutlineRow<T> = { object, depth, hasChildren: false }
    rows.push(row)
    for (const child of children.get(object.id) ?? []) {
      if (placed.has(child.id)) continue
      row.hasChildren = true
      place(child, depth + 1)
    }
  }
  for (const root of roots) place(root, 0)
  // Left: objects whose parents only lead around a loop.
  for (const object of objects) place(object, 0)
  return rows
}

export interface SubtaskProgress {
  done: number
  total: number
  /** It has steps, all closed, and is open itself. */
  readyToClose: boolean
}

/** How far an object's steps are: closed means a status option meaning done (Done, Dropped…). */
export function subtaskProgress(type: ObjectType | undefined, parent: Item, children: readonly Item[]): SubtaskProgress {
  const done = children.filter((c) => closed(type, c)).length
  return { done, total: children.length, readyToClose: children.length > 0 && done === children.length && !closed(type, parent) }
}

/**
 * Whether making `childId` a step of `parentId` would make a loop: the parent is the child itself or
 * one of its steps, at any depth. `parentOf` gives an object's current parent.
 */
export function wouldCycle(childId: Id, parentId: Id, parentOf: (id: Id) => Id | undefined): boolean {
  const seen = new Set<Id>()
  for (let at: Id | undefined = parentId; at; at = parentOf(at)) {
    if (at === childId) return true
    if (seen.has(at)) return false
    seen.add(at)
  }
  return false
}
