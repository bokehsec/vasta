<script setup lang="ts">
// One focused session for incoming triage and periodic/view reviews. Triage edits stay unresolved
// until a status decision places the task. Reviews can keep the plan as it is. Both keep a stable
// queue, Undo, explicit save, and reading position across interruptions.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Doc, ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { askOf, docToPlainText, quickActionDoneName, holdAction, isClosedTask, nextStepFieldOf, parentFieldOf, quickActionsOf, reviewedAction, withReviewed, settlesTriage, triageDispositionActions, needsTriage } from '@vasta/core'
import { api } from '../lib/api.ts'
import { rowFields, type ListField } from '../lib/columns.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle } from '../lib/format.ts'
import { contextMenu, openMenuAt, type MenuItem } from '../lib/overlays.ts'
import { quickAsk, runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { currentId, isFinished, moveBy, recordOutcome, reviewActions, skipCurrent, skippedSession, summarize, undoOutcome, workflowTitle, type ReviewSession } from '../lib/review-session.ts'
import { lastError, ui } from '../lib/state.ts'
import { addSubtask, subtasksOf } from '../lib/subtasks.ts'
import { cardRelease, DECIDE, tracker } from '../lib/swipe.ts'
import { closesOnBack } from '../lib/back.ts'
import { isPhone, keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import DocPreview from './DocPreview.ts'
import PropertyDisplay from './PropertyDisplay.vue'

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

const triaging = computed(() => props.session.kind === 'triage')
const title = computed(() => workflowTitle(props.session))
const actions = computed(() => quickActionsOf(props.type))
const split = computed(() => reviewActions(actions.value))
const reviewed = computed(() => triaging.value ? undefined : reviewedAction(props.type))
const nextStepAction = computed(() => actions.value.find((a) => askOf(props.type, a)?.def.id === nextStepFieldOf(props.type)?.id && !!askOf(props.type, a)))
const hold = computed(() => holdAction(props.type))
/** Keys 1–9: the buttons first, then More's actions. */
const keyed = computed(() => [...split.value.featured, ...split.value.more, ...(hold.value ? [hold.value] : [])])
const rightAction = computed(() => actions.value.find((a) => a.id === 'defer'))
const noun = computed(() => props.type.name.toLowerCase())
const label = (action: QuickActionDef) => (askOf(props.type, action) ? `${action.name}…` : action.name)

const nextStep = computed(() => {
  const field = nextStepFieldOf(props.type)
  const value = field && current.value ? current.value.props[field.id] : undefined
  return value?.kind === 'text' ? value.value : ''
})
const fieldsShown = computed(() => (current.value ? rowFields(current.value, props.type, props.fields).filter((f) => f.def).slice(0, 6) : []))
const notes = computed(() => (current.value as (ObjectSummary & { preview?: string }) | undefined)?.preview ?? '')

// All of the object's text (its notes and other rich-text fields, each named but the first): the
// list holds only the start of the notes, so it is loaded, again when the object changes elsewhere.
const texts = ref<{ id: string; field: string; name?: string; doc: Doc }[]>([])
async function loadText() {
  const id = currentObjectId.value
  if (!id) return (texts.value = [])
  const full = await api.object(id).catch(() => undefined)
  if (!alive || currentObjectId.value !== id) return
  const named = new Map(props.type.properties.filter((p) => p.kind === 'rich-text').map((p) => [p.id, p.name]))
  const filled = full ? Object.entries(full.content).filter(([field, doc]) => named.has(field) && docToPlainText(doc).trim()) : []
  filled.sort(([a], [b]) => [...named.keys()].indexOf(a) - [...named.keys()].indexOf(b))
  texts.value = filled.map(([field, doc], i) => ({ id, field, name: i || field !== 'body' ? named.get(field) : undefined, doc }))
}
watch(currentObjectId, () => void loadText(), { immediate: true })
const stopChanges = onChange((event) => {
  if (event.kind === 'object' && event.id === currentObjectId.value) void loadText()
})
onBeforeUnmount(stopChanges)
const shownTexts = computed(() => texts.value.filter((t) => t.id === currentObjectId.value))
const textPreview = computed(() => shownTexts.value.length ? docToPlainText(shownTexts.value[0]!.doc).slice(0, 280) : notes.value)

/** An action that asks for a line of text (the next step) adds to the object rather than settling it: the review stays on it. */
const stays = (action: QuickActionDef) => askOf(props.type, action)?.def.kind === 'text' || (triaging.value && !settlesTriage(props.type, action))

const busy = ref(false)
async function act(action: QuickActionDef, anchor: HTMLElement | null) {
  const object = current.value
  if (!object || busy.value || addingStep.value) return
  // Reviewed on one already decided here (a next step set): nothing more to save, on to the next.
  if (action.id === 'reviewed' && outcome.value) return move(1)
  rememberCard()
  const at = index.value
  const recordsDecision = !triaging.value || settlesTriage(props.type, action)
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
function open() {
  if (!current.value || busy.value || addingStep.value) return
  rememberCard()
  emit('open', current.value.id)
}
function reviewSkipped() {
  update(skippedSession)
}

// A short footer opens the full action list. The user's configured actions remain available.
const moreButton = ref<HTMLElement | null>(null)
const menuAction = (action: QuickActionDef): MenuItem => {
  const key = keyed.value.findIndex((a) => a.id === action.id) + 1
  return { label: label(action), icon: action.icon ?? 'ph:lightning', ...(!isPhone.value && key > 0 && key <= 9 ? { hint: String(key) } : {}), run: () => act(action, moreButton.value) }
}
const moreItems = computed<MenuItem[]>(() => {
  const dispositions = triaging.value ? triageDispositionActions(props.type) : []
  const open = dispositions.filter((a) => !a.changes.some((c) => c.value.kind === 'value' && isClosedTask(props.type, { props: { [c.field]: c.value.value } })))
  const closed = dispositions.filter((a) => !open.includes(a))
  return [
    ...(open.length ? [{ kind: 'heading' as const, label: 'Move to' }, ...open.map(menuAction), { kind: 'separator' as const }] : []),
    ...actions.value.filter((a) => !open.some((d) => d.id === a.id)).map(menuAction),
    ...(!triaging.value && hold.value ? [menuAction(hold.value)] : []),
    // Completion remains available even when a custom action list omits Done/Drop.
    ...(triaging.value ? closed.filter((a) => !actions.value.some((other) => JSON.stringify(other.changes) === JSON.stringify(a.changes))).map(menuAction) : []),
    ...(canBreakDown.value ? [{ label: 'Break into steps', icon: 'ph:tree-structure', run: () => void startBreakDown() }] : []),
  ]
})
function openMore() {
  if (busy.value || !moreButton.value) return
  const box = moreButton.value.getBoundingClientRect()
  openMenuAt(box.left, box.top, moreItems.value)
}

// Break into steps (types with subtasks): an input in place; Add (or Return) adds one and keeps it open.
const canBreakDown = computed(() => !!parentFieldOf(props.type))
const breakingDown = ref(false)
const stepTitle = ref('')
const stepInput = ref<HTMLInputElement | null>(null)
const addingStep = ref(false)
const steps = computed(() => (current.value && canBreakDown.value ? subtasksOf(props.type, current.value.id) : []))
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
const notesOpen = ref(false)
let opener: HTMLElement | null = null
let app: HTMLElement | null = null
let wasInert = false
const blocked = computed(() => busy.value || addingStep.value)
function rememberCard() {
  const id = currentObjectId.value
  if (id && card.value) update((s) => ({ ...s, cards: { ...s.cards, [id]: { scrollTop: card.value!.scrollTop, notesOpen: notesOpen.value } } }))
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
  notesOpen.value = id ? props.session.cards?.[id]?.notesOpen ?? false : false
  await nextTick()
  if (card.value) card.value.scrollTop = id ? props.session.cards?.[id]?.scrollTop ?? 0 : 0
}, { immediate: true })
// Full text arrives after the card; restore a scroll position beyond the short preview then.
watch(shownTexts, async () => {
  await nextTick()
  const id = currentObjectId.value
  if (card.value && id && props.session.cards?.[id]) card.value.scrollTop = props.session.cards[id]!.scrollTop
})
watch(() => !!quickAsk.value || contextMenu.open, async (overlay) => {
  if (overlay) return
  await nextTick()
  if (document.activeElement === document.body) moreButton.value?.focus({ preventScroll: true })
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

// Keys, while no question or text box has them.
const reviewedButton = ref<HTMLButtonElement | null>(null)
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || quickAsk.value || contextMenu.open || event.metaKey || event.ctrlKey || event.altKey) return
  const typing = (event.target as Element | null)?.closest('input, textarea, [contenteditable="true"]')
  if (event.key === 'Escape') {
    event.preventDefault()
    if (typing && breakingDown.value) breakingDown.value = false
    else pause()
    return
  }
  if (event.key === 'Tab') { trapFocus(event); return }
  if (typing) return
  // Enter/Space on a button belongs to that button, not to the session shortcuts.
  if ((event.target as Element | null)?.closest('button, a') && (event.key === 'Enter' || event.key === ' ')) return
  if ((event.key === 'r' || event.key === 'R') && reviewed.value && !done.value) {
    event.preventDefault()
    void act(reviewed.value, reviewedButton.value)
    return
  }
  const number = Number(event.key)
  if (number >= 1 && number <= 9 && keyed.value[number - 1] && !done.value) {
    event.preventDefault()
    void act(keyed.value[number - 1]!, moreButton.value)
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

// A phone: swipe the card (right: Defer, left: skip), dragged a quarter of the screen or flicked
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
const actionButton = 'flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-[15px] font-medium text-ink hover:bg-hover disabled:opacity-50'
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 grid bg-black/30" :style="isPhone && keyboardInset ? { bottom: `${keyboardInset}px` } : undefined" :class="isPhone ? '' : 'place-items-center p-6'" data-process-mode>
      <section
        ref="panel"
        tabindex="-1"
        aria-modal="true"
        class="flex min-h-0 w-full flex-col overflow-hidden bg-surface outline-none"
        :class="isPhone ? 'h-full pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : 'max-h-[85vh] max-w-xl rounded-2xl border border-line shadow-2xl shadow-black/20'"
        role="dialog"
        :aria-label="title"
        :aria-busy="busy || undefined"
      >
        <header class="flex shrink-0 items-start gap-2 px-4 pt-3">
          <div class="min-w-0 flex-1 py-1">
            <h2 class="font-semibold" data-process-heading>{{ title }}</h2>
            <p class="break-words text-xs text-ink-soft">{{ session.scopeLabel ?? session.viewName }}</p>
          </div>
          <button class="min-h-11 shrink-0 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-50" :disabled="blocked" :aria-label="`Pause ${title.toLowerCase()} (resume later)`" data-process-close @click="pause">{{ done ? 'Close' : 'Pause' }}</button>
        </header>
        <div class="flex shrink-0 items-center justify-between px-4 pt-1 text-xs text-ink-soft">
          <span>{{ triaging ? 'Decide what happens next' : 'Confirm or change the plan' }}</span>
          <span class="tabular-nums" aria-live="polite" data-process-position>{{ busy ? 'Saving…' : `${done ? total : index + 1} of ${total}` }}</span>
        </div>
        <div class="mx-4 mt-2 h-[3px] shrink-0 rounded-full bg-line" aria-hidden="true">
          <div class="h-full rounded-full bg-ink-soft transition-[width] duration-200" :style="{ width: `${total ? (Math.min(index, total) / total) * 100 : 0}%` }" />
        </div>

        <!-- The end: what was decided, and what was left. -->
        <div v-if="done" class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-5 py-8 text-center" data-process-end>
          <AppIcon fallback="ph:check-circle" :size="32" class="text-[var(--color-flow-done)]" />
          <p class="text-lg font-semibold">{{ triaging ? 'Triage session finished' : 'Review session finished' }}</p>
          <p class="text-sm text-ink-soft" data-process-summary>
            <template v-if="summary.outcomes.length || summary.skipped">
              {{ [...summary.outcomes.map((o) => `${quickActionDoneName(o.name)} ${o.count}`), ...(summary.skipped ? [`${summary.skipped} left for later`] : [])].join(' · ') }}
            </template>
            <template v-else>Nothing changed</template>
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <button class="h-11 rounded-lg border border-line px-3 text-sm text-ink-soft hover:bg-hover" data-process-back @click="move(-1)">Back</button>
            <button v-if="summary.skipped" class="h-11 rounded-lg border border-line px-3 text-sm text-ink hover:bg-hover" data-process-review-skipped @click="reviewSkipped">{{ triaging ? 'Triage' : 'Review' }} {{ summary.skipped }} skipped</button>
            <button class="h-11 rounded-lg bg-ink px-4 text-sm font-medium text-surface" data-process-finish @click="emit('end')">Back to {{ session.viewName }}</button>
          </div>
        </div>

        <template v-else>
          <div
            ref="card"
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-5"
            :class="springing ? 'transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' : ''"
            :style="shift ? { transform: `translateX(${shift}px)`, opacity: String(1 - Math.min(Math.abs(shift) / 400, 0.5)) } : undefined"
            data-process-card
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
          >
            <p v-if="missing" class="text-sm text-ink-soft" data-process-missing>This {{ noun }} is no longer here (deleted or moved since the review started). Skip to go on.</p>
            <template v-else-if="current">
              <h2 class="text-[1.35rem] font-semibold leading-tight tracking-[-0.01em] break-words" data-process-title>{{ displayTitle(current, type) }}</h2>
              <p v-if="outcome" class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-hover px-2 py-0.5 text-xs text-ink-soft" data-process-outcome>
                <AppIcon fallback="ph:check" :size="12" />{{ outcome }}
              </p>
              <p v-if="nextStep" class="mt-2 flex items-center gap-1.5 text-sm text-ink-soft"><AppIcon fallback="ph:arrow-right" :size="13" class="shrink-0 text-ink-faint" />{{ nextStep }}</p>
              <div v-if="fieldsShown.length" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span v-for="field in fieldsShown" :key="field.field" class="inline-flex min-w-0 items-center gap-1"><span class="text-ink-soft">{{ field.def!.name }}:</span><PropertyDisplay :def="field.def!" :value="current.props[field.field]" :object="current" :wrap="true" short /></span>
              </div>
              <p v-if="!notesOpen && textPreview" class="mt-3 line-clamp-3 break-words text-sm leading-relaxed text-ink-soft">{{ textPreview }}</p>
              <button v-if="shownTexts.length || notes" class="mt-2 flex min-h-11 items-center gap-2 rounded-lg text-sm text-ink-soft hover:text-ink" :aria-expanded="notesOpen" data-process-notes-toggle @click="notesOpen = !notesOpen"><AppIcon :fallback="notesOpen ? 'ph:caret-down' : 'ph:caret-right'" :size="14" />{{ notesOpen ? 'Collapse notes' : 'Read full notes' }}</button>
              <div v-if="notesOpen && shownTexts.length" class="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft" data-process-text>
                <div v-for="text in shownTexts" :key="text.field" class="space-y-1">
                  <p v-if="text.name" class="text-xs font-medium text-ink-faint">{{ text.name }}</p>
                  <DocPreview :content="text.doc.content" />
                </div>
              </div>
              <p v-else-if="notesOpen && notes" class="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{{ notes }}</p>
              <button class="mt-2 flex min-h-11 items-center gap-1 text-sm text-accent hover:underline" :disabled="blocked" data-process-open @click="open">Open details<AppIcon fallback="ph:caret-right" :size="13" /></button>
              <p v-if="steps.length" class="mt-1 text-xs text-ink-faint">{{ steps.length }} {{ steps.length === 1 ? 'step' : 'steps' }}</p>
              <form v-if="breakingDown" class="mt-3 space-y-2" @submit.prevent="addStep">
                <div class="flex items-center gap-2 rounded-lg border border-line px-2.5">
                  <AppIcon fallback="ph:plus" :size="16" class="text-ink-faint" />
                  <input ref="stepInput" v-model="stepTitle" class="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-faint max-md:text-base" placeholder="A step" aria-label="New step" data-process-step />
                </div>
                <div class="flex justify-end gap-2">
                  <button type="button" class="h-10 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover" data-process-step-done @click="breakingDown = false">Done adding</button>
                  <button type="submit" class="h-10 rounded-lg bg-ink px-4 text-sm font-medium text-surface disabled:opacity-50" :disabled="!stepTitle.trim() || addingStep" data-process-step-add>{{ addingStep ? 'Adding…' : 'Add step' }}</button>
                </div>
              </form>
            </template>
          </div>

          <!-- Two choices, followed by quiet navigation. Full-size targets leave room to read. -->
          <div ref="buttonBlock" class="shrink-0 border-t border-line px-4 pb-2 pt-3">
            <div v-if="current" class="grid grid-cols-2 gap-2">
              <button v-if="reviewed" ref="reviewedButton" class="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2 text-[15px] font-medium text-surface hover:opacity-90 disabled:opacity-50"
                :class="!moreItems.length ? 'col-span-full' : ''" :disabled="blocked" data-process-reviewed @click="act(reviewed, $event.currentTarget as HTMLElement)">
                <span>{{ outcome ? 'Next task' : 'Keep as is & next' }}</span>
              </button>
              <button v-if="triaging && nextStepAction" :class="actionButton" :disabled="blocked" :data-process-action="nextStepAction.id" @click="act(nextStepAction, $event.currentTarget as HTMLElement)">
                <AppIcon fallback="ph:pencil-simple-line" :size="18" class="shrink-0" /><span>{{ label(nextStepAction) }}</span>
              </button>
              <button v-if="moreItems.length" ref="moreButton" :class="[actionButton, triaging ? 'bg-ink !text-surface hover:!bg-ink/90' : '', !reviewed && !(triaging && nextStepAction) ? 'col-span-full' : '']" :disabled="blocked" aria-haspopup="menu" data-process-more @click="openMore">
                {{ triaging ? 'Decide…' : 'Change plan…' }}<AppIcon fallback="ph:caret-down" :size="14" class="shrink-0" />
              </button>
              <p v-if="triaging && !outcome && !needsTriage(type, current)" class="col-span-full text-xs text-ink-soft">This task has already been organised. Skip it or choose a new plan.</p>
            </div>
            <div class="mt-1 flex justify-between">
              <button class="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="index === 0 || blocked" data-process-back @click="move(-1)"><AppIcon fallback="ph:caret-left" :size="14" />Back</button>
              <button class="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="blocked" data-process-skip @click="skip">{{ outcome ? 'Next' : 'Skip for now' }}<AppIcon fallback="ph:caret-right" :size="14" /></button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
