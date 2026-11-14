<script setup lang="ts">
// Process mode: a view's open tasks one at a time, in its order, taken as a fixed list when it
// opens. Each shows its place ("3 of 48"), title, next step, the view's row fields, the start of
// its notes and Open; large buttons run the type's quick actions (lib/quick-actions.ts: a question
// first if the action asks, then the next task), Skip and Back move without changing anything, and
// for a type with subtasks "Break into steps" adds steps in place. Keys: 1–9 the actions, → or
// Space skip, ← back, Return open, Escape close. On a phone it fills the screen with the buttons at
// the bottom; a swipe right runs Defer (as on rows), a swipe left skips. The end says what was done.
// One action at a time: while one saves (or its question is open) further keys, taps and swipes,
// Skip and Back do nothing, and the move on is from the task the action was run on.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { nextStepFieldOf, parentFieldOf, quickActionsOf } from '@vasta/core'
import { rowFields, type ListField } from '../lib/columns.ts'
import { displayTitle } from '../lib/format.ts'
import { openObject } from '../lib/open.ts'
import { quickAsk, runQuickAction } from '../lib/quick-actions.ts'
import { lastError, ui } from '../lib/state.ts'
import { addSubtask, subtasksOf } from '../lib/subtasks.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import PropertyDisplay from './PropertyDisplay.vue'

const props = defineProps<{ type: ObjectType; objects: ObjectSummary[]; fields: ListField[]; title: string }>()
const emit = defineEmits<{ close: [] }>()

const list = ref<ObjectSummary[]>([...props.objects])
const index = ref(0)
const current = computed(() => list.value[index.value])
const done = computed(() => index.value >= list.value.length)
const actions = computed(() => quickActionsOf(props.type))
const rightAction = computed(() => actions.value.find((a) => a.id === 'defer') ?? actions.value[0])
const counts = ref<Record<string, number>>({})
const skipped = ref(0)

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
    const saved = await runQuickAction(props.type, object, action, { anchor: isPhone.value ? null : anchor })
    if (!saved.length) return
    list.value[at] = { ...object, props: { ...object.props, ...Object.fromEntries(Object.entries(saved[0]!.values).filter(([, v]) => v)) } } as ObjectSummary
    counts.value = { ...counts.value, [action.name]: (counts.value[action.name] ?? 0) + 1 }
    breakingDown.value = false
    index.value = Math.min(list.value.length, at + 1)
  } finally {
    busy.value = false
  }
}
function move(delta: number) {
  if (busy.value) return
  breakingDown.value = false
  index.value = Math.max(0, Math.min(list.value.length, index.value + delta))
}
function skip() {
  if (done.value || busy.value) return
  skipped.value++
  move(1)
}
function open() {
  const object = current.value
  if (!object) return
  emit('close')
  void openObject(object.id)
}

