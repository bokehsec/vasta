// How a view hosts completion feedback (lib/completion-feedback.ts): the engine bound to the
// app's saves, the failure notice and the view's life, one way for every list that shows tasks
// (a type page, a query, a task's subtasks) and one for the two that show them as calendar
// entries (an agenda, the Calendar page, through useEntryCompletion). A task marked Done stays
// where it was, checked and struck, until the view is looked at afresh: `resetOn` is what makes it
// fresh (a string, so a new array of the same things does not clear what it should not).
import { onBeforeUnmount, provide, reactive, watch } from 'vue'
import type { CalendarEntry, Id, ObjectRecord, ObjectSummary, ObjectType } from '@vasta/core'
import { setProperties } from './actions.ts'
import { taskEntryCheckable } from './calendar-tasks.ts'
import { COMPLETION_FEEDBACK, ENTRY_COMPLETION, createCompletionFeedback, type RetainedCompletion } from './completion-feedback.ts'
import { onObjectSave } from './object-saves.ts'
import { cachedSummary, notice, typesById } from './state.ts'

export interface CompletionHost {
  /** The type to judge an object by: the view's one, or each object's own (a view spanning types). */
  type?: (object: { typeId: Id }) => ObjectType | undefined
  /** The rows the view shows now (kept completions included: an undone one reaches `observe` only if its row is still here). */
  rows: () => ObjectSummary[]
  /** Puts an object saved (or optimistically edited) in its row. */
  replace: (object: ObjectRecord | ObjectSummary) => void
  /** What makes the view fresh again: what it kept is dropped when this changes. */
  resetOn: () => string
  /** Called with a reset, for what the view keeps itself. */
  onReset?: () => void
  /** Whether saves are watched at all (a type page showing an agenda leaves that to the agenda). */
  enabled?: () => boolean
  /** What the failure notice calls the task ("task", "subtask"). */
  noun?: string
  /** Whether the engine is offered to the rows' circles (not for calendar entries, which ask through ENTRY_COMPLETION). */
  provides?: boolean
}

/** The completion engine for a list's view, wired to the saves and to the view's life. */
export function useCompletion(host: CompletionHost) {
  const completion = createCompletionFeedback({
    type: host.type ?? ((object) => typesById.value.get(object.typeId)),
    rows: host.rows,
    replace: host.replace,
    save: setProperties,
    failed: (retry) => {
      notice.value = { message: `The ${host.noun ?? 'task'} was not saved. Try again.`, action: { label: 'Retry', run: () => retry().catch(() => {}) } }
    },
  })
  if (host.provides !== false) provide(COMPLETION_FEEDBACK, completion)
  const stopSaves = onObjectSave((object, base) => (host.enabled && !host.enabled() ? undefined : completion.observe(object, base)))
  onBeforeUnmount(stopSaves)
  watch(
    host.resetOn,
    () => {
      completion.clear()
      host.onReset?.()
    },
    { flush: 'sync' }
  )
  return completion
}

/**
 * Completion feedback for calendar entries: a task marked Done in an agenda or on the Calendar
 * page saves, then its entry stays where it was through the background reloads. The view's
 * filter would drop the task, so the entry it had is kept here and merged back where it was (its
 * own times put it on its day, among its neighbours); a repeating task's entry stays at the
 * occurrence just done, its note saying the next one. Only entries shown when the completion
 * happens are kept. `selected` is what the view shows without them.
 */
export function useEntryCompletion(view: { selected: () => CalendarEntry[]; resetOn: () => string }) {
  const kept = reactive(new Map<string, CalendarEntry>())
  function replace(object: ObjectRecord | ObjectSummary) {
    if (!completion.entries.has(object.id)) return
    if ([...kept.values()].some((entry) => entry.objectId === object.id)) return
    for (const entry of view.selected()) {
      if (entry.objectId !== object.id || !taskEntryCheckable(entry, typesById.value.get(object.typeId), object)) continue
      kept.set(entry.key, { ...entry })
    }
  }
  const completion = useCompletion({
    rows: () => {
      // The summaries behind what is shown, kept completions included.
      const summaries: ObjectSummary[] = []
      const seen = new Set<Id>()
      for (const entry of [...view.selected(), ...kept.values()]) {
        if (!entry.objectId || seen.has(entry.objectId)) continue
        seen.add(entry.objectId)
        const summary = cachedSummary(entry.objectId)
        if (summary) summaries.push(summary)
      }
      return summaries
    },
    replace,
    resetOn: view.resetOn,
    onReset: () => kept.clear(),
    provides: false,
  })
  /** What a kept entry's checkbox asks: the completion it is kept for, and its Undo. */
  provide(ENTRY_COMPLETION, {
    retained: (entry: CalendarEntry): RetainedCompletion | undefined => (kept.has(entry.key) ? completion.entries.get(entry.objectId ?? '') : undefined),
    undo: (objectId: Id) => void completion.undo(objectId),
  })
  return {
    completion,
    /**
     * After a fresh feed: an entry whose task was deleted goes, and one whose completion was undone
     * (or failed) keeps its place only until the feed says where the task now is.
     */
    settle() {
      for (const [key, entry] of kept) {
        if (!entry.objectId || !cachedSummary(entry.objectId) || !completion.entries.has(entry.objectId)) kept.delete(key)
      }
      completion.prune(new Set([...kept.values()].map((entry) => entry.objectId!)))
    },
    /** The view's entries with the kept ones it no longer lists back in. */
    merge: (fresh: CalendarEntry[]) => [...fresh, ...[...kept.values()].filter((entry) => !fresh.some((one) => one.key === entry.key))],
    /** A drag moves the task on purpose: the entry a completion kept goes with it (suppressed while it saves). */
    async moving<T>(objectId: Id, run: () => Promise<T>): Promise<T> {
      for (const [key, entry] of kept) if (entry.objectId === objectId) kept.delete(key)
      return await completion.moving(objectId, run)
    },
  }
}
