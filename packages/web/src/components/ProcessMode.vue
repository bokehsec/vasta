<script setup lang="ts">
// Review: a view's open objects one at a time, in the order fixed when the review started
// (lib/review-session.ts, kept on this device). Each shows its place ("3 of 48"), title, next step,
// the view's row fields, the start of its notes and Open details; three buttons run the type's main
// quick actions (Done, Defer, the next step: lib/quick-actions.ts, a question first if the action
// asks, then the next object) and More holds the rest (Drop, other actions, Break into steps). Skip
// and Back move without changing anything. The object is always shown as it is now (`objects`, the
// type's live list), so Undo or a change on its page shows here. Keys: 1–9 the actions, → or Space
// skip, ← back, Return open, Escape close. On a phone it fills the screen with the buttons at the
// bottom; a swipe right runs Defer (as on rows), a swipe left skips. The end counts each object
// once, by its last decision (Undo takes it off), and the skipped ones apart.
// One action at a time: while one saves (or its question is open) further keys, taps and swipes,
// Skip and Back do nothing, and the move on is from the object the action was run on.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { askOf, nextStepFieldOf, parentFieldOf, quickActionsOf } from '@vasta/core'
import { rowFields, type ListField } from '../lib/columns.ts'
import { displayTitle } from '../lib/format.ts'
import { openMenuAt, type MenuItem } from '../lib/overlays.ts'
import { quickAsk, runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { currentId, isFinished, moveBy, recordOutcome, reviewActions, skipCurrent, skippedSession, summarize, undoOutcome, type ReviewSession } from '../lib/review-session.ts'
import { lastError, ui } from '../lib/state.ts'
import { addSubtask, subtasksOf } from '../lib/subtasks.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
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

const actions = computed(() => quickActionsOf(props.type))
const split = computed(() => reviewActions(actions.value))
/** Keys 1–9: the buttons first, then More's actions. */
const keyed = computed(() => [...split.value.featured, ...split.value.more])
const rightAction = computed(() => actions.value.find((a) => a.id === 'defer') ?? actions.value[0])
const noun = computed(() => props.type.name.toLowerCase())
const label = (action: QuickActionDef) => (askOf(props.type, action) ? `${action.name}…` : action.name)

const nextStep = computed(() => {
  const field = nextStepFieldOf(props.type)
  const value = field && current.value ? current.value.props[field.id] : undefined
  return value?.kind === 'text' ? value.value : ''
})
const fieldsShown = computed(() => (current.value ? rowFields(current.value, props.type, props.fields).filter((f) => f.def).slice(0, 6) : []))
const notes = computed(() => {
  const text = (current.value as (ObjectSummary & { preview?: string }) | undefined)?.preview ?? ''
  return text.length > 280 ? `${text.slice(0, 280).trimEnd()}…` : text
})

const busy = ref(false)
async function act(action: QuickActionDef, anchor: HTMLElement | null) {
  const object = current.value
  if (!object || busy.value) return
  const at = index.value
  busy.value = true
  try {
    const saved = await runQuickAction(props.type, object, action, {
      anchor: isPhone.value ? null : anchor,
      save: props.save,
      submitLabel: `Save & next ${noun.value}`,
      onUndo: () => (alive ? update((s) => undoOutcome(s, object.id, action.name)) : props.undone(object.id, action.name)),
    })
    if (!saved.length || !alive) return
    breakingDown.value = false
    update((s) => recordOutcome(s, object.id, action.name, at))
  } finally {
    busy.value = false
  }
}
function move(delta: number) {
  if (busy.value) return
  breakingDown.value = false
  update((s) => moveBy(s, delta))
}
function skip() {
  if (done.value || busy.value) return
  breakingDown.value = false
  update(skipCurrent)
}
function open() {
  if (current.value && !busy.value) emit('open', current.value.id)
}
function reviewSkipped() {
  update(skippedSession)
}

// More: the other actions, and Break into steps.
const moreButton = ref<HTMLElement | null>(null)
const moreItems = computed<MenuItem[]>(() => [
  ...split.value.more.map((action) => ({ label: label(action), icon: action.icon ?? 'ph:lightning', run: () => act(action, moreButton.value) })),
  ...(canBreakDown.value ? [{ label: 'Break into steps', icon: 'ph:tree-structure', run: () => void startBreakDown() }] : []),
])
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

// Keys, while no question or text box has them.
const buttons = ref<HTMLButtonElement[]>([])
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || quickAsk.value || event.metaKey || event.ctrlKey || event.altKey) return
  const typing = (event.target as Element | null)?.closest('input, textarea, [contenteditable="true"]')
  if (event.key === 'Escape') {
    event.preventDefault()
    if (typing && breakingDown.value) breakingDown.value = false
    else emit('close')
    return
  }
  if (typing) return
  const number = Number(event.key)
  if (number >= 1 && number <= 9 && keyed.value[number - 1] && !done.value) {
    event.preventDefault()
    void act(keyed.value[number - 1]!, buttons.value[number - 1] ?? moreButton.value)
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

// A phone: swipe the card (right: Defer, left: skip). As in SwipeRow the direction is decided after
// 10px and kept: a mostly vertical move scrolls, and a scroll that drifts sideways does not swipe.
const DECIDE = 10
let touch: { x: number; y: number; direction?: 'x' | 'y' } | undefined
const shift = ref(0)
function onTouchStart(event: TouchEvent) {
  const t = event.touches[0]
  shift.value = 0
  touch = t && event.touches.length === 1 && t.clientX > 24 ? { x: t.clientX, y: t.clientY } : undefined
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
  if (touch.direction === 'x') shift.value = dx
}
/** The browser took the touch (a scroll, a system gesture): no swipe. */
function onTouchCancel() {
  shift.value = 0
  touch = undefined
}
function onTouchEnd() {
  const dx = touch?.direction === 'x' ? shift.value : 0
  shift.value = 0
  touch = undefined
  const width = window.innerWidth
  if (dx > width * 0.35 && rightAction.value) void act(rightAction.value, null)
  else if (dx < -width * 0.35) skip()
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
const plural = computed(() => props.type.pluralName.toLowerCase())
const actionButton = 'flex h-12 min-w-0 items-center justify-center gap-2 rounded-xl border border-line px-2 text-[15px] font-medium text-ink hover:bg-hover disabled:opacity-50'
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 grid bg-black/30" :class="isPhone ? '' : 'place-items-center p-6'" data-process-mode>
      <section
        class="flex w-full flex-col bg-surface"
        :class="isPhone ? 'h-full pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : 'max-h-[85vh] max-w-xl rounded-2xl border border-line shadow-2xl shadow-black/20'"
        role="dialog"
        :aria-label="`Review ${session.viewName}`"
        :aria-busy="busy || undefined"
      >
        <header class="flex items-center gap-2 px-2 pt-2">
          <button class="grid h-11 w-11 place-items-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink" aria-label="Close review (you can resume it)" title="Close (Esc): resume later" data-process-close @click="emit('close')">
            <AppIcon fallback="ph:x" :size="18" />
          </button>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold">Review</p>
            <p class="truncate text-xs text-ink-faint">{{ session.viewName }}</p>
          </div>
          <span class="px-3 text-sm tabular-nums text-ink-faint" aria-live="polite" data-process-position>{{ busy ? 'Saving…' : `${done ? total : index + 1} of ${total}` }}</span>
        </header>
        <div class="mx-4 mt-1 h-[3px] rounded-full bg-line" aria-hidden="true">
          <div class="h-full rounded-full bg-ink-soft transition-[width] duration-200" :style="{ width: `${total ? (Math.min(index, total) / total) * 100 : 0}%` }" />
        </div>

        <!-- The end: what was decided, and what was left. -->
        <div v-if="done" class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center" data-process-end>
          <AppIcon fallback="ph:check-circle" :size="32" class="text-[var(--color-flow-done)]" />
          <p class="text-lg font-semibold">Review finished</p>
          <p class="text-sm text-ink-soft" data-process-summary>
            <template v-if="summary.outcomes.length || summary.skipped">
              {{ [...summary.outcomes.map((o) => `${o.name} ${o.count}`), ...(summary.skipped ? [`${summary.skipped} skipped, unchanged`] : [])].join(' · ') }}
            </template>
            <template v-else>Nothing changed</template>
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <button class="h-11 rounded-lg border border-line px-3 text-sm text-ink-soft hover:bg-hover" data-process-back @click="move(-1)">Back</button>
            <button v-if="summary.skipped" class="h-11 rounded-lg border border-line px-3 text-sm text-ink hover:bg-hover" data-process-review-skipped @click="reviewSkipped">Review {{ summary.skipped }} skipped</button>
            <button class="h-11 rounded-lg bg-ink px-4 text-sm font-medium text-surface" data-process-finish @click="emit('end')">Back to {{ plural }}</button>
          </div>
        </div>

        <template v-else>
          <div
            class="flex-1 overflow-y-auto px-5 pb-4 pt-5"
            :style="shift ? { transform: `translateX(${shift}px)`, opacity: String(1 - Math.min(Math.abs(shift) / 400, 0.5)) } : undefined"
            data-process-card
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
          >
            <p v-if="missing" class="text-sm text-ink-soft" data-process-missing>This {{ noun }} is no longer here (deleted or moved since the review started). Skip to go on.</p>
            <template v-else-if="current">
              <h2 class="text-[1.35rem] font-semibold leading-tight tracking-[-0.01em]" data-process-title>{{ displayTitle(current, type) }}</h2>
              <p v-if="outcome" class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-hover px-2 py-0.5 text-xs text-ink-soft" data-process-outcome>
                <AppIcon fallback="ph:check" :size="12" />{{ outcome }}
              </p>
              <p v-if="nextStep" class="mt-2 flex items-center gap-1.5 text-sm text-ink-soft"><AppIcon fallback="ph:arrow-right" :size="13" class="shrink-0 text-ink-faint" />{{ nextStep }}</p>
              <div v-if="fieldsShown.length" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <PropertyDisplay v-for="field in fieldsShown" :key="field.field" :def="field.def!" :value="current.props[field.field]" :object="current" :wrap="false" short />
              </div>
              <p v-if="notes" class="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{{ notes }}</p>
              <button class="mt-2 flex min-h-11 items-center gap-1 text-sm text-accent hover:underline" data-process-open @click="open">Open details<AppIcon fallback="ph:caret-right" :size="13" /></button>
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

          <!-- The buttons, where the thumb is on a phone: the main decisions, then More. -->
          <div ref="buttonBlock" class="grid grid-cols-2 gap-2 border-t border-line px-4 pb-3 pt-3">
            <template v-if="current">
              <button
                v-for="(action, i) in split.featured"
                :key="action.id"
                ref="buttons"
                :class="actionButton"
                :disabled="busy"
                :data-process-action="action.id"
                @click="act(action, $event.currentTarget as HTMLElement)"
              >
                <AppIcon :icon="action.icon" fallback="ph:lightning" :size="18" class="shrink-0" /><span class="truncate">{{ label(action) }}</span>
                <kbd v-if="!isPhone" class="ml-1 rounded border border-line px-1 font-sans text-[11px] opacity-60">{{ i + 1 }}</kbd>
              </button>
              <button v-if="moreItems.length" ref="moreButton" :class="actionButton" :disabled="busy" aria-haspopup="menu" data-process-more @click="openMore">
                <AppIcon fallback="ph:dots-three" :size="18" class="shrink-0" />More
              </button>
            </template>
            <div class="col-span-full flex justify-between">
              <button class="flex h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="index === 0 || busy" data-process-back @click="move(-1)">
                <AppIcon fallback="ph:caret-left" :size="14" />Back<kbd v-if="!isPhone" class="ml-1 rounded border border-line px-1 font-sans text-[11px] opacity-60">←</kbd>
              </button>
              <button class="flex h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="busy" data-process-skip @click="skip">
                <kbd v-if="!isPhone" class="mr-1 rounded border border-line px-1 font-sans text-[11px] opacity-60">→</kbd>Skip<AppIcon fallback="ph:caret-right" :size="14" />
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
