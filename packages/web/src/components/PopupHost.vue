<script setup lang="ts">
// The popup window: an object open over the page that is showing (lib/open.ts keeps which one in
// the address). On a desktop it is a window in the middle of the page; Esc, clicking outside it
// or Back closes it, and "Open full page" takes the object there. On a phone it is a sheet from
// the bottom (BottomSheet: above the keyboard, under the top safe area), pulled down to close.
// Closing goes back in history when the window was opened over the page (lib/open.ts), so the next
// Back leaves the page and does not reopen it.
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closePopup, expandPopup, pageObjectId, popupBlockId, popupCursor, popupIsNew, popupObjectId } from '../lib/open.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'

// The object page is its own chunk (router.ts); the pane waits for it the same way.
const ObjectPage = defineAsyncComponent(() => import('../views/ObjectPage.vue'))

const box = ref<HTMLElement | null>(null)

// An address with the popup over its own object's page opens the page: the window is dropped.
watch(
  [popupObjectId, pageObjectId],
  ([popup, page]) => {
    if (popup && popup === page) void closePopup(true)
  },
  { immediate: true }
)

// On a desktop, focus goes into the window when it opens, and back to what opened it when it closes
// (a phone's sheet does that itself).
let opener: HTMLElement | null = null
watch(
  popupObjectId,
  async (id, before) => {
    if (isPhone.value) return
    if (id && !before) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      box.value?.focus({ preventScroll: true })
    } else if (!id && before) {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      opener = null
    }
  },
  { immediate: true }
)

// Escape closes the window wherever the focus is (the pane's Esc, lib/shortcuts.ts, is behind the
// dialog check there; popovers and the editor inside handle their own Escape first). A phone's
// sheet does this itself.
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && popupObjectId.value && !isPhone.value) {
    event.preventDefault()
    void closePopup()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- A phone has no room beside anything: the object comes up from the bottom, pulled down to close. -->
  <BottomSheet v-if="popupObjectId && isPhone" label="Object sheet" tall flush in-address layer="surface" data-popup @close="closePopup()">
    <div class="flex shrink-0 items-center justify-between px-1 text-ink-soft">
      <button class="grid h-11 w-11 place-items-center rounded-lg active:bg-hover" title="Close" aria-label="Close" @click="closePopup()">
        <AppIcon fallback="ph:x" :size="20" />
      </button>
      <button class="flex h-11 items-center gap-1.5 rounded-lg px-3 text-[15px] active:bg-hover" title="Open full page" @click="expandPopup()">
        <AppIcon fallback="ph:arrows-out-simple" :size="16" />Open full page
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ObjectPage :id="popupObjectId" :key="popupObjectId" variant="popup" :block="popupBlockId" :is-new="popupIsNew" :cursor="popupCursor" />
    </div>
  </BottomSheet>
  <div v-else-if="popupObjectId" class="fixed inset-0 z-40" data-popup>
    <div class="absolute inset-0 bg-black/30" data-popup-backdrop aria-hidden="true" @click="closePopup()" />
    <!-- A window in the middle of the page; the page behind it stays where it is. -->
    <section
      ref="box"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label="Object window"
      class="absolute inset-x-0 top-[6vh] mx-auto flex max-h-[86vh] w-[min(56rem,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.18)] outline-none"
    >
      <div class="flex shrink-0 items-center justify-end gap-0.5 border-b border-line px-2 py-1 text-ink-soft">
        <button class="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-hover hover:text-ink" title="Open full page" @click="expandPopup()">
          <AppIcon fallback="ph:arrows-out-simple" :size="14" />Open full page
        </button>
        <button class="grid h-7 w-7 place-items-center rounded-md hover:bg-hover hover:text-ink" title="Close (Esc)" @click="closePopup()">
          <AppIcon fallback="ph:x" :size="15" />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ObjectPage :id="popupObjectId" :key="popupObjectId" variant="popup" :block="popupBlockId" :is-new="popupIsNew" :cursor="popupCursor" />
      </div>
    </section>
  </div>
</template>
