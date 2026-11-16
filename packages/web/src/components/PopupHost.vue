<script setup lang="ts">
// The popup window: an object open over the page that is showing (lib/open.ts keeps which one in
// the address). On a desktop it is a window in the middle of the page; Esc, clicking outside it
// or Back closes it, and "Open full page" takes the object there. On a phone it is a sheet from
// the bottom, pulled down to close (SheetGrabber). A new item opened here and never touched is
// removed when it closes, so cancelling a New leaves nothing behind.
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../lib/api.ts'
import { closePopup, expandPopup, pageObjectId, popupBlockId, popupCursor, popupIsNew, popupObjectId } from '../lib/open.ts'
import { onObjectSave } from '../lib/object-saves.ts'
import { forgetSummary, refreshCounts } from '../lib/state.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import SheetGrabber from './SheetGrabber.vue'

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

// Focus goes into the window when it opens, and back to what opened it when it closes.
let opener: HTMLElement | null = null
watch(
  popupObjectId,
  async (id, before) => {
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

// The object the window is showing, and whether it was saved while it was: any save of it counts,
// so an untouched new item can be told from one that got as far as a title.
let openId: string | undefined
let openNew = false
let saved = false
// The id whose saves count: the one shown, and — while it is being closed — the one that just
// left, whose page flushes what it was saving as it goes (ObjectPage saves on unmount).
let countsFor: string | undefined
watch(
  [popupObjectId, popupIsNew],
  ([id, isNew]) => {
    void (async () => {
      const gone = openId
      const wasNew = openNew
      openId = id
      openNew = !!isNew
      countsFor = id
      saved = false
      // Closed, or another object took the window: a new one that was never touched goes away.
      if (gone && wasNew) {
        countsFor = gone
        await nextTick()
        if (!saved) await removeIfUntouched(gone)
        countsFor = openId
      }
    })()
  },
  { immediate: true }
)
const stopSaves = onObjectSave((object) => {
  // A save of the object being watched, started or finished, means it was touched.
  if (countsFor && object.id === countsFor) saved = true
  return undefined
})
onBeforeUnmount(stopSaves)

// Escape closes the window wherever the focus is (the pane's Esc, lib/shortcuts.ts, is behind the
// dialog check there; popovers and the editor inside handle their own Escape first).
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && popupObjectId.value) {
    event.preventDefault()
    void closePopup()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** A new item that was never touched is deleted (to the trash and out), as if it was never made:
 * one made with something in it (the quick card's title, a template) is kept, and so is one that
 * was saved while it was open, even if it ended up empty. */
async function removeIfUntouched(id: string) {
  if (saved) return
  let object
  try {
    object = await api.object(id)
  } catch {
    return // gone already (trashed from inside the window, or the like)
  }
  const empty = !object.title && !Object.keys(object.props ?? {}).length && !Object.keys(object.content ?? {}).length && !(object.tagIds ?? []).length
  if (!empty) return
  try {
    await api.deleteObject(id)
    await api.deleteObjectForever(id)
  } catch {
    return // it stays in the trash: still better than an "Untitled" in the list
  }
  forgetSummary(id)
  void refreshCounts()
}
</script>

<template>
  <div v-if="popupObjectId" class="fixed inset-0 z-40" data-popup>
    <div class="absolute inset-0 bg-black/30" data-popup-backdrop aria-hidden="true" @click="closePopup()" />
    <!-- A window in the middle of the page; the page behind it stays where it is. -->
    <section
      v-if="!isPhone"
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
    <!-- A phone has no room beside anything: the object comes up from the bottom, pulled down to close. -->
    <section
      v-else
      ref="box"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label="Object sheet"
      class="vasta-sheet absolute inset-x-0 bottom-0 top-[6%] flex flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-[0_-6px_24px_rgb(0_0_0/0.14)] outline-none"
    >
      <SheetGrabber @close="closePopup()" />
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
    </section>
  </div>
</template>
