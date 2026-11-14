<script lang="ts">
// One row open at a time, across every list: opening one closes the others.
const openRows = new Set<() => void>()
</script>

<script setup lang="ts">
// A row that a finger swipes, as in Mail: right past ~40% of its width runs one action (a task's
// Defer); left uncovers buttons for the others and More, and stays open until a tap elsewhere or
// another row opens. The direction is decided after 10px; a mostly vertical move leaves it to the
// page's scrolling (touch-action: pan-y), and a touch starting at the screen's left edge belongs to
// the sidebar drawer. After a swipe the finger lifting does not also open the row.
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Icon } from '@vasta/core'
import AppIcon from './AppIcon.vue'

export interface SwipeAction {
  id: string
  label: string
  icon?: Icon
  /** done: green; accent: the app's blue; otherwise a neutral grey (more: the darkest). */
  tone?: 'done' | 'accent' | 'neutral' | 'more'
  run: (anchor: HTMLElement | null) => unknown
}

/** Without `enabled` the row is drawn as it is, with no swiping. */
const props = defineProps<{ enabled?: boolean; right?: SwipeAction; left: SwipeAction[] }>()

const EDGE = 24
const DECIDE = 10
const BUTTON = 72
const root = ref<HTMLElement | null>(null)
const offset = ref(0)
const settling = ref(false)
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const leftWidth = computed(() => props.left.length * BUTTON)
const crossed = ref(false)

let start: { x: number; y: number; base: number } | undefined
let direction: 'x' | 'y' | undefined
let swiped = false


function settle(to: number) {
  settling.value = !reduced
  offset.value = to
  if (to === 0) openRows.delete(close)
  else {
    for (const other of [...openRows]) if (other !== close) other()
    openRows.add(close)
    document.addEventListener('touchstart', onOutside, { capture: true, passive: true })
  }
}
function close() {
  settle(0)
  document.removeEventListener('touchstart', onOutside, { capture: true })
}
function onOutside(event: TouchEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  start = undefined
  direction = undefined
  swiped = false
  if (!touch || event.touches.length !== 1 || touch.clientX < EDGE) return
  start = { x: touch.clientX, y: touch.clientY, base: offset.value }
  settling.value = false
}

function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0]
  if (!start || !touch) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (!direction) {
    if (Math.abs(dy) > DECIDE && Math.abs(dy) >= Math.abs(dx)) direction = 'y'
    else if (Math.abs(dx) > DECIDE) direction = 'x'
    else return
  }
  if (direction !== 'x') return
  swiped = true
  let next = start.base + dx
  if (next > 0 && !props.right) next = 0
  if (next < 0 && !props.left.length) next = 0
  // Past the buttons it pulls harder.
  if (next < -leftWidth.value) next = -leftWidth.value + (next + leftWidth.value) / 3
  offset.value = next
  const width = root.value?.offsetWidth ?? 1
  const over = next > width * 0.4
  if (over !== crossed.value) {
    crossed.value = over
    if (over) navigator.vibrate?.(10)
  }
}

function onTouchEnd(event: TouchEvent) {
  if (!start) return
  start = undefined
  if (!swiped) {
    // A tap on an open row closes it instead of opening the object.
    if (offset.value !== 0 && !(event.target as Element).closest('[data-swipe-button]')) {
      if (event.cancelable) event.preventDefault()
      swiped = true // the click that follows is the close, not an open
      close()
    }
    return
  }
  if (event.cancelable) event.preventDefault()
  const width = root.value?.offsetWidth ?? 1
  if (offset.value > width * 0.4 && props.right) {
    const action = props.right
    close()
    crossed.value = false
    void action.run(null)
  } else if (offset.value < -leftWidth.value / 2) settle(-leftWidth.value)
  else close()
  crossed.value = false
}

/** A click right after a swipe (some browsers still send one) does not open the row. */
function onClickCapture(event: MouseEvent) {
  if (!swiped && offset.value === 0) return
  if ((event.target as Element).closest('[data-swipe-button]')) return
  event.preventDefault()
  event.stopPropagation()
  swiped = false
}

function press(action: SwipeAction, event: MouseEvent) {
  close()
  void action.run(event.currentTarget as HTMLElement)
}

onBeforeUnmount(() => {
  openRows.delete(close)
  document.removeEventListener('touchstart', onOutside, { capture: true })
})

// Fixed shades that keep white text at 4.5:1 or more in both themes (the dark theme's accent and
// the flow green are too light under white): green for Done, the light theme's accent for Defer.
const tone = (action: SwipeAction | undefined) =>
  action?.tone === 'done' ? 'bg-[#117a54]' : action?.tone === 'accent' ? 'bg-[#2f6fea]' : action?.tone === 'more' ? 'bg-[#4a4741]' : 'bg-[#6d6961]'
</script>

<template>
  <slot v-if="!enabled" />
  <div
    v-else
    ref="root"
    class="relative touch-pan-y overflow-hidden"
    data-swipe-row
    :data-swipe-open="offset < 0 || undefined"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="close"
    @click.capture="onClickCapture"
  >
    <!-- Under the row: the right swipe's action, or the buttons a left swipe uncovers. -->
    <div v-if="offset > 0 && right" class="absolute inset-0 flex items-center gap-2 pl-5 text-sm font-semibold text-white" :class="tone(right)" aria-hidden="true">
      <AppIcon :icon="right.icon" fallback="ph:lightning" :size="20" class="transition-transform duration-150" :class="crossed ? 'scale-125' : ''" />{{ right.label }}
    </div>
    <div v-if="offset < 0" class="absolute inset-y-0 right-0 flex">
      <button
        v-for="action in left"
        :key="action.id"
        class="flex w-18 flex-col items-center justify-center gap-1 text-xs font-medium text-white"
        :class="tone(action)"
        :data-swipe-button="action.id"
        @click.stop.prevent="press(action, $event)"
      >
        <AppIcon :icon="action.icon" fallback="ph:lightning" :size="20" />{{ action.label }}
      </button>
    </div>
    <div class="relative bg-surface" :class="settling ? 'transition-transform duration-200 ease-out' : ''" :style="offset ? { transform: `translateX(${offset}px)` } : undefined">
      <slot />
    </div>
  </div>
</template>
