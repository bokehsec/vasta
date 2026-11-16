<script setup lang="ts">
// One focused session: Review tasks (new tasks first, then those due for a check-in), or a review
// of one view. Everything about the task is on screen (its text in full, steps, the plan's fields,
// editable in place) and so is every choice: the statuses it can go to, and for a task already
// placed, Keep (the plan is right: reviewed today, back in `reviewEvery` days) or Later (nothing
// recorded; it stays in the queue). A new task has no Keep: it needs a place. The queue is stable,
// with Undo, explicit save, and the reading position kept across interruptions.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Doc, ObjectSummary, ObjectType, PropertyDef, PropertyValue, QuickActionDef, SelectOption } from '@vasta/core'
import { DUE_PROPERTY_ID, STATUS_PROPERTY_ID, askOf, daysBetween, docToPlainText, isClosedTask, lastReviewedDay, needsTriage, nextStepFieldOf, parentFieldOf, quickActionDoneName, quickActionsOf, reviewChoices, reviewEveryOf, reviewedAction, settlesTriage, statusProperty, withReviewed } from '@vasta/core'
import { addSelectOption, dayKey } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
import type { ListField } from '../lib/columns.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle, formatDateShort } from '../lib/format.ts'
import { contextMenu } from '../lib/overlays.ts'
import { quickAsk, runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { currentId, isFinished, moveBy, recordOutcome, skipCurrent, skippedSession, summarize, undoOutcome, workflowTitle, type ReviewSession } from '../lib/review-session.ts'
import { lastError, ui } from '../lib/state.ts'
import { addSubtask, subtasksOf } from '../lib/subtasks.ts'
import { cardRelease, DECIDE, tracker } from '../lib/swipe.ts'
import { closesOnBack } from '../lib/back.ts'
import { isPhone, keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import DocPreview from './DocPreview.ts'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'

/** `undone`: Undo of a decision, which may come from the notice after the review has closed. */
const props = defineProps<{ type: ObjectType; objects: ObjectSummary[]; fields: ListField[]; session: ReviewSession; save: QuickSave; undone: (id: string, name: string) => void }>()
const emit = defineEmits<{
  'update:session': [session: ReviewSession]
  /** Closed for now: the session stays, to resume. */
  close: []
  /** Finished with: the session is forgotten. */
  end: []
  /** Open an object's page; coming back returns here. */
  open: [id: string]
}>()

// The latest session, also between an action's start and its end (the prop follows a tick later).
let latest = props.session
watch(() => props.session, (session) => (latest = session))
function update(change: (session: ReviewSession) => ReviewSession) {
  latest = change(latest)
  emit('update:session', latest)
}

// Gone (closed, ended): an action or Undo still under way no longer moves this review.
let alive = true
onBeforeUnmount(() => (alive = false))

const byId = computed(() => new Map(props.objects.map((o) => [o.id, o])))
const total = computed(() => props.session.ids.length)
const index = computed(() => props.session.index)
const done = computed(() => isFinished(props.session))
const currentObjectId = computed(() => currentId(props.session))
const current = computed(() => (currentObjectId.value ? byId.value.get(currentObjectId.value) : undefined))
/** The object at this place is gone (deleted since the review started). */
const missing = computed(() => !done.value && !current.value)
const outcome = computed(() => (currentObjectId.value ? props.session.outcomes[currentObjectId.value] : undefined))
const title = computed(() => workflowTitle(props.session))
const noun = computed(() => props.type.name.toLowerCase())

/** This one is new (no status, or an incoming one): it needs a place, so there is no Keep. */
const isNew = computed(() => props.session.kind === 'triage' || (props.session.kind === 'tasks' && !!current.value && needsTriage(props.type, current.value)))

// Where it is: a Review tasks session counts its new tasks and its check-ins apart.
const newCount = computed(() => props.session.kind === 'tasks' ? Math.min(props.session.newCount ?? 0, total.value) : 0)
const parts = computed(() => {
  if (props.session.kind !== 'tasks') return [{ label: '', size: total.value, at: Math.min(index.value, total.value) }]
  return [
    { label: 'New', size: newCount.value, at: Math.min(index.value, newCount.value) },
    { label: 'Check-ins', size: total.value - newCount.value, at: Math.max(0, Math.min(index.value, total.value) - newCount.value) },
  ].filter((p) => p.size)
})
const position = computed(() => {
  if (done.value) return `${total.value} of ${total.value}`
  if (props.session.kind !== 'tasks') return `${index.value + 1} of ${total.value}`
  return index.value < newCount.value ? `New ${index.value + 1} of ${newCount.value}` : `Check-in ${index.value - newCount.value + 1} of ${total.value - newCount.value}`
})

// The choices. A task type: its statuses (reviewChoices), the current one marked, then any other
// quick actions of its own. Another type (a view's review): its quick actions.
const actions = computed(() => quickActionsOf(props.type))
const status = computed(() => statusProperty(props.type))
// A choice's notice and the end's totals say where tasks went: "Moved to Next", "Done".
const choices = computed(() => reviewChoices(props.type).map((c) => ({ option: c.option, action: { ...c.action, name: c.option.status === 'done' ? c.option.label : `Moved to ${c.option.label}` } })))
const choiceLabel = (choice: { option: SelectOption; action: QuickActionDef }) => askOf(props.type, choice.action) ? `${choice.option.label}…` : choice.option.label
const currentStatus = computed<SelectOption | undefined>(() => {
  const value = status.value && current.value ? current.value.props[status.value.id] : undefined
  const id = value?.kind === 'select' ? value.value[0] : undefined
  return id ? status.value?.options.find((o) => o.id === id) : undefined
})
const nextStepField = computed(() => nextStepFieldOf(props.type))
const extras = computed(() => {
  const used = new Set(choices.value.map((c) => c.action.id))
  return actions.value.filter((a) => !used.has(a.id) && !(askOf(props.type, a)?.def.id === nextStepField.value?.id && plan.value.some((d) => d.id === nextStepField.value?.id)))
})
const reviewed = computed(() => (isNew.value ? undefined : reviewedAction(props.type)))
/** Keys 1–9: the choices, then the others. */
const keyed = computed(() => [...choices.value.map((c) => c.action), ...extras.value])
const keyOf = (action: QuickActionDef) => {
  const key = keyed.value.findIndex((a) => a.id === action.id) + 1
  return key > 0 && key <= 9 ? String(key) : ''
}
const rightAction = computed(() => actions.value.find((a) => a.id === 'defer'))
const label = (action: QuickActionDef) => (askOf(props.type, action) ? `${action.name}…` : action.name)
const tone = (option: SelectOption) => option.status !== 'done' ? '' : choices.value.find((c) => c.option.status === 'done')?.option.id === option.id ? 'text-[var(--color-flow-done)]' : 'text-red-600 dark:text-red-400'
const every = computed(() => reviewEveryOf(props.type))
const keepLabel = computed(() => outcome.value ? `Next ${noun.value}` : currentStatus.value ? `Keep in ${currentStatus.value.label}` : 'Keep as it is')
const keepHint = computed(() => outcome.value ? 'Decided. Go on to the next one.' : every.value ? `Marks it reviewed today. It comes back in ${every.value} ${every.value === 1 ? 'day' : 'days'}.` : 'Marks it reviewed today.')
const laterHint = 'Not reviewed; it stays in the queue.'

// What it is: new or a check-in, when it was last reviewed, when it was added.
const meta = computed(() => {
  const object = current.value
  if (!object) return { kind: '', detail: '' }
  const added = `added ${formatDateShort({ start: object.createdAt, resolution: 'day' })}`
  if (isNew.value) return { kind: 'New', detail: [currentStatus.value ? `in ${currentStatus.value.label}` : 'no status yet', added].join(' · ') }
  if (props.session.scope === 'view') return { kind: '', detail: added }
  const last = lastReviewedDay(props.type, object)
  const ago = last ? daysBetween(last, dayKey()) : undefined
  const reviewedText = ago === undefined ? 'never reviewed' : ago <= 0 ? 'reviewed today' : ago === 1 ? 'reviewed yesterday' : `reviewed ${ago} days ago`
  return { kind: props.session.kind === 'tasks' || props.session.kind === 'review' ? 'Check-in' : '', detail: [reviewedText, added].join(' · ') }
})

// The plan now: a task's status, dates, priority, project, next step and assignee (each editable but
// the status, which the choices set); another type's fields from the view.
const PLAN = [STATUS_PROPERTY_ID, DUE_PROPERTY_ID, 'priority', 'project', 'assignee']
const plan = computed<PropertyDef[]>(() => {
  if (props.type.system !== 'task') return props.fields.map((f) => f.def).filter((d): d is PropertyDef => !!d && d.kind !== 'rich-text').slice(0, 6)
  const deferField = props.type.quickActions?.deferField
  const ids = [...new Set([STATUS_PROPERTY_ID, DUE_PROPERTY_ID, ...(deferField ? [deferField] : []), ...PLAN.slice(2), ...(nextStepField.value ? [nextStepField.value.id] : [])])]
  return ids.flatMap((id) => props.type.properties.find((p) => p.id === id && p.kind !== 'rich-text') ?? [])
    .filter((d) => d.id !== 'assignee' || current.value?.props[d.id])
})
const editable = (def: PropertyDef) => def.kind !== 'formula' && !(def.id === STATUS_PROPERTY_ID && choices.value.length)
async function setField(def: PropertyDef, value: PropertyValue | undefined) {
  const object = current.value
  if (!object) return
  try {
    await props.save(object.id, { [def.id]: value })
  } catch (error) {
    lastError.value = (error as Error).message
  }
}
async function addOption(def: PropertyDef, option: SelectOption) {
  await addSelectOption(props.type, def.id, option)
}

// All of the object's text (its notes and other rich-text fields, each named but the first): the
// list holds only the start of the notes, so it is loaded, again when the object changes elsewhere.
const texts = ref<{ id: string; field: string; name?: string; doc: Doc }[]>([])
const notes = computed(() => current.value?.preview ?? '')
async function loadText() {
  const id = currentObjectId.value
  if (!id) return (texts.value = [])
  const full = await api.object(id).catch(() => undefined)
  if (!alive || currentObjectId.value !== id) return
  const named = new Map(props.type.properties.filter((p) => p.kind === 'rich-text').map((p) => [p.id, p.name]))
  const filled = full ? Object.entries(full.content).filter(([field, doc]) => named.has(field) && docToPlainText(doc).trim()) : []
  filled.sort(([a], [b]) => [...named.keys()].indexOf(a) - [...named.keys()].indexOf(b))
  texts.value = filled.map(([field, doc]) => ({ id, field, name: named.get(field), doc }))
}
watch(currentObjectId, () => void loadText(), { immediate: true })
const stopChanges = onChange((event) => {
  if (event.kind === 'object' && event.id === currentObjectId.value) void loadText()
})
onBeforeUnmount(stopChanges)
const shownTexts = computed(() => texts.value.filter((t) => t.id === currentObjectId.value))

/** An action that asks for a line of text (the next step) adds to the object rather than settling it: the review stays on it. */
const stays = (action: QuickActionDef) => askOf(props.type, action)?.def.kind === 'text' || (isNew.value && !settlesTriage(props.type, action))

const busy = ref(false)
const saving = computed(() => busy.value && (!quickAsk.value || quickAsk.value.state.saving))
async function act(action: QuickActionDef, anchor: HTMLElement | null) {
  const object = current.value
  if (!object || busy.value || addingStep.value) return
  // Keep on one already decided here (a next step set): nothing more to save, on to the next.
  if (action.id === 'reviewed' && outcome.value) return move(1)
  rememberCard()
  const at = index.value
  const recordsDecision = !isNew.value || settlesTriage(props.type, action)
  const stay = stays(action)
  busy.value = true
  try {
    const saved = await runQuickAction(props.type, object, recordsDecision ? withReviewed(props.type, action) : action, {
      anchor: isPhone.value ? null : anchor,
      save: props.save,
      submitLabel: stay ? 'Save' : `Save & next ${noun.value}`,
      onUndo: () => { if (recordsDecision) alive ? update((s) => undoOutcome(s, object.id, action.name)) : props.undone(object.id, action.name) },
    })
    if (!saved.length || !alive) return
    breakingDown.value = false
    if (recordsDecision) update((s) => recordOutcome(s, object.id, action.name, at, !stay))
  } finally {
    busy.value = false
  }
}
/** A status choice. The status it already has, on a task already placed, is Keep. */
function choose(action: QuickActionDef, option: SelectOption, anchor: HTMLElement | null) {
  if (reviewed.value && option.id === currentStatus.value?.id && !askOf(props.type, action)) return act(reviewed.value, anchor)
  return act(action, anchor)
}
function move(delta: number) {
  if (busy.value || addingStep.value) return
  rememberCard()
  breakingDown.value = false
  update((s) => moveBy(s, delta))
}
function skip() {
  if (done.value || busy.value || addingStep.value) return
  rememberCard()
  breakingDown.value = false
  update(skipCurrent)
}
function open(id = current.value?.id) {
  if (!id || busy.value || addingStep.value) return
  rememberCard()
  emit('open', id)
}
function reviewSkipped() {
  update(skippedSession)
}

// Steps (types with subtasks): listed in full, each opens; Break into steps adds them in place.
const canBreakDown = computed(() => !!parentFieldOf(props.type))
const breakingDown = ref(false)
const stepTitle = ref('')
const stepInput = ref<HTMLInputElement | null>(null)
const addingStep = ref(false)
const steps = computed(() => (current.value && canBreakDown.value ? subtasksOf(props.type, current.value.id) : []))
const stepDate = (step: ObjectSummary) => {
  const value = step.props[props.type.quickActions?.deferField ?? ''] ?? step.props[DUE_PROPERTY_ID]
  return value?.kind === 'date' ? formatDateShort(value.value) : ''
}
async function startBreakDown() {
  breakingDown.value = true
  await nextTick()
  stepInput.value?.focus()
}
async function addStep() {
  const object = current.value
  if (!object || !stepTitle.value.trim() || addingStep.value) return
  addingStep.value = true
  try {
    await addSubtask(props.type, { ...object, tagIds: object.tagIds }, stepTitle.value)
    stepTitle.value = ''
    stepInput.value?.focus()
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    addingStep.value = false
  }
}

// Keep the app behind the session out of the focus order; teleported questions/menus and Undo
// stay usable. Focus returns to the entry when the session closes.
const panel = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
let app: HTMLElement | null = null
let wasInert = false
const blocked = computed(() => busy.value || addingStep.value)
function rememberCard() {
  const id = currentObjectId.value
  if (id && card.value) update((s) => ({ ...s, cards: { ...s.cards, [id]: { scrollTop: card.value!.scrollTop, notesOpen: true } } }))
}
function pause() {
  if (blocked.value) return
  rememberCard()
  emit('close')
}
// Back on a phone pauses the review here instead of leaving the list under it.
closesOnBack(() => true, pause)
function trapFocus(event: KeyboardEvent) {
  if (!panel.value) return
  const elements = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'), ...document.querySelectorAll<HTMLElement>('[role="status"] button:not(:disabled)')].filter((e) => e.getClientRects().length)
  const at = elements.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && at <= 0) { event.preventDefault(); elements.at(-1)?.focus() }
  else if (!event.shiftKey && (at < 0 || at === elements.length - 1)) { event.preventDefault(); elements[0]?.focus() }
}
watch(currentObjectId, async (id) => {
  await nextTick()
  if (card.value) card.value.scrollTop = id ? props.session.cards?.[id]?.scrollTop ?? 0 : 0
}, { immediate: true })
// Full text arrives after the card; restore a scroll position beyond the short preview then.
watch(shownTexts, async () => {
  await nextTick()
  const id = currentObjectId.value
  if (card.value && id && props.session.cards?.[id]) card.value.scrollTop = props.session.cards[id]!.scrollTop
})
const keepButton = ref<HTMLButtonElement | null>(null)
watch(() => !!quickAsk.value || contextMenu.open, async (overlay) => {
  if (overlay) return
  await nextTick()
  if (document.activeElement === document.body) (keepButton.value ?? panel.value)?.focus({ preventScroll: true })
})
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  app = document.getElementById('app')
  if (app) { wasInert = app.inert; app.inert = true }
  panel.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  if (app) app.inert = wasInert
  void nextTick(() => {
    const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-process-resume], [data-workflows], main header button[title="More"]')
    target?.focus({ preventScroll: true })
  })
})

