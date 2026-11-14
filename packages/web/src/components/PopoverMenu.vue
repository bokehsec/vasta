<script setup lang="ts">
// Floating panel anchored to an element. Closes on outside click or Escape. On a phone it is a
// sheet from the bottom instead (over a dimmed page, above the keyboard, rows at least 44px high),
// so every picker and menu built on it is in reach of the thumb; `anchored` keeps the panel. The
// sheet is a modal dialog: the dimmed area closes it on a tap of its own (not on the press, which
// would let the tap through to the page underneath), focus moves in and returns to the opener.
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isPhone, keyboardInset, sheetMaxHeight } from '../lib/viewport.ts'

const props = defineProps<{ anchor: HTMLElement | null | undefined; placement?: Placement; width?: string; anchored?: boolean; label?: string }>()
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
  // A sheet closes from its dimmed backdrop, on the tap.
  if (sheet.value) return
  const target = event.target as Node
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  open.value = false
}

/** The dimmed area closes the sheet only when the press began on it too (a long-press that opened the sheet ends there). */
let pressedBackdrop = false
function onBackdropClick() {
  if (pressedBackdrop) open.value = false
  pressedBackdrop = false
}

/** What had the focus when a sheet opened (else the anchor), to give it back when the sheet closes. */
let opener: HTMLElement | null = null
const isTextEntry = (el: HTMLElement) => el.matches('input, textarea, select, [contenteditable]')

function focusSheet() {
  // A picker that focuses its own search box keeps it; otherwise the sheet itself takes the focus
  // (no keyboard).
  if (panel.value && !panel.value.contains(document.activeElement)) panel.value.focus({ preventScroll: true })
}

function returnFocus() {
  const target = opener
  opener = null
  if (!target) return
  void nextTick(() => {
    // Something else (a dialog the choice opened) may have the focus by now; and no keyboard pops up.
    if (document.activeElement && document.activeElement !== document.body) return
    if (target.isConnected && !isTextEntry(target)) target.focus({ preventScroll: true })
  })
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
      returnFocus()
      return
    }
    if (sheet.value) {
      pressedBackdrop = false
      const active = document.activeElement
      opener = active instanceof HTMLElement && active !== document.body ? active : (props.anchor ?? null)
    }
    await nextTick()
    if (sheet.value && open.value) focusSheet()
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
      <div class="fixed inset-0 z-50 bg-black/30" data-overlay data-sheet-backdrop aria-hidden="true" @pointerdown="pressedBackdrop = true" @pointercancel="pressedBackdrop = false" @click="onBackdropClick" />
      <div
        ref="panel"
        data-overlay
        data-sheet
        role="dialog"
        aria-modal="true"
        :aria-label="label ?? 'Options'"
        tabindex="-1"
        class="vasta-sheet fixed inset-x-0 z-50 overflow-y-auto rounded-t-2xl border border-b-0 border-line bg-surface px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_24px_rgb(0_0_0/0.14)] outline-none"
        :style="{ bottom: `${keyboardInset}px`, maxHeight: sheetMaxHeight }"
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
