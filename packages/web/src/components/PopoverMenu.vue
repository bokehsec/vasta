<script setup lang="ts">
// Floating panel anchored to an element. Closes on outside click or Escape. On a phone it is a
// sheet from the bottom instead (over a dimmed page, above the keyboard, rows at least 44px high),
// so every picker and menu built on it is in reach of the thumb; `anchored` keeps the panel.
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isPhone, keyboardInset } from '../lib/viewport.ts'

const props = defineProps<{ anchor: HTMLElement | null | undefined; placement?: Placement; width?: string; anchored?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const panel = ref<HTMLElement | null>(null)
let stop: (() => void) | undefined
const sheet = computed(() => isPhone.value && !props.anchored)

async function position() {
  if (!props.anchor || !panel.value || sheet.value) return
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

watch(
  open,
  async (value) => {
    stop?.()
    stop = undefined
    if (!value) {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      return
    }
    await nextTick()
    if (props.anchor && panel.value && !sheet.value) stop = autoUpdate(props.anchor, panel.value, position)
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
  <Teleport to="body">
    <template v-if="open && sheet">
      <div class="fixed inset-0 z-50 bg-black/30" data-overlay aria-hidden="true" />
      <div
        ref="panel"
        data-overlay
        data-sheet
        class="vasta-sheet fixed inset-x-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-b-0 border-line bg-surface px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_24px_rgb(0_0_0/0.14)]"
        :style="{ bottom: `${keyboardInset}px` }"
      >
        <div class="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <slot />
      </div>
    </template>
    <div
      v-else-if="open"
      ref="panel"
      data-overlay
      class="fixed left-0 top-0 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/10"
      :style="{ width: width ?? '16rem', maxWidth: 'calc(100vw - 16px)' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
