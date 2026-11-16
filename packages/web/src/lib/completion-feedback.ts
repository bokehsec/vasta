import { reactive, type InjectionKey } from 'vue'
import type { CalendarEntry, Id, ObjectRecord, ObjectSummary, ObjectType, PropertyValue } from '@vasta/core'
import { isClosedTask } from '@vasta/core'
import { clone } from './clone.ts'
import type { ObjectSaveObserver } from './object-saves.ts'

type Values = Record<Id, PropertyValue | undefined>

export interface RetainedCompletion {
  before: ObjectSummary
  /** The values the completion changed, as they were: what its Undo puts back (the notice's Undo does the same). */
  restore: Values
  index: number
  pending: boolean
  repeat: boolean
}

export function createCompletionFeedback(options: {
  /** The type to judge an object by: a single-type view's one, or each object's own (a query spanning types). */
  type: (object: { typeId: Id }) => ObjectType | undefined
  rows: () => ObjectSummary[]
  replace: (object: ObjectRecord | ObjectSummary) => void
  save: (id: Id, values: Values) => Promise<unknown>
  failed: (retry: () => Promise<ObjectRecord>) => void
}) {
  const entries = reactive(new Map<Id, RetainedCompletion>())
  const placements = reactive(new Map<Id, Pick<RetainedCompletion, 'before' | 'index'>>())
  const suppressed = new Set<Id>()
  let generation = 0
  const done = (object: Pick<ObjectRecord, 'props' | 'typeId'>) => isClosedTask(options.type(object), object)
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  /** The properties `changed` has other than `from` has, as `from` had them. */
  const changes = (from: Pick<ObjectSummary, 'props'>, changed: Pick<ObjectRecord, 'props'>): Values => {
    const out: Values = {}
    for (const key of new Set([...Object.keys(from.props), ...Object.keys(changed.props)])) if (!same(from.props[key], changed.props[key])) out[key] = from.props[key] && clone(from.props[key])
    return out
  }
  const feedback = {
    entries,
    done: (object: ObjectSummary) => entries.has(object.id) || done(object),
    busy: (id: Id) => entries.get(id)?.pending ?? false,
    placement: (object: ObjectSummary) => placements.get(object.id)?.before ?? object,
    pin(rows: ObjectSummary[]) {
      const placed = rows.filter((object) => !placements.has(object.id))
      const retained = rows.filter((object) => placements.has(object.id)).sort((left, right) => placements.get(left.id)!.index - placements.get(right.id)!.index)
      for (const object of retained) placed.splice(Math.min(placements.get(object.id)!.index, placed.length), 0, object)
      return placed
    },
    /** `base`: the object as it was before this edit, when the save knows it (else the row shows it). */
    observe(object: ObjectRecord, base?: ObjectRecord): ObjectSaveObserver | undefined {
      const type = options.type(object)
      if (type?.system !== 'task' || object.typeId !== type.id || suppressed.has(object.id)) return
      const existing = entries.get(object.id)
      const rows = options.rows()
      const before = rows.find((row) => row.id === object.id)
      if (!before) return
      const undoing = existing && !done(object) && (!existing.repeat || same(object.props.due, existing.before.props.due))
      if (undoing) {
        const started = generation
        entries.delete(object.id)
        options.replace(object)
        return {
          saved: options.replace,
          failed: (retry) => {
            if (started !== generation || entries.has(object.id)) return
            entries.set(object.id, existing)
            options.replace(before)
            options.failed(retry)
          },
        }
      }
      if (existing || !done(object) || isClosedTask(type, before)) return
      const previousPlacement = placements.get(object.id)
      const entry: RetainedCompletion = { before: clone(before), restore: changes(base ?? before, object), index: rows.indexOf(before), pending: true, repeat: false }
      placements.set(object.id, previousPlacement ?? { before: clone(before), index: entry.index })
      entries.set(object.id, entry)
      const current = entries.get(object.id)!
      options.replace(object)
      return {
        saved: (saved) => {
          if (entries.get(object.id) !== current) return
          current.pending = false
          current.repeat = !done(saved) && !same(saved.props.due, current.before.props.due)
          // A repeating task's due date moved on: Undo puts it back too.
          if (current.repeat) current.restore.due = current.before.props.due && clone(current.before.props.due)
          options.replace(saved)
        },
        failed: (retry) => {
          if (entries.get(object.id) !== current) return
          entries.delete(object.id)
          if (previousPlacement) placements.set(object.id, previousPlacement)
          else placements.delete(object.id)
          options.replace(current.before)
          options.failed(retry)
        },
      }
    },
    async undo(id: Id) {
      const entry = entries.get(id)
      if (!entry || entry.pending) return
      entry.pending = true
      try {
        await options.save(id, entry.restore)
      } finally {
        if (entries.get(id) === entry) entry.pending = false
      }
    },
    clear: () => { generation++; entries.clear(); placements.clear() },
    prune(ids: Set<Id>) {
      for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id)
      for (const id of placements.keys()) if (!ids.has(id)) placements.delete(id)
    },
    async moving<T>(id: Id, run: () => Promise<T>) {
      entries.delete(id)
      placements.delete(id)
      suppressed.add(id)
      try {
        return await run()
      } finally {
        suppressed.delete(id)
      }
    },
  }
  return feedback
}

export type CompletionFeedback = ReturnType<typeof createCompletionFeedback>
export const COMPLETION_FEEDBACK: InjectionKey<CompletionFeedback> = Symbol('completion-feedback')

/**
 * What a calendar entry's checkbox asks the view that kept it after a completion (the agenda
 * layout): the completion the entry is still shown for, and its Undo. Only an agenda that keeps
 * entries provides it; the Calendar page does not, so its checkboxes work straight on the object.
 */
export interface EntryCompletion {
  /** The completion this entry is kept for, if it is (another entry of the same task is not). */
  retained: (entry: CalendarEntry) => RetainedCompletion | undefined
  undo: (objectId: Id) => void
}
export const ENTRY_COMPLETION: InjectionKey<EntryCompletion> = Symbol('entry-completion')
