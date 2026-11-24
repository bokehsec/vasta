<script setup lang="ts">
// Floating panel anchored to an element. Closes on outside click or Escape. On a phone it is a
// sheet from the bottom instead (BottomSheet: over a dimmed page, above the keyboard, rows at least
// 44px high), so every picker and menu built on it is in reach of the thumb; `anchored` keeps the
// panel.
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isPhone } from '../lib/viewport.ts'
import BottomSheet from './BottomSheet.vue'
import { closesOnBack } from '../lib/back.ts'

const props = defineProps<{ anchor: HTMLElement | null | undefined; placement?: Placement; width?: string; anchored?: boolean; label?: string }>()
const open = defineModel<boolean>('open', { required: true })
const panel = ref<HTMLElement | null>(null)
let stop: (() => void) | undefined
const sheet = computed(() => isPhone.value && !props.anchored)
// A sheet says so itself (BottomSheet); a panel kept by its button closes on Back too.
closesOnBack(() => open.value && !sheet.value, () => (open.value = false))

async function position() {
  if (!props.anchor || !panel.value) return
  const { x, y } = await computePosition(props.anchor, panel.value, {
    placement: props.placement ?? 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8, crossAxis: true })],
  })
  Object.assign(panel.value.style, { left: `${x}px`, top: `${y}px` })
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  // Mark the event handled so an enclosing dialog stays open.
  event.preventDefault()
  open.value = false
}

// The floating panel listens for a click outside and Escape; a sheet does both itself.
watch(
  [open, sheet],
  async ([value, asSheet]) => {
    stop?.()
    stop = undefined
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKey)
    if (!value || asSheet) return
    await nextTick()
    if (props.anchor && panel.value) stop = autoUpdate(props.anchor, panel.value, position)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  stop?.()
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <BottomSheet v-if="open && sheet" :label="label ?? 'Options'" :opener="anchor" data-sheet @close="open = false">
    <slot />
  </BottomSheet>
  <Teleport v-else-if="open" to="body">
    <div
      ref="panel"
      data-overlay
      class="fixed left-0 top-0 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/10"
      :style="{ width: width ?? '16rem', maxWidth: 'calc(100vw - 16px)' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
