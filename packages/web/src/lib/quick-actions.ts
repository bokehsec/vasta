// Running a task's quick actions (@vasta/core task-actions.ts) from anywhere: the buttons on a page
// or row (TaskQuickActions), a row's menu, a swipe, many selected rows at once. An action that asks
// for a value asks once (QuickAskHost, mounted in App.vue: under the element pressed, or centred
// without one or on a phone), then each object gets its own values; one notice with one Undo puts
// every object's previous values back. A day asked for another date than the due date (Defer's Do
// date) offers to move the due date too when the day is after it, so the task is not left overdue.
// The question stays open, with what was typed or picked, until the values are saved: when nothing
// could be saved it shows why and offers Retry or Cancel; while saving it takes no second answer.
import { reactive, shallowRef } from 'vue'
import type { Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionDef } from '@vasta/core'
import { DUE_PROPERTY_ID, askOf, dueMovedTo, isClosedTask, quickActionEdits, quickActionMessage, quickActionsOf, withAskCleared, type QuickActionEdit } from '@vasta/core'
import { dayKey, setProperties } from './actions.ts'
import { nextWeekStart } from './calendar.ts'
import { formatLongDay } from './format.ts'
import type { MenuItem } from './overlays.ts'
import { session } from './session.ts'
import { lastError, notice } from './state.ts'
import { openStepsNote } from './subtasks.ts'

type Target = Pick<ObjectRecord, 'id' | 'props'>
type Values = Record<Id, PropertyValue | undefined>
/** Saves one object's values; the task page keeps its own (its editor holds a copy of the object). */
export type QuickSave = (id: Id, values: Values) => unknown

export const longDay = (day: string) => formatLongDay(`${day}T00:00:00.000Z`)
const dayOfTime = (iso: string) => dayKey(new Date(iso))

/** The day a date value falls on, here. */
export function dayOf(value: PropertyValue | undefined): string | undefined {
  if (value?.kind !== 'date') return undefined
  return value.value.resolution === 'day' ? value.value.start.slice(0, 10) : dayOfTime(value.value.start)
}

const textOf = (value: PropertyValue | undefined) => (value?.kind === 'text' || value?.kind === 'url' ? value.value : value?.kind === 'number' ? String(value.value) : '')

/** The question on screen: a day or a line of text for one property. */
export interface QuickAsk {
  /** A new one for each question, so the box starts afresh. */
  id: number
  action: QuickActionDef
  def: PropertyDef
  anchor: HTMLElement | null
  /** How many objects the answer goes to, and what to call them ("5 tasks"; for one, RunOptions.scope). */
  count: number
  scope?: string
  /** The button that saves ("Save" unless RunOptions.submitLabel). */
  submitLabel: string
  /** With a custom submit label: whether saving also closes the objects (a status the action sets), so the box can say so. */
  closes?: boolean
  /** The day picked on the calendar at first (one object's own, else none), and the due date shown beside it (one object). */
  day?: string
  due?: string
  /** The text in the box at first (one object's current value). */
  text: string
  /**
   * How many of the objects have a due date a later day could take along (a day asked for another
   * date, such as Defer's Do date; not a due date that repeats): the question offers "Move the due
   * date too", on at first.
   */
  dueMovable: number
  /** What a day would do to the due dates when they move along: how many move, and, for one object, to which day. */
  dueMoves: (day: string) => { count: number; to?: string }
  /** Whether the answer is being saved (no second one is taken), and why nothing was saved after the last try. */
  state: { saving: boolean; error: string }
  /** Saves an answer: a value, 'clear' (an empty line) or null (cancel, ignored while saving). Resolves once the question is over. */
  answer: (answer: PropertyValue | 'clear' | null, moveDue?: boolean) => Promise<void>
}

export const quickAsk = shallowRef<QuickAsk | null>(null)
let asks = 0

/** A value of the property's kind, only to find out what an action would set (whether it closes). */
const sampleAnswer = (def: PropertyDef): PropertyValue => (def.kind === 'date' ? { kind: 'date', value: { start: '2000-01-01T00:00:00.000Z', resolution: 'day' } } : def.kind === 'number' ? { kind: 'number', value: 0 } : { kind: 'text', value: 'x' })

