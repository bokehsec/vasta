<script lang="ts">
// The sheets open now, the last opened on top: Escape closes only that one.
const sheets: object[] = []
</script>

<script setup lang="ts">
// The one frame of a phone's bottom sheet: a dimmed page, a rounded panel with a grabber, kept
// clear of the home bar (safe area) and above the on-screen keyboard, 44px rows and 16px text boxes
// (.vasta-sheet), focus moved in and given back, and closing by a tap on the dimmed area (a tap, not
// the press: a long-press that opened it ends there), Escape, a pull on the grabber or Back (lib/
// back.ts). Every menu, picker, question and card that comes up from the bottom is this, whatever
// it holds; it emits `close` for all of those and the owner decides (a sheet that cannot close yet,
// saving, ignores it). Mount it only while open. `desktop` says where a wider screen draws it
// instead: a dialog in the middle or near the top (without it, the sheet is for phones only and
// its owner draws something else there).
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { closesOnBack } from '../lib/back.ts'
import { isPhone, keyboardInset, sheetMaxHeight } from '../lib/viewport.ts'
import SheetGrabber from './SheetGrabber.vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    label: string
    role?: 'dialog' | 'menu'
    /** The panel is a column that holds its own scrolling areas and footer (the quick card, the object window). */
    flush?: boolean
    /** Nearly the whole screen, from just under the top safe area (the object window). */
    tall?: boolean
    /** 'surface' is a page's own card (z-40); 'menu' is a menu or question over anything (z-50). */
    layer?: 'surface' | 'menu'
    desktop?: 'center' | 'top'
    /** The widest it gets as a dialog on a wider screen. */
    width?: string
    /** What takes the focus back when it closes, when nothing had it (the button a menu came from). */
    opener?: HTMLElement | null | undefined
    /** Kept in the address (the object window): Back pops its history entry itself, so it does not register (lib/back.ts). */
    inAddress?: boolean
  }>(),
  { role: 'dialog', layer: 'menu' }
)
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
defineExpose({ panel })

const dialog = () => !!props.desktop && !isPhone.value
const level = () => (props.layer === 'surface' ? 'z-40' : 'z-50')

const self = {}
sheets.push(self)
if (!props.inAddress) closesOnBack(() => true, () => emit('close'))

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || sheets.at(-1) !== self) return
  // Marked handled, so a dialog or page under the sheet stays.
  event.preventDefault()
  emit('close')
}

/** The dimmed area closes the sheet only when the press began on it too. */
let pressedBackdrop = false
function onBackdropClick() {
  if (pressedBackdrop) emit('close')
  pressedBackdrop = false
}

const isTextEntry = (el: HTMLElement) => el.matches('input, textarea, select, [contenteditable]')
const active = document.activeElement
let returnTo = active instanceof HTMLElement && active !== document.body ? active : (props.opener ?? null)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await nextTick()
  // A picker that focuses its own search box keeps it; otherwise the sheet itself takes the focus
  // (no keyboard comes up).
  if (panel.value && !panel.value.contains(document.activeElement)) panel.value.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  sheets.splice(sheets.indexOf(self), 1)
  const target = returnTo
  returnTo = null
  if (!target) return
  void nextTick(() => {
    // Something else (a dialog the choice opened) may have the focus by now; and no keyboard pops up.
    if (document.activeElement && document.activeElement !== document.body) return
    if (target.isConnected && !isTextEntry(target)) target.focus({ preventScroll: true })
  })
})

/** Clear of the home bar, unless the keyboard covers it. */
const bottomPadding = () => (keyboardInset.value ? (props.flush || props.tall ? '0px' : '0.75rem') : props.flush || props.tall ? 'env(safe-area-inset-bottom)' : 'max(0.75rem, env(safe-area-inset-bottom))')
const sheetStyle = () => ({
  bottom: `${keyboardInset.value}px`,
  paddingBottom: bottomPadding(),
  ...(props.tall ? { top: 'max(6%, calc(env(safe-area-inset-top) + 0.5rem))' } : { maxHeight: sheetMaxHeight.value }),
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialog()"
      class="fixed inset-0 grid bg-black/30 dark:bg-black/45"
      :class="[level(), desktop === 'top' ? 'items-start justify-center px-4 pt-[16vh]' : 'place-items-center p-4']"
      data-overlay
      data-bottom-sheet-backdrop
      @pointerdown.self="pressedBackdrop = true"
      @pointercancel="pressedBackdrop = false"
      @click.self="onBackdropClick"
    >
      <div
        ref="panel"
        v-bind="$attrs"
        data-overlay
        :role="role"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        class="w-full border border-line bg-surface shadow-[0_2px_6px_rgb(0_0_0/0.06),0_18px_48px_-12px_rgb(0_0_0/0.28)] outline-none dark:border-line-strong"
        :class="flush ? 'flex flex-col overflow-hidden rounded-2xl' : 'max-h-[70vh] overflow-y-auto rounded-xl p-1'"
        :style="{ maxWidth: width ?? '24rem' }"
      >
        <slot />
      </div>
    </div>
    <template v-else>
      <div class="fixed inset-0 bg-black/30 dark:bg-black/45" :class="level()" data-overlay data-bottom-sheet-backdrop aria-hidden="true" @pointerdown="pressedBackdrop = true" @pointercancel="pressedBackdrop = false" @click="onBackdropClick" />
      <div
        ref="panel"
        v-bind="$attrs"
        data-overlay
        :role="role"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        class="vasta-sheet fixed inset-x-0 rounded-t-2xl border border-b-0 border-line bg-surface pt-2 shadow-[0_-6px_24px_rgb(0_0_0/0.14)] outline-none"
        :class="[level(), flush || tall ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-2']"
        :style="sheetStyle()"
      >
        <SheetGrabber @close="emit('close')" />
        <slot />
      </div>
    </template>
  </Teleport>
</template>