// Break into steps (types with subtasks): an input in place; Return adds one and keeps it open.
const canBreakDown = computed(() => !!parentFieldOf(props.type))
const breakingDown = ref(false)
const stepTitle = ref('')
const stepInput = ref<HTMLInputElement | null>(null)
const steps = computed(() => (current.value && canBreakDown.value ? subtasksOf(props.type, current.value.id) : []))
async function startBreakDown() {
  breakingDown.value = true
  await nextTick()
  stepInput.value?.focus()
}
async function addStep() {
  const object = current.value
  if (!object || !stepTitle.value.trim()) return
  try {
    await addSubtask(props.type, { ...object, tagIds: object.tagIds }, stepTitle.value)
    stepTitle.value = ''
  } catch (error) {
    lastError.value = (error as Error).message
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
  if (number >= 1 && number <= 9 && actions.value[number - 1] && !done.value) {
    event.preventDefault()
    void act(actions.value[number - 1]!, buttons.value[number - 1] ?? null)
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

const summary = computed(() => [...Object.entries(counts.value).map(([name, n]) => `${name} ${n}`), ...(skipped.value ? [`Skipped ${skipped.value}`] : [])])
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 grid bg-black/30" :class="isPhone ? '' : 'place-items-center p-6'" data-process-mode>
      <section
        class="flex w-full flex-col bg-surface"
        :class="isPhone ? 'h-full pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : 'max-h-[85vh] max-w-xl rounded-2xl border border-line shadow-2xl shadow-black/20'"
        role="dialog"
        :aria-label="`Process ${title}`"
      >
        <header class="flex items-center gap-2 px-2 pt-2">
          <button class="grid h-11 w-11 place-items-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink" aria-label="Close" title="Close (Esc)" data-process-close @click="emit('close')">
            <AppIcon fallback="ph:x" :size="18" />
          </button>
          <span class="flex-1 truncate font-semibold">{{ title }}</span>
          <span class="px-3 text-sm tabular-nums text-ink-faint" data-process-position>{{ done ? list.length : index + 1 }} of {{ list.length }}</span>
        </header>
        <div class="mx-4 mt-1 h-[3px] rounded-full bg-line" aria-hidden="true">
          <div class="h-full rounded-full bg-ink-soft transition-[width] duration-200" :style="{ width: `${list.length ? (Math.min(index, list.length) / list.length) * 100 : 0}%` }" />
        </div>

        <!-- The end: what was done. -->
        <div v-if="done" class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center" data-process-end>
          <AppIcon fallback="ph:check-circle" :size="32" class="text-[var(--color-flow-done)]" />
          <p class="text-lg font-semibold">That’s all {{ list.length }}</p>
          <p class="text-sm text-ink-soft" data-process-summary>{{ summary.length ? summary.join(' · ') : 'Nothing changed' }}</p>
          <div class="mt-2 flex gap-2">
            <button class="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:bg-hover" @click="move(-1)">Back</button>
            <button class="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-surface" @click="emit('close')">Close</button>
          </div>
        </div>

        <template v-else-if="current">
          <div
            class="flex-1 overflow-y-auto px-5 pb-4 pt-5"
            :style="shift ? { transform: `translateX(${shift}px)`, opacity: String(1 - Math.min(Math.abs(shift) / 400, 0.5)) } : undefined"
            data-process-card
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
          >
            <h2 class="text-[1.35rem] font-semibold leading-tight tracking-[-0.01em]" data-process-title>{{ displayTitle(current, type) }}</h2>
            <p v-if="nextStep" class="mt-2 flex items-center gap-1.5 text-sm text-ink-soft"><AppIcon fallback="ph:arrow-right" :size="13" class="shrink-0 text-ink-faint" />{{ nextStep }}</p>
            <div v-if="fieldsShown.length" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <PropertyDisplay v-for="field in fieldsShown" :key="field.field" :def="field.def!" :value="current.props[field.field]" :object="current" :wrap="false" short />
            </div>
            <p v-if="notes" class="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{{ notes }}</p>
            <button class="mt-2 text-sm text-accent hover:underline" data-process-open @click="open">Open</button>
            <p v-if="steps.length" class="mt-3 text-xs text-ink-faint">{{ steps.length }} {{ steps.length === 1 ? 'step' : 'steps' }}</p>
            <form v-if="breakingDown" class="mt-3 flex items-center gap-2 rounded-lg border border-line px-2.5" @submit.prevent="addStep">
              <AppIcon fallback="ph:plus" :size="16" class="text-ink-faint" />
              <input ref="stepInput" v-model="stepTitle" class="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-faint max-md:text-base" placeholder="A step, then Return" data-process-step />
            </form>
          </div>

          <!-- The buttons, where the thumb is on a phone. -->
          <div ref="buttonBlock" class="grid gap-2 border-t border-line px-4 pb-3 pt-3" :class="actions.length > 2 ? 'grid-cols-2' : 'grid-cols-1'">
            <button
              v-for="(action, i) in actions"
              :key="action.id"
              ref="buttons"
              class="flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-medium"
              :class="[i === 0 ? 'col-span-full border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-hover']"
              :data-process-action="action.id"
              @click="act(action, $event.currentTarget as HTMLElement)"
            >
              <AppIcon :icon="action.icon" fallback="ph:lightning" :size="18" />{{ action.name }}
              <kbd v-if="!isPhone" class="ml-1 rounded border px-1 font-sans text-[11px] opacity-60" :class="i === 0 ? 'border-surface/40' : 'border-line'">{{ i + 1 }}</kbd>
            </button>
            <button v-if="canBreakDown" class="col-span-full flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-medium text-ink hover:bg-hover" data-process-break @click="startBreakDown">
              <AppIcon fallback="ph:tree-structure" :size="18" />Break into steps
            </button>
            <div class="col-span-full flex justify-between">
              <button class="flex h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="index === 0" data-process-back @click="move(-1)">
                <AppIcon fallback="ph:caret-left" :size="14" />Back<kbd v-if="!isPhone" class="ml-1 rounded border border-line px-1 font-sans text-[11px] opacity-60">←</kbd>
              </button>
              <button class="flex h-11 items-center gap-1 rounded-lg px-3 text-sm text-ink-soft hover:bg-hover" data-process-skip @click="skip">
                <kbd v-if="!isPhone" class="mr-1 rounded border border-line px-1 font-sans text-[11px] opacity-60">→</kbd>Skip<AppIcon fallback="ph:caret-right" :size="14" />
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
