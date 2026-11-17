// Running a task's quick actions (@vasta/core task-actions.ts) from anywhere: the buttons on a page
// or row (TaskQuickActions), a row's menu, a swipe, a circle, a board drop. The runner takes one
// object. An action that asks for a value asks once (QuickAskHost, mounted in App.vue: under the
// element pressed, or centred without one or on a phone); then the object is saved and one notice
// with one Undo puts its previous values back. A day asked for another date than the deadline
// (Defer's Do date) offers to move the deadline too when the day is after it, so the task is not
// left overdue. The question stays open, with what was typed or picked, until the values are saved:
// when nothing could be saved it shows why and offers Retry or Cancel; while saving it takes no
// second answer. Without a question a failed save says so (lastError) and shows no notice.
// An action that closes a task with open subtasks asks once whether to close them too (with Done, or
// Drop for a dropped parent); the notice's one Undo then puts the parent and its subtasks back.
// swipeActionsFor is the one swipe set-up every touch row has (lists, subtasks).
import { reactive, shallowRef } from 'vue'
import type { DateValue, Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionDef } from '@vasta/core'
import { askOf, closingOf, deadlineMovedTo, doneOptionOf, dropOptionOf, endsRepeat, isClosedTask, plainStatusAction, quickActionEdit, quickActionMessage, quickActionsOf, statusActionOf, taskDatesOf, withAskCleared, type QuickActionContext, type QuickActionEdit } from '@vasta/core'
import { dayKey, setProperties } from './actions.ts'
import { dayOfValue, nextWeekStart, viewerTimeZone } from './calendar.ts'
import { formatLongDay } from './format.ts'
import { choiceDialog, type MenuItem } from './overlays.ts'
import { session } from './session.ts'
import { lastError, notice } from './state.ts'
import { openStepsOf } from './subtasks.ts'
import type { SwipeAction } from './swipe.ts'

/** An object an action runs on; its title, when given, names it in the question (a row's Defer). */
type Target = Pick<ObjectRecord, 'id' | 'props'> & { title?: string }
type Values = Record<Id, PropertyValue | undefined>
/** Saves one object's values; the task page keeps its own (its editor holds a copy of the object). */
export type QuickSave = (id: Id, values: Values) => unknown

export const longDay = (day: string) => formatLongDay(`${day}T00:00:00.000Z`)
/** The day a date property's value falls on, here. */
export const dayOf = (value: PropertyValue | undefined): string | undefined => (value?.kind === 'date' ? dayOfValue(value.value) : undefined)

/** Moves one occurrence of a repeating date (core calendar.ts); its rule parser loads only for an object that has a date that repeats. */
async function loadOccurrenceMover(): Promise<NonNullable<QuickActionContext['moveOccurrence']>> {
  const { moveOccurrenceTo } = await import('@vasta/core/calendar')
  const timeZone = viewerTimeZone()
  return (value: DateValue, day: string) => moveOccurrenceTo(value, day, timeZone)
}
const hasRepeatingDate = (object: Target) => Object.values(object.props).some((v) => v.kind === 'date' && v.value.rrule)

const textOf = (value: PropertyValue | undefined) => (value?.kind === 'text' || value?.kind === 'url' ? value.value : value?.kind === 'number' ? String(value.value) : '')

