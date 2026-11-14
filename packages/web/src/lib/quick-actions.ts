// Running a task's quick actions (@vasta/core task-actions.ts) from anywhere: the buttons on a page
// or row (TaskQuickActions), a row's menu, a swipe, many selected rows at once. An action that asks
// for a value asks once (QuickAskHost, mounted in App.vue: under the element pressed, or centred
// without one or on a phone), then each object gets its own values; one notice with one Undo puts
// every object's previous values back. A day asked for another date than the due date (Defer's Do
// date) offers to move the due date too when the day is after it, so the task is not left overdue.
import { shallowRef } from 'vue'
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
  /** The day picked on the calendar at first, and the due date shown beside it (one object). */
  day: string
  due?: string
  /** The text in the box at first (one object's current value). */
  text: string
  /**
   * How many of the objects have a due date a later day could take along (a day asked for another
   * date, such as Defer's Do date; not a due date that repeats): the question offers "Move the due
   * date too", on at first.
   */
  dueMovable: number
  answer: (answer: PropertyValue | 'clear' | null, moveDue?: boolean) => void
}

export const quickAsk = shallowRef<QuickAsk | null>(null)
let asks = 0

/** The answer to an action's question: a value, 'clear' (an empty line), or null (nothing to do). */
function ask(type: ObjectType, action: QuickActionDef, objects: readonly Target[], anchor: HTMLElement | null): Promise<{ value: PropertyValue | 'clear' | null; moveDue: boolean }> {
  const asked = askOf(type, action)!
  const one = objects.length === 1 ? objects[0] : undefined
  quickAsk.value?.answer(null)
  return new Promise((resolve) => {
    quickAsk.value = {
      id: ++asks,
      action,
      def: asked.def,
      anchor,
      day: (one && dayOf(one.props[asked.def.id])) ?? dayKey(),
      due: one && asked.def.id !== DUE_PROPERTY_ID ? dayOf(one.props[DUE_PROPERTY_ID]) : undefined,
      text: one ? textOf(one.props[asked.def.id]) : '',
      // Any later day would move it: a due date there is, that does not repeat.
      dueMovable: asked.def.kind === 'date' && asked.def.id !== DUE_PROPERTY_ID ? objects.filter((o) => dueMovedTo(type, o, '9999-12-31', dayOfTime)).length : 0,
      answer: (answer, moveDue) => {
        quickAsk.value = null
        resolve({ value: answer, moveDue: !!moveDue })
      },
    }
  })
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
}

/**
 * Runs an action on one object or many: asks once if it asks, saves each object's values (four at a
 * time), then one notice with one Undo. Returns the edits saved.
 */
export async function runQuickAction(type: ObjectType, objects: Target | readonly Target[], action: QuickActionDef, options: RunOptions = {}): Promise<QuickActionEdit[]> {
  const targets = Array.isArray(objects) ? (objects as readonly Target[]) : [objects as Target]
  if (!targets.length) return []
  let run = action
  let answer: PropertyValue | undefined
  let moveDue = false
  if (askOf(type, action)) {
    const answered = await ask(type, action, targets, options.anchor ?? null)
    if (answered.value === null) return []
    if (answered.value === 'clear') run = withAskCleared(type, action)
    else answer = answered.value
    moveDue = answered.moveDue
  }
  const edits = quickActionEdits(type, targets, run, { today: dayKey(), nextWeek: nextWeekStart(), me: session.user?.id, moveDue, dayOfTime }, answer)
  if (!edits.length) return []
  const save = options.save ?? ((id: Id, values: Values) => setProperties(id, values))
  const saved: QuickActionEdit[] = []
  let failed = 0
  await eachLimited(edits, 4, async (edit) => {
    try {
      await save(edit.id, edit.values)
      saved.push(edit)
    } catch (error) {
      failed++
      lastError.value = (error as Error).message
    }
  })
  if (!saved.length) return []
  // Saved in the order given, for the message (the first one's days) and a stable Undo.
  const order = new Map(edits.map((e, i) => [e.id, i]))
  saved.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  const message = quickActionMessage(type, action, saved, { longDay, dayOfTime, due: targets.length === 1 ? targets[0]!.props[DUE_PROPERTY_ID] : undefined, failed, noun: options.noun })
  const undo = () =>
    eachLimited(saved, 4, async (edit) => {
      try {
        await save(edit.id, edit.before)
      } catch (error) {
        lastError.value = (error as Error).message
      }
    })
  const note = options.note ? options.note() : openStepsNote(type, closedBy(type, targets, saved))
  notice.value = { message: note ? `${message} · ${note}` : message, action: { label: 'Undo', run: undo } }
  return saved
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