/** The nonblank text an answer cannot be saved with, in words ("Enter a number"), if any. */
export function textProblem(def: PropertyDef, typed: string): string | undefined {
  const value = typed.trim()
  if (def.kind === 'number' && value && !Number.isFinite(Number(value.replace(',', '.')))) return `Enter a number for ${def.name}, like 3 or 2.5`
  return undefined
}

/** Turns the text typed into a value of the property's kind; null when nothing changes. */
export function textAnswer(def: PropertyDef, typed: string, initial: string, onlyChange: boolean): PropertyValue | 'clear' | null {
  const value = typed.trim()
  if (value === initial && onlyChange) return null
  if (!value) return 'clear'
  if (def.kind === 'number') {
    const number = Number(value.replace(',', '.'))
    return Number.isFinite(number) ? { kind: 'number', value: number } : null
  }
  return { kind: def.kind === 'url' ? 'url' : 'text', value }
}

/** Runs `run` over the items, at most `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export interface RunOptions {
  /** Where the question opens; without one it is centred. */
  anchor?: HTMLElement | null
  /** How each object's values are saved (default setProperties); Undo saves through it too. */
  save?: QuickSave
  /** The notice's word for several objects ("5 tasks"). */
  noun?: (count: number) => string
  /** Said after the message once saved, if anything. Default: how many steps are still open on parents just closed ("3 subtasks still open"). */
  note?: () => string | undefined
  /** The question's save button ("Save & next task" in a review); default "Save". With it the question says whether saving leaves the objects open. */
  submitLabel?: string
  /** What the question says it applies to when there is one object (its title); several are "5 tasks". */
  scope?: string
  /** Called with the edits saved, once, after the notice is up (the returned edits are the same). */
  onSaved?: (edits: QuickActionEdit[]) => void
  /** Called after Undo with the edits it put back: only the ones restored, not the ones that failed to. */
  onUndo?: (edits: QuickActionEdit[]) => void
}

/** Saves each edit (four at a time): the ones that were, how many were not, and the first reason. */
async function saveEdits(edits: readonly QuickActionEdit[], save: QuickSave) {
  const saved: QuickActionEdit[] = []
  let failed = 0
  let error = ''
  await eachLimited(edits, 4, async (edit) => {
    try {
      await save(edit.id, edit.values)
      saved.push(edit)
    } catch (error_) {
      failed++
      error ||= (error_ as Error).message || 'Could not save'
    }
  })
  // In the order given, for the message (the first one's days) and a stable Undo.
  const order = new Map(edits.map((e, i) => [e.id, i]))
  saved.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  return { saved, failed, error }
}

/**
 * Runs an action on one object or many: asks once if it asks (the question stays open until the
 * values are saved), saves each object's values (four at a time), then one notice with one Undo.
 * Returns the edits saved; nothing when cancelled or when nothing could be saved.
 */
