<script setup lang="ts">
// One focused session: Review tasks (new tasks first, then those due for a check-in), or a review
// of one view. Everything about the task is on screen (its text in full, steps, the plan's fields,
// editable in place) and so are its choices (ReviewDecisionBar: what is offered is
// lib/review-choices.ts): few and never the status it already has; a task already placed has Keep
// in that status (reviewed today, back in `review.every` days); a new task has Next, Defer…, Done
// and Drop. Decide later records nothing and keeps it in the queue. On a big screen the choices sit
// under the task, the plan beside it; on a phone they are a tray at the bottom.
// The queue is stable, with Undo, explicit save, and the reading position kept across interruptions.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Doc, ObjectSummary, ObjectType, PropertyDef, PropertyValue, QuickActionDef, SelectOption } from '@vasta/core'
import { STATUS_PROPERTY_ID, askOf, daysBetween, docToPlainText, isClosedTask, lastReviewedDay, needsTriage, nextStepFieldOf, parentFieldOf, quickActionDoneName, reviewEveryOf, settlesTriage, taskDatesOf, withReviewed } from '@vasta/core'
import { addSelectOption, dayKey } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton, mainButton, quietButton } from '../lib/buttons.ts'
import type { ListField } from '../lib/columns.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle, formatDateShort } from '../lib/format.ts'
import { contextMenu } from '../lib/overlays.ts'
import { quickAsk, runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { reviewDecisions } from '../lib/review-choices.ts'
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
import ReviewDecisionBar from './ReviewDecisionBar.vue'

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
const isNew = computed(() => props.session.kind === 'tasks' && !!current.value && needsTriage(props.type, current.value))

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

// The choices (lib/review-choices.ts), which the plan beside the task shapes: it edits the next step itself.
const nextStepField = computed(() => nextStepFieldOf(props.type))
const choices = computed(() => reviewDecisions(props.type, current.value, { isNew: isNew.value, planFieldIds: plan.value.map((d) => d.id) }))
const every = computed(() => reviewEveryOf(props.type))
const currentStatus = computed(() => choices.value.currentStatus)

// What it is: new or a check-in, when it was last reviewed, when it was added.
const meta = computed(() => {
  const object = current.value
  if (!object) return { kind: '', detail: '' }
  const added = `added ${formatDateShort({ start: object.createdAt, resolution: 'day' })}`
  if (isNew.value) return { kind: 'New', detail: [currentStatus.value ? `in ${currentStatus.value.label}` : 'no status yet', added].join(' · ') }
  if (props.session.scope === 'view' && props.session.kind !== 'tasks') return { kind: '', detail: added }
  const last = lastReviewedDay(props.type, object)
  const ago = last ? daysBetween(last, dayKey()) : undefined
  const reviewedText = ago === undefined ? 'never reviewed' : ago <= 0 ? 'reviewed today' : ago === 1 ? 'reviewed yesterday' : `reviewed ${ago} days ago`
  return { kind: 'Check-in', detail: [reviewedText, added].join(' · ') }
})

// The plan now: a task's status, dates, priority, project, next step and assignee (each editable but
// the status, which the choices set); another type's fields from the view.
const PLAN = ['priority', 'project', 'assignee']
const plan = computed<PropertyDef[]>(() => {
  if (props.type.system !== 'task') return props.fields.map((f) => f.def).filter((d): d is PropertyDef => !!d && d.kind !== 'rich-text').slice(0, 6)
  const dates = taskDatesOf(props.type)
  const ids = [...new Set([STATUS_PROPERTY_ID, ...(dates.deadline ? [dates.deadline.id] : []), ...(dates.plan ? [dates.plan.id] : []), ...PLAN, ...(nextStepField.value ? [nextStepField.value.id] : [])])]
  return ids.flatMap((id) => props.type.properties.find((p) => p.id === id && p.kind !== 'rich-text') ?? [])
    .filter((d) => d.id !== 'assignee' || current.value?.props[d.id])
})
const editable = (def: PropertyDef) => def.kind !== 'formula' && !(def.id === STATUS_PROPERTY_ID && choices.value.hasButtons)
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
    const saved = await runQuickAction(props.type, object, recordsDecision ? withReviewed(props.type, action, object) : action, {
      anchor: isPhone.value ? null : anchor,
      save: props.save,
      submitLabel: stay ? 'Save' : `Save & next ${noun.value}`,
      onUndo: () => { if (recordsDecision) alive ? update((s) => undoOutcome(s, object.id, action.name)) : props.undone(object.id, action.name) },
    })
    if (!saved || !alive) return
    breakingDown.value = false
    if (recordsDecision) update((s) => recordOutcome(s, object.id, action.name, at, !stay))
  } finally {
    busy.value = false
  }
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
  const dates = taskDatesOf(props.type)
  const value = (dates.plan && step.props[dates.plan.id]) || (dates.deadline && step.props[dates.deadline.id])
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
  if (id && card.value) update((s) => ({ ...s, cards: { ...s.cards, [id]: { scrollTop: card.value!.scrollTop } } }))
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
const keepButton = () => panel.value?.querySelector<HTMLElement>('[data-process-reviewed]') ?? null
watch(() => !!quickAsk.value || contextMenu.open, async (overlay) => {
  if (overlay) return
  await nextTick()
  if (document.activeElement === document.body) (keepButton() ?? panel.value)?.focus({ preventScroll: true })
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

// Keys, while no question or text box has them: K (or R) keeps, letters and 1–9 choose (keys), →
// later, ← back, Enter opens the page, Escape pauses.
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
  if (/^[kKrR]$/.test(event.key) && choices.value.reviewed && !done.value) {
    event.preventDefault()
    void act(choices.value.reviewed, keepButton())
    return
  }
  const button = choices.value.keys.get(event.key.toLowerCase())
  if (button && !done.value) {
    event.preventDefault()
    void act(button.action, panel.value?.querySelector<HTMLElement>(`[data-key="${choices.value.keyOf(button)}"]`) ?? null)
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
  if (end > 0 && choices.value.defer) void act(choices.value.defer, null)
  else if (end < 0) skip()
}

// The buttons are at the bottom, where notices show: the notice (Undo) sits just above them instead.
const bar = ref<InstanceType<typeof ReviewDecisionBar> | null>(null)
const buttonBlock = computed(() => (bar.value?.$el as HTMLElement | undefined) ?? null)
let blockSize: ResizeObserver | undefined
function liftNotices() {
  ui.noticeLift = buttonBlock.value ? Math.max(0, Math.round(window.innerHeight - buttonBlock.value.getBoundingClientRect().top)) : 0
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
            <button v-if="isPhone && !done" class="-ml-2 grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="index === 0 || blocked" aria-label="Back to the previous task" data-process-back @click="move(-1)"><AppIcon fallback="ph:caret-left" :size="18" /></button>
            <h2 class="min-w-0 flex-1 truncate font-semibold" data-process-heading>{{ title }}<span class="font-normal text-ink-soft max-md:hidden"> · {{ session.scopeLabel }}</span></h2>
            <span class="text-sm tabular-nums text-ink-soft" aria-live="polite" data-process-position>{{ saving ? 'Saving…' : position }}</span>
            <button class="-mr-2 min-h-11 shrink-0 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-50" :disabled="blocked" :aria-label="`Pause ${title.toLowerCase()} (resume later)`" data-process-close @click="pause">{{ done ? 'Close' : 'Pause' }}</button>
          </div>
          <p class="mt-1 break-words text-xs text-ink-soft md:hidden" data-process-scope>{{ session.scopeLabel }}</p>
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

        <div v-else class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <div class="flex min-h-0 flex-1 flex-col">
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
              <p v-if="missing" class="text-sm text-ink-soft" data-process-missing>This {{ noun }} is no longer here (deleted or moved since the review started). Choose Decide later to go on.</p>
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
                  <button :class="quietButton" :disabled="blocked" data-process-open @click="open()"><AppIcon fallback="ph:arrow-square-out" :size="16" />Open page</button>
                  <button v-if="canBreakDown && !breakingDown" :class="quietButton" :disabled="blocked" data-process-break @click="startBreakDown"><AppIcon fallback="ph:tree-structure" :size="16" />Break into steps</button>
                </div>
              </template>
            </div>

            <ReviewDecisionBar ref="bar" :type="type" :choices="choices" :active="!!current" :blocked="blocked" :outcome="outcome" :noun="noun" :every="every" :at-first="index === 0" :wide="wide" @act="act" @skip="skip" @back="move(-1)" />
          </div>

          <!-- A wide screen: the plan beside the task. -->
          <aside v-if="wide" class="flex min-h-0 flex-col overflow-y-auto border-l border-line bg-raised px-5 pb-3 pt-5" data-process-side>
            <template v-if="current">
              <h3 :class="sectionName">The plan now</h3>
              <div class="mt-1" data-process-plan>
                <div v-for="def in plan" :key="def.id" class="flex min-h-10 items-center border-b border-line/70 text-sm">
                  <span class="w-24 shrink-0 truncate text-ink-soft">{{ def.name }}</span>
                  <PropertyValueEditor v-if="editable(def)" :def="def" :value="current.props[def.id]" @update="setField(def, $event)" @add-option="addOption(def, $event)" />
                  <div v-else class="flex min-h-8 min-w-0 flex-1 items-center px-2"><PropertyDisplay :def="def" :value="current.props[def.id]" :object="current" short /></div>
                </div>
              </div>
              <div class="mt-3 flex flex-col items-start">
                <button :class="quietButton" :disabled="blocked" data-process-open @click="open()"><AppIcon fallback="ph:arrow-square-out" :size="16" />Open the full page</button>
                <button v-if="canBreakDown && !breakingDown" :class="quietButton" :disabled="blocked" data-process-break @click="startBreakDown"><AppIcon fallback="ph:tree-structure" :size="16" />Break into steps</button>
              </div>
            </template>
          </aside>
        </div>
      </section>
    </div>
  </Teleport>
</template>