/** The question on screen: a day or a line of text for one property. */
export interface QuickAsk {
  /** A new one for each question, so the box starts afresh. */
  id: number
  action: QuickActionDef
  def: PropertyDef
  anchor: HTMLElement | null
  /** What the question says it applies to (RunOptions.scope: by default the object's title). */
  scope?: string
  /** The button that saves ("Save" unless RunOptions.submitLabel). */
  submitLabel: string
  /** With a custom submit label: whether saving also closes the object (a status the action sets), so the box can say so. */
  closes?: boolean
  /** The day picked on the calendar at first (the object's own, else none), and the deadline shown beside it. */
  day?: string
  due?: string
  /** The text in the box at first (the object's current value). */
  text: string
  /**
   * Whether a later day could take the deadline along (a day asked for another date, such as
   * Defer's Do date, and a deadline that does not repeat): the question offers "Move the due
   * date too", off at first so deadlines stay put unless explicitly moved.
   */
  dueMovable: boolean
  /** The day the deadline would move to when the day picked is after it; undefined when it stays. */
  dueMoves: (day: string) => string | undefined
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

export interface RunOptions {
  /** Where the question opens; without one it is centred. */
  anchor?: HTMLElement | null
  /** How the values are saved (default setProperties); Undo saves through it too. */
  save?: QuickSave
  /** The question's save button ("Save & next task" in a review); default "Save". With it the question says whether saving leaves the task open. */
  submitLabel?: string
  /** What the question says it applies to (default the object's title, if given; '' for nothing). */
  scope?: string
  /** Called with the edit saved, once, after the notice is up. */
  onSaved?: (edit: QuickActionEdit) => void
  /** Called after Undo has put the values back. */
  onUndo?: (edit: QuickActionEdit) => void
}

/** Saves each edit in turn: the ones that were, and the first reason one was not. */
async function saveEach(edits: readonly QuickActionEdit[], save: QuickSave) {
  const saved: QuickActionEdit[] = []
  let error = ''
  for (const edit of edits) {
    try {
      await save(edit.id, edit.values)
      saved.push(edit)
    } catch (error_) {
      error ||= (error_ as Error).message || 'Could not save'
    }
  }
  return { saved, error }
}

/**
 * Runs an action on an object: asks once if it asks (the question stays open until the values are
 * saved), saves them, then one notice with one Undo. Returns the edit saved; nothing when cancelled
 * or when it could not be saved.
 */
export async function runQuickAction(type: ObjectType, target: Target, action: QuickActionDef, options: RunOptions = {}): Promise<QuickActionEdit | undefined> {
  const save = options.save ?? ((id: Id, values: Values) => setProperties(id, values))
  const dates = taskDatesOf(type)
  const deadlineId = dates.deadline?.id
  const moveOccurrence = hasRepeatingDate(target) ? await loadOccurrenceMover() : undefined
  const context: QuickActionContext = { today: dayKey(), nextWeek: nextWeekStart(), me: session.user?.id, timeZone: viewerTimeZone(), ...(moveOccurrence ? { moveOccurrence } : {}) }
  let completed: QuickActionEdit | undefined
  let stepsClosed: QuickActionEdit[] = []
  let undoing = false
  /** Tells the person what was saved: the notice with its Undo (which puts back only what a try restores, once at a time). */
  const finish = async (saved: QuickActionEdit): Promise<QuickActionEdit> => {
    completed = saved
    const steps = await closeOpenSteps(type, closedBy(type, target, saved), target, context)
    stepsClosed.push(...steps.closed)
    const message = quickActionMessage(type, action, saved, { longDay, timeZone: context.timeZone, due: deadlineId ? target.props[deadlineId] : undefined })
    const undo = async () => {
      if (undoing) return
      undoing = true
      const restoring = completed
      if (restoring) {
        try {
          await save(restoring.id, restoring.before)
          completed = undefined
        } catch (error) {
          lastError.value = (error as Error).message
        }
      }
      // The subtasks closed with it: each puts its status back as the parent's own save did.
      const back: QuickActionEdit[] = []
      for (const edit of stepsClosed) {
        try {
          await setProperties(edit.id, edit.before)
          back.push(edit)
        } catch (error) {
          lastError.value = (error as Error).message
        }
      }
      stepsClosed = stepsClosed.filter((edit) => !back.includes(edit))
      undoing = false
      if (restoring && !completed) options.onUndo?.(restoring)
    }
    const note = steps.left ? `${count(steps.left)} still open` : steps.closed.length ? `${count(steps.closed.length)} closed too` : undefined
    notice.value = { message: note ? `${message} · ${note}` : message, action: { label: 'Undo', run: undo } }
    options.onSaved?.(saved)
    return saved
  }

  const asked = askOf(type, action)
  if (!asked) {
    const edit = quickActionEdit(type, target, action, context)
    if (!edit) return undefined
    try {
      await save(edit.id, edit.values)
    } catch (error) {
      lastError.value = (error as Error).message || 'Could not save'
      return undefined
    }
    return finish(edit)
  }

  const dueMoves = (day: string) => dayOf(deadlineMovedTo(type, target, day, context.timeZone))
  const closes = options.submitLabel ? closedBy(type, target, quickActionEdit(type, target, action, context, sampleAnswer(asked.def))) !== undefined : undefined
  quickAsk.value?.answer(null)
  return new Promise((resolve) => {
    const state = reactive({ saving: false, error: '' })
    const self: QuickAsk = {
      id: ++asks,
      action,
      def: dates.plan?.id === asked.def.id ? { ...asked.def, name: 'Planned for' } : asked.def,
      anchor: options.anchor ?? null,
      scope: options.scope ?? (target.title || undefined),
      submitLabel: options.submitLabel ?? 'Save',
      closes,
      day: asked.def.kind === 'date' ? dayOf(target.props[asked.def.id]) : undefined,
      due: deadlineId && asked.def.id !== deadlineId ? dayOf(target.props[deadlineId]) : undefined,
      text: textOf(target.props[asked.def.id]),
      // Any later day would move it: a deadline there is, that does not repeat.
      dueMovable: asked.def.kind === 'date' && asked.def.id !== deadlineId && !!dueMoves('9999-12-31'),
      dueMoves,
      state,
      answer: async (answer, moveDue) => {
        if (state.saving) return
        const over = (edit?: QuickActionEdit) => {
          if (quickAsk.value === self) quickAsk.value = null
          resolve(edit)
        }
        if (answer === null) return over()
        const run = answer === 'clear' ? withAskCleared(type, action) : action
        const edit = quickActionEdit(type, target, run, { ...context, moveDue: !!moveDue }, answer === 'clear' ? undefined : answer)
        if (!edit) return over()
        state.saving = true
        state.error = ''
        try {
          await save(edit.id, edit.values)
        } catch (error) {
          // The question stays, with what was typed or picked, to try again or cancel.
          state.saving = false
          state.error = (error as Error).message || 'Could not save'
          return
        }
        state.saving = false
        // The question is over before a follow-up one (open subtasks) is asked.
        if (quickAsk.value === self) quickAsk.value = null
        resolve(await finish(edit))
      },
    }
    quickAsk.value = self
  })
}

/**
 * How the object was closed by these values (open before, closed by the values saved): Done, or
 * dropped; none for a task done that repeats, which goes on to its next occurrence, still open. A
 * page may have changed the object itself by now, so its values before are the edit's own.
 */
function closedBy(type: ObjectType, object: Target, saved: QuickActionEdit | undefined): 'done' | 'dropped' | undefined {
  if (!saved) return undefined
  const withValues = (props: Target['props'], values: QuickActionEdit['values']) => {
    const out = { ...props }
    for (const [field, value] of Object.entries(values)) {
      if (value) out[field] = value
      else delete out[field]
    }
    return out
  }
  const before = withValues(object.props, saved.before)
  if (isClosedTask(type, { props: before }) || endsRepeat(type, { props: before }, saved.values)) return undefined
  return closingOf(type, { props: withValues(before, saved.values) })
}

const count = (n: number) => `${n} subtask${n === 1 ? '' : 's'}`

/** What closes the subtasks of a parent closed as `closing`: Done, or Drop for a dropped one; an action that asks gives way to the plain status, as nothing is asked here. */
function stepAction(type: ObjectType, closing: 'done' | 'dropped'): QuickActionDef | undefined {
  const option = (closing === 'dropped' ? dropOptionOf(type) : undefined) ?? doneOptionOf(type)
  const own = option && statusActionOf(type, option)
  return own && option && askOf(type, own) ? plainStatusAction(type, option) : own
}

/**
 * Asks once whether to close the open subtasks of a parent just closed, and closes them if so.
 * Returns the edits saved and how many subtasks stay open (left open, or not saved).
 */
async function closeOpenSteps(type: ObjectType, closing: 'done' | 'dropped' | undefined, parent: Target, context: QuickActionContext) {
  const open = closing ? await openStepsOf(type, parent.id) : []
  if (!closing || !open.length) return { closed: [] as QuickActionEdit[], left: 0 }
  const answer = await choiceDialog({
    title: `Close its ${open.length === 1 ? 'open subtask' : `${open.length} open subtasks`} too?`,
    choices: [{ value: 'close', label: 'Close them too' }, { value: 'leave', label: 'Leave open' }],
  })
  if (answer !== 'close') return { closed: [] as QuickActionEdit[], left: open.length }
  const action = stepAction(type, closing)
  const edits = action ? open.flatMap((step) => quickActionEdit(type, step, action, context) ?? []) : []
  const { saved, error } = await saveEach(edits, (id, values) => setProperties(id, values))
  if (error) lastError.value = error
  return { closed: saved, left: open.length - saved.length }
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

/**
 * The swipes every touch row has (lists, subtasks): right runs the type's Defer, else its first
 * action; left uncovers up to three others, Done first, then More (`menu`: the row's own menu, from
 * the button's corner). None for a type without actions.
 */
export function swipeActionsFor(type: ObjectType, object: Target, options: { save: QuickSave; menu: (event: MouseEvent) => void }): { right?: SwipeAction; left: SwipeAction[] } {
  const actions = quickActionsOf(type)
  const right = actions.find((a) => a.id === 'defer') ?? actions[0]
  if (!right) return { left: [] }
  const make = (action: QuickActionDef): SwipeAction => ({
    id: action.id,
    label: action.name,
    icon: action.icon,
    tone: action.id === 'done' ? 'done' : action.id === 'defer' ? 'accent' : 'neutral',
    run: () => runQuickAction(type, object, action, { save: options.save }),
  })
  const more: SwipeAction = {
    id: 'more',
    label: 'More',
    icon: { kind: 'icon', value: 'ph:dots-three' },
    tone: 'more',
    run: (anchor) => {
      const box = anchor?.getBoundingClientRect()
      options.menu(new MouseEvent('contextmenu', { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 }))
    },
  }
  const rest = actions.filter((a) => a !== right).sort((a, b) => Number(b.id === 'done') - Number(a.id === 'done'))
  return { right: make(right), left: [...rest.slice(0, 3).map(make), more] }
}