export async function runQuickAction(type: ObjectType, objects: Target | readonly Target[], action: QuickActionDef, options: RunOptions = {}): Promise<QuickActionEdit[]> {
  const targets = Array.isArray(objects) ? (objects as readonly Target[]) : [objects as Target]
  if (!targets.length) return []
  const save = options.save ?? ((id: Id, values: Values) => setProperties(id, values))
  const context = { today: dayKey(), nextWeek: nextWeekStart(), me: session.user?.id, dayOfTime }
  /** Tells the person what was saved: the notice with its Undo (which puts back only what a try restores, once at a time). */
  const finish = (saved: QuickActionEdit[], failed: number): QuickActionEdit[] => {
    const message = quickActionMessage(type, action, saved, { longDay, dayOfTime, due: targets.length === 1 ? targets[0]!.props[DUE_PROPERTY_ID] : undefined, failed, noun: options.noun })
    let left = [...saved]
    let undoing = false
    const undo = async () => {
      if (undoing) return
      undoing = true
      const restored: QuickActionEdit[] = []
      await eachLimited(left, 4, async (edit) => {
        try {
          await save(edit.id, edit.before)
          restored.push(edit)
        } catch (error) {
          lastError.value = (error as Error).message
        }
      })
      left = left.filter((edit) => !restored.includes(edit))
      undoing = false
      if (restored.length) options.onUndo?.(saved.filter((edit) => restored.includes(edit)))
    }
    const note = options.note ? options.note() : openStepsNote(type, closedBy(type, targets, saved))
    notice.value = { message: note ? `${message} · ${note}` : message, action: { label: 'Undo', run: undo } }
    options.onSaved?.(saved)
    return saved
  }

  const asked = askOf(type, action)
  if (!asked) {
    const edits = quickActionEdits(type, targets, action, context)
    if (!edits.length) return []
    const { saved, failed, error } = await saveEdits(edits, save)
    if (failed) lastError.value = error
    return saved.length ? finish(saved, failed) : []
  }

  const one = targets.length === 1 ? targets[0] : undefined
  const dueOf = (day: string) => (object: Target) => dueMovedTo(type, object, day, dayOfTime)
  const closes = options.submitLabel ? closedBy(type, targets, quickActionEdits(type, targets, action, context, sampleAnswer(asked.def))).length > 0 : undefined
  quickAsk.value?.answer(null)
  return new Promise((resolve) => {
    const state = reactive({ saving: false, error: '' })
    const self: QuickAsk = {
      id: ++asks,
      action,
      def: asked.def,
      anchor: options.anchor ?? null,
      count: targets.length,
      scope: targets.length > 1 ? (options.noun ? options.noun(targets.length) : `${targets.length} tasks`) : options.scope,
      submitLabel: options.submitLabel ?? 'Save',
      closes,
      day: one && asked.def.kind === 'date' ? dayOf(one.props[asked.def.id]) : undefined,
      due: one && asked.def.id !== DUE_PROPERTY_ID ? dayOf(one.props[DUE_PROPERTY_ID]) : undefined,
      text: one ? textOf(one.props[asked.def.id]) : '',
      // Any later day would move it: a due date there is, that does not repeat.
      dueMovable: asked.def.kind === 'date' && asked.def.id !== DUE_PROPERTY_ID ? targets.filter((o) => dueOf('9999-12-31')(o)).length : 0,
      dueMoves: (day) => {
        const moved = targets.flatMap((o) => dueOf(day)(o) ?? [])
        return { count: moved.length, to: moved.length === 1 && one ? dayOf(moved[0]) : undefined }
      },
      state,
      answer: async (answer, moveDue) => {
        if (state.saving) return
        const over = (edits: QuickActionEdit[]) => {
          if (quickAsk.value === self) quickAsk.value = null
          resolve(edits)
        }
        if (answer === null) return over([])
        const run = answer === 'clear' ? withAskCleared(type, action) : action
        const edits = quickActionEdits(type, targets, run, { ...context, moveDue: !!moveDue }, answer === 'clear' ? undefined : answer)
        if (!edits.length) return over([])
        state.saving = true
        state.error = ''
        const { saved, failed, error } = await saveEdits(edits, save)
        state.saving = false
        // Nothing saved: the question stays, with what was typed or picked, to try again or cancel.
        if (!saved.length) {
          state.error = error || 'Could not save'
          return
        }
        if (failed) lastError.value = error
        over(finish(saved, failed))
      },
    }
    quickAsk.value = self
  })
}

/** The objects these edits closed (open before, closed by the values saved). */
function closedBy(type: ObjectType, targets: readonly Target[], saved: readonly QuickActionEdit[]): Target[] {
  const byId = new Map(targets.map((t) => [t.id, t]))
  return saved.flatMap((edit) => {
    const object = byId.get(edit.id)
    if (!object || isClosedTask(type, object)) return []
    const props = { ...object.props }
    for (const [field, value] of Object.entries(edit.values)) {
      if (value) props[field] = value
      else delete props[field]
    }
    return isClosedTask(type, { props }) ? [object] : []
  })
}

/** The quick actions of an open task as menu items (a row's menu, long-press on a phone). */
export function quickActionMenuItems(type: ObjectType | undefined, object: Target, options: RunOptions = {}): MenuItem[] {
  if (!type || isClosedTask(type, object)) return []
  return quickActionsOf(type).map((action) => ({
    label: askOf(type, action) ? `${action.name}…` : action.name,
    icon: action.icon ?? 'ph:lightning',
    run: () => runQuickAction(type, object, action, options),
  }))
}
