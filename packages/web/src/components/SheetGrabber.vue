<script setup lang="ts">
// The bar at the top of a phone's sheet, first thing in the sheet's panel: pulled down it closes
// the sheet, as on iOS. The panel follows the finger; let go far enough down (or flicked down) it
// closes, else it springs back. A sheet that cannot close yet (saving) springs back too.
import { ref } from 'vue'
import { DECIDE, FLICK, tracker } from '../lib/swipe.ts'

const emit = defineEmits<{ close: [] }>()
const zone = ref<HTMLElement>()
const speed = tracker()
let start: { y: number; pointer: number } | undefined

/** Pulled at least this share of the sheet's height (at most CLOSE px), it closes. */
const SHARE = 0.3
const CLOSE = 120

const panel = () => zone.value?.parentElement ?? undefined
const pulled = (event: PointerEvent) => (start ? Math.max(0, event.clientY - start.y) : 0)

function onDown(event: PointerEvent) {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  start = { y: event.clientY, pointer: event.pointerId }
  speed.reset()
  speed.add(event.clientY)
  zone.value?.setPointerCapture(event.pointerId)
  const sheet = panel()
  if (sheet) sheet.style.transition = 'none'
}

function onMove(event: PointerEvent) {
  if (start?.pointer !== event.pointerId) return
  speed.add(event.clientY)
  const sheet = panel()
  if (sheet) sheet.style.transform = `translateY(${pulled(event)}px)`
}

function onUp(event: PointerEvent) {
  if (start?.pointer !== event.pointerId) return
  const dy = pulled(event)
  const velocity = speed.velocity()
  start = undefined
  const sheet = panel()
  const far = Math.min(CLOSE, (sheet?.offsetHeight ?? 400) * SHARE)
  if (dy >= far || (velocity >= FLICK && dy >= DECIDE)) emit('close')
  settle()
}

function onCancel(event: PointerEvent) {
  if (start?.pointer !== event.pointerId) return
  start = undefined
  settle()
}

/** Back into place (also under a sheet that is closing, which goes with it). */
function settle() {
  const sheet = panel()
  if (!sheet) return
  sheet.style.transition = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)'
  sheet.style.transform = ''
}
</script>

<template>
  <!-- A taller strip than the bar, so a thumb finds it; Back, Escape and the dimmed area close the sheet too. -->
  <div
    ref="zone"
    class="-mt-2 mb-0.5 flex h-6 cursor-grab touch-none select-none items-center justify-center"
    aria-hidden="true"
    data-sheet-grabber
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onCancel"
  >
    <div class="h-1 w-9 rounded-full bg-line-strong" />
  </div>
</template>