// Keys, while no question or text box has them: K (or R) keeps, 1–9 choose, → later, ← back,
// Enter opens the page, Escape pauses.
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || quickAsk.value || contextMenu.open || event.metaKey || event.ctrlKey || event.altKey) return
  if ((event.target as Element | null)?.closest('[data-overlay]')) return
  const typing = (event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')
  if (event.key === 'Escape') {
    event.preventDefault()
    if (typing && breakingDown.value) breakingDown.value = false
    else if (typing) (typing as HTMLElement).blur()
    else pause()
    return
  }
  if (event.key === 'Tab') { trapFocus(event); return }
  if (typing) return
  // Enter/Space on a button belongs to that button, not to the session shortcuts.
  if ((event.target as Element | null)?.closest('button, a') && (event.key === 'Enter' || event.key === ' ')) return
  if (/^[kKrR]$/.test(event.key) && reviewed.value && !done.value) {
    event.preventDefault()
    void act(reviewed.value, keepButton.value)
    return
  }
  const number = Number(event.key)
  const action = number >= 1 && number <= 9 ? keyed.value[number - 1] : undefined
  if (action && !done.value) {
    event.preventDefault()
    const choice = choices.value.find((c) => c.action.id === action.id)
    const anchor = panel.value?.querySelector<HTMLElement>(`[data-key="${number}"]`) ?? null
    void (choice ? choose(action, choice.option, anchor) : act(action, anchor))
  } else if (event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault()
    skip()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter' && !done.value) {
    event.preventDefault()
    open()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// A phone: swipe the card (right: Defer, left: later), dragged a quarter of the screen or flicked
// (lib/swipe.ts). As in SwipeRow the direction is decided after 10px and kept: a mostly vertical
// move scrolls, and a scroll that drifts sideways does not swipe.
let touch: { x: number; y: number; direction?: 'x' | 'y' } | undefined
const shift = ref(0)
const springing = ref(false)
const speed = tracker()
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function onTouchStart(event: TouchEvent) {
  const t = event.touches[0]
  shift.value = 0
  springing.value = false
  if (blocked.value || (event.target as Element | null)?.closest('button, a, input, textarea, [contenteditable]')) { touch = undefined; return }
  touch = t && event.touches.length === 1 && t.clientX > 24 ? { x: t.clientX, y: t.clientY } : undefined
  speed.reset()
  if (touch) speed.add(touch.x)
}
function onTouchMove(event: TouchEvent) {
  const t = event.touches[0]
  if (!touch || !t) return
  const dx = t.clientX - touch.x
  const dy = t.clientY - touch.y
  if (!touch.direction) {
    if (Math.abs(dy) > DECIDE && Math.abs(dy) >= Math.abs(dx)) touch.direction = 'y'
    else if (Math.abs(dx) > DECIDE) touch.direction = 'x'
    else return
  }
  if (touch.direction === 'x') {
    shift.value = dx
    speed.add(t.clientX)
  }
}
/** The browser took the touch (a scroll, a system gesture): no swipe. */
function onTouchCancel() {
  shift.value = 0
  touch = undefined
}
function onTouchEnd() {
  const dx = touch?.direction === 'x' ? shift.value : 0
  const end = cardRelease(dx, speed.velocity(), window.innerWidth)
  // A card that stays springs back; one that goes is replaced by the next.
  springing.value = end === 0 && dx !== 0 && !reducedMotion
  shift.value = 0
  touch = undefined
  if (end > 0 && rightAction.value) void act(rightAction.value, null)
  else if (end < 0) skip()
}

// On a phone the buttons are where notices show: the notice (Undo) sits just above them instead.
const buttonBlock = ref<HTMLElement | null>(null)
let blockSize: ResizeObserver | undefined
function liftNotices() {
  ui.noticeLift = isPhone.value && buttonBlock.value ? Math.max(0, Math.round(window.innerHeight - buttonBlock.value.getBoundingClientRect().top)) : 0
}
watch([buttonBlock, isPhone], ([block]) => {
  blockSize?.disconnect()
  if (block && typeof ResizeObserver !== 'undefined') (blockSize = new ResizeObserver(liftNotices)).observe(block)
  liftNotices()
})
onBeforeUnmount(() => {
  blockSize?.disconnect()
  ui.noticeLift = 0
})

const summary = computed(() => summarize(props.session))
const wide = computed(() => !isPhone.value)
const sectionName = 'text-xs font-semibold text-ink-faint'
const choiceButton = 'flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-sm hover:bg-hover disabled:opacity-50 aria-pressed:border-line-strong aria-pressed:bg-hover'
const phoneChoice = 'flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-surface px-1 text-[13px] active:bg-hover disabled:opacity-50 aria-pressed:border-line-strong aria-pressed:bg-hover'
const quiet = 'flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-soft hover:bg-hover hover:text-ink disabled:opacity-40'
const kbd = 'ml-auto rounded border border-line-strong px-1.5 py-0.5 text-[11px] leading-none text-ink-faint'
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 grid" :style="isPhone && keyboardInset ? { bottom: `${keyboardInset}px` } : undefined" :class="isPhone ? 'bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : 'place-items-center bg-black/30 p-6'" data-process-mode>
      <section
        ref="panel"
        tabindex="-1"
        aria-modal="true"
        class="flex min-h-0 w-full flex-col overflow-hidden bg-surface outline-none"
        :class="isPhone ? 'h-full' : 'h-[min(54rem,100%)] max-w-[76rem] rounded-2xl border border-line shadow-2xl shadow-black/20'"
        role="dialog"
        :aria-label="title"
        :aria-busy="saving || undefined"
      >
        <!-- Which review, where in it (new and check-ins apart), and Pause. -->
        <header class="shrink-0 border-b border-line px-4 pb-3 pt-3 md:px-6">
          <div class="flex items-center gap-2">
            <h2 class="min-w-0 flex-1 truncate font-semibold" data-process-heading>{{ title }}<span class="font-normal text-ink-soft max-md:hidden"> · {{ session.scopeLabel ?? session.viewName }}</span></h2>
            <span class="text-sm tabular-nums text-ink-soft" aria-live="polite" data-process-position>{{ saving ? 'Saving…' : position }}</span>
            <button class="-mr-2 min-h-11 shrink-0 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-50" :disabled="blocked" :aria-label="`Pause ${title.toLowerCase()} (resume later)`" data-process-close @click="pause">{{ done ? 'Close' : 'Pause' }}</button>
          </div>
          <div class="mt-2 flex items-center gap-1.5" aria-hidden="true">
            <template v-for="part in parts" :key="part.label">
              <span v-if="part.label && wide" class="whitespace-nowrap pr-1 text-xs tabular-nums text-ink-soft">{{ part.label }} {{ part.at }}/{{ part.size }}</span>
              <span class="h-1 min-w-6 rounded-full bg-line" :style="{ flexGrow: part.size }"><span class="block h-full rounded-full bg-ink-soft transition-[width] duration-200" :style="{ width: `${part.size ? (part.at / part.size) * 100 : 0}%` }" /></span>
            </template>
          </div>
        </header>

        <!-- The end: what was decided, and what was left. -->
        <div v-if="done" class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-5 py-8 text-center" data-process-end>
          <AppIcon fallback="ph:check-circle" :size="32" class="text-[var(--color-flow-done)]" />
          <p class="text-lg font-semibold">{{ title }}: finished</p>
          <p class="text-sm text-ink-soft" data-process-summary>
            <template v-if="summary.outcomes.length || summary.skipped">
              {{ [...summary.outcomes.map((o) => `${quickActionDoneName(o.name)} ${o.count}`), ...(summary.skipped ? [`${summary.skipped} left for later`] : [])].join(' · ') }}
            </template>
            <template v-else>Nothing changed</template>
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <button :class="greyButton" data-process-back @click="move(-1)">Back</button>
            <button v-if="summary.skipped" :class="greyButton" data-process-review-skipped @click="reviewSkipped">Review {{ summary.skipped }} left for later</button>
            <button :class="mainButton" data-process-finish @click="emit('end')">Back to {{ session.viewName }}</button>
          </div>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
          <!-- The task: what it is, the plan (a phone), its text in full, its steps. -->
          <div
            ref="card"
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 md:px-10 md:pt-7"
            :class="springing ? 'transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' : ''"
            :style="shift ? { transform: `translateX(${shift}px)`, opacity: String(1 - Math.min(Math.abs(shift) / 400, 0.5)) } : undefined"
            data-process-card
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
          >
            <p v-if="missing" class="text-sm text-ink-soft" data-process-missing>This {{ noun }} is no longer here (deleted or moved since the review started). Choose Later to go on.</p>
            <template v-else-if="current">
              <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft md:text-sm" data-process-meta>
                <span v-if="meta.kind" class="rounded-md px-1.5 py-0.5 font-semibold" :class="isNew ? 'bg-accent/12 text-accent' : 'bg-hover text-ink'">{{ meta.kind }}</span>
                <span>{{ meta.detail }}</span>
              </p>
              <h2 class="mt-2 max-w-[34ch] break-words text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] md:text-[1.75rem]" data-process-title>{{ displayTitle(current, type) }}</h2>
              <p v-if="outcome" class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-hover px-2 py-0.5 text-xs text-ink-soft" data-process-outcome>
                <AppIcon fallback="ph:check" :size="12" />{{ quickActionDoneName(outcome) }}
              </p>

              <!-- A phone: the plan here, two fields to a row; a wide screen has it beside the text. -->
              <div v-if="isPhone && plan.length" class="mt-3 grid grid-cols-2 gap-x-3" data-process-plan>
                <div v-for="def in plan" :key="def.id" class="min-w-0 border-b border-line py-1">
                  <p class="text-xs text-ink-soft">{{ def.name }}</p>
                  <PropertyValueEditor v-if="editable(def)" :def="def" :value="current.props[def.id]" class="-ml-2" @update="setField(def, $event)" @add-option="addOption(def, $event)" />
                  <div v-else class="flex min-h-8 items-center"><PropertyDisplay :def="def" :value="current.props[def.id]" :object="current" short /></div>
                </div>
              </div>

              <div v-if="shownTexts.length" class="mt-5 space-y-5" data-process-text>
                <section v-for="text in shownTexts" :key="text.field" class="max-w-[70ch]">
                  <h3 :class="sectionName">{{ text.name }}</h3>
                  <div class="vasta-doc mt-1 text-[15px] leading-relaxed [&_p+p]:mt-2.5"><DocPreview :content="text.doc.content" /></div>
                </section>
              </div>
              <p v-else-if="notes" class="mt-5 max-w-[70ch] whitespace-pre-line text-[15px] leading-relaxed">{{ notes }}</p>

              <section v-if="steps.length || breakingDown" class="mt-6 max-w-[70ch]" data-process-steps>
                <h3 :class="sectionName">Steps · {{ steps.length }}</h3>
                <ul class="mt-1">
                  <li v-for="step in steps" :key="step.id" class="border-b border-line">
                    <button class="flex min-h-11 w-full items-center gap-2.5 text-left text-sm hover:text-accent" :disabled="blocked" @click="open(step.id)">
                      <AppIcon :fallback="isClosedTask(type, step) ? 'ph:check-circle' : 'ph:circle'" :size="16" class="shrink-0" :class="isClosedTask(type, step) ? 'text-[var(--color-flow-done)]' : 'text-ink-faint'" />
                      <span class="min-w-0 flex-1 truncate" :class="isClosedTask(type, step) ? 'text-ink-faint line-through' : ''">{{ displayTitle(step, type) }}</span>
                      <span v-if="stepDate(step)" class="shrink-0 text-xs tabular-nums text-ink-soft">{{ stepDate(step) }}</span>
                    </button>
                  </li>
                </ul>
              </section>
              <form v-if="breakingDown" class="mt-3 max-w-[70ch] space-y-2" @submit.prevent="addStep">
                <div class="flex items-center gap-2 rounded-lg border border-line px-2.5">
                  <AppIcon fallback="ph:plus" :size="16" class="text-ink-faint" />
                  <input ref="stepInput" v-model="stepTitle" class="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-faint max-md:text-base" placeholder="A step" aria-label="New step" data-process-step />
                </div>
                <div class="flex justify-end gap-2">
                  <button type="button" :class="greyButton" data-process-step-done @click="breakingDown = false">Done adding</button>
                  <button type="submit" :class="mainButton" :disabled="!stepTitle.trim() || addingStep" data-process-step-add>{{ addingStep ? 'Adding…' : 'Add step' }}</button>
                </div>
              </form>

              <div class="mt-4 flex flex-wrap gap-x-2" :class="isPhone ? '-ml-2' : 'md:hidden'">
                <button :class="quiet" :disabled="blocked" data-process-open @click="open()"><AppIcon fallback="ph:arrow-square-out" :size="16" />Open page</button>
                <button v-if="canBreakDown && !breakingDown" :class="quiet" :disabled="blocked" data-process-break @click="startBreakDown"><AppIcon fallback="ph:tree-structure" :size="16" />Break into steps</button>
                <button v-for="action in isPhone && choices.length ? extras : []" :key="action.id" :class="quiet" :disabled="blocked" :data-process-action="action.id" @click="act(action, $event.currentTarget as HTMLElement)"><AppIcon :icon="action.icon" fallback="ph:lightning" :size="16" />{{ label(action) }}</button>
              </div>
            </template>
          </div>

          <!-- A wide screen: the plan and every choice in a column beside the text. -->
          <aside v-if="wide" ref="buttonBlock" class="flex min-h-0 flex-col overflow-y-auto border-line bg-raised px-5 pb-3 pt-5 max-md:border-t md:border-l" data-process-choices>
            <template v-if="current">
              <h3 :class="sectionName">The plan now</h3>
              <div class="mt-1 mb-5" data-process-plan>
                <div v-for="def in plan" :key="def.id" class="flex min-h-9 items-center border-b border-line/70 text-sm">
                  <span class="w-24 shrink-0 truncate text-ink-soft">{{ def.name }}</span>
                  <PropertyValueEditor v-if="editable(def)" :def="def" :value="current.props[def.id]" @update="setField(def, $event)" @add-option="addOption(def, $event)" />
                  <div v-else class="flex min-h-8 min-w-0 flex-1 items-center px-2"><PropertyDisplay :def="def" :value="current.props[def.id]" :object="current" short /></div>
                </div>
              </div>

              <template v-if="reviewed">
                <button ref="keepButton" :class="[mainButton, 'min-h-12 w-full justify-start px-3.5 text-[15px]']" :disabled="blocked" data-process-reviewed @click="act(reviewed, $event.currentTarget as HTMLElement)">
                  <AppIcon fallback="ph:check" :size="18" class="shrink-0" /><span class="min-w-0 flex-1 truncate text-left">{{ keepLabel }}</span><kbd v-if="!outcome" class="rounded border border-surface/35 px-1.5 py-0.5 text-[11px] leading-none text-surface/75">K</kbd>
                </button>
                <p class="mb-4 mt-1.5 px-0.5 text-xs leading-snug text-ink-soft" data-process-keep-hint>{{ keepHint }}</p>
              </template>
              <h3 :class="[sectionName, 'mb-1.5']">{{ isNew ? 'Where does it go?' : reviewed ? 'Or change it' : 'Decide' }}</h3>
              <div class="grid grid-cols-2 gap-1.5">
                <button v-for="choice in choices" :key="choice.option.id" :class="choiceButton" :disabled="blocked" :aria-pressed="!isNew && choice.option.id === currentStatus?.id" :data-key="keyOf(choice.action)" :data-process-choice="choice.option.id" @click="choose(choice.action, choice.option, $event.currentTarget as HTMLElement)">
                  <AppIcon :icon="choice.action.icon" fallback="ph:arrow-right" :size="17" class="shrink-0" :class="tone(choice.option)" />
                  <span class="min-w-0 truncate">{{ choiceLabel(choice) }}</span>
                  <span v-if="!isNew && choice.option.id === currentStatus?.id" class="ml-auto text-[11px] text-ink-faint">now</span>
                  <kbd v-else-if="keyOf(choice.action)" :class="kbd">{{ keyOf(choice.action) }}</kbd>
                </button>
                <button v-for="action in extras" :key="action.id" :class="choiceButton" :disabled="blocked" :data-key="keyOf(action)" :data-process-action="action.id" @click="act(action, $event.currentTarget as HTMLElement)">
                  <AppIcon :icon="action.icon" fallback="ph:lightning" :size="17" class="shrink-0" />
                  <span class="min-w-0 truncate">{{ label(action) }}</span>
                  <kbd v-if="keyOf(action)" :class="kbd">{{ keyOf(action) }}</kbd>
                </button>
              </div>
              <div class="mt-3 flex flex-col items-start">
                <button :class="quiet" :disabled="blocked" data-process-open @click="open()"><AppIcon fallback="ph:arrow-square-out" :size="16" />Open the full page</button>
                <button v-if="canBreakDown && !breakingDown" :class="quiet" :disabled="blocked" data-process-break @click="startBreakDown"><AppIcon fallback="ph:tree-structure" :size="16" />Break into steps</button>
              </div>
            </template>
            <div class="mt-auto flex items-start justify-between gap-2 border-t border-line pt-2">
              <button :class="quiet" :disabled="index === 0 || blocked" data-process-back @click="move(-1)"><AppIcon fallback="ph:caret-left" :size="14" />Back</button>
              <div class="text-right">
                <button :class="[quiet, 'ml-auto font-medium text-ink']" :disabled="blocked" data-process-skip @click="skip">{{ outcome ? 'Next' : 'Decide later' }}<AppIcon fallback="ph:caret-right" :size="14" /></button>
                <p v-if="!outcome" class="px-2 text-[11px] leading-snug text-ink-faint">{{ laterHint }}</p>
              </div>
            </div>
          </aside>

          <!-- A phone: every choice in a tray within reach of the thumb. -->
          <div v-else ref="buttonBlock" class="shrink-0 border-t border-line px-3.5 pb-2 pt-2.5" data-process-choices>
            <template v-if="current">
              <div v-if="reviewed" class="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <button ref="keepButton" :class="[mainButton, 'min-h-12 min-w-0']" :disabled="blocked" data-process-reviewed @click="act(reviewed, $event.currentTarget as HTMLElement)">
                  <AppIcon fallback="ph:check" :size="18" class="shrink-0" /><span class="truncate">{{ keepLabel }}</span>
                </button>
                <button :class="[greyButton, 'min-h-12']" :disabled="blocked" data-process-skip @click="skip">{{ outcome ? 'Next' : 'Later' }}<AppIcon fallback="ph:caret-right" :size="14" /></button>
              </div>
              <p class="py-1.5 text-center text-xs text-ink-soft" data-process-keep-hint>
                <template v-if="reviewed && !outcome">Keep: reviewed, back in {{ every }} {{ every === 1 ? 'day' : 'days' }} · Later: stays in the queue</template>
                <template v-else-if="reviewed">{{ keepHint }}</template>
                <template v-else-if="isNew">Where does it go?</template>
                <template v-else>Decide</template>
              </p>
              <div class="grid grid-cols-3 gap-1.5">
                <button v-for="choice in choices" :key="choice.option.id" :class="phoneChoice" :disabled="blocked" :aria-pressed="!isNew && choice.option.id === currentStatus?.id" :data-process-choice="choice.option.id" @click="choose(choice.action, choice.option, $event.currentTarget as HTMLElement)">
                  <AppIcon :icon="choice.action.icon" fallback="ph:arrow-right" :size="20" :class="tone(choice.option)" />
                  <span class="max-w-full truncate">{{ choice.option.label }}</span>
                </button>
                <template v-if="!choices.length">
                  <button v-for="action in extras" :key="action.id" :class="phoneChoice" :disabled="blocked" :data-process-action="action.id" @click="act(action, $event.currentTarget as HTMLElement)">
                    <AppIcon :icon="action.icon" fallback="ph:lightning" :size="20" />
                    <span class="max-w-full truncate">{{ action.name }}</span>
                  </button>
                </template>
              </div>
            </template>
            <div class="mt-1 flex justify-between">
              <button :class="quiet" :disabled="index === 0 || blocked" data-process-back @click="move(-1)"><AppIcon fallback="ph:caret-left" :size="14" />Back</button>
              <button v-if="!reviewed" :class="quiet" :disabled="blocked" data-process-skip @click="skip">{{ outcome ? 'Next' : 'Later' }}<AppIcon fallback="ph:caret-right" :size="14" /></button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
