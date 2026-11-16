<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import BulkBar from './components/BulkBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import ContextMenuHost from './components/ContextMenuHost.vue'
import DialogHost from './components/DialogHost.vue'
import AppToast from './components/AppToast.vue'
import OfflineBanner from './components/OfflineBanner.vue'
import PasswordDialog from './components/PasswordDialog.vue'
import PhoneTabBar from './components/PhoneTabBar.vue'
import PickObjectHost from './components/PickObjectHost.vue'
import QuickAskHost from './components/QuickAskHost.vue'
import QuickCapture from './components/QuickCapture.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import SidePane from './components/SidePane.vue'
import TopBar from './components/TopBar.vue'
import { closesOnBack } from './lib/back.ts'
import { closeContextMenu } from './lib/overlays.ts'
import { listenToDesktop, trafficLights } from './lib/platform.ts'
import { quickAsk } from './lib/quick-actions.ts'
import { keepsScroll } from './lib/scroll-memory.ts'
import { installShortcuts } from './lib/shortcuts.ts'
import { checkSession, session } from './lib/session.ts'
import { lastError, notice, ui, workspace } from './lib/state.ts'
import { clearSelection, selecting } from './lib/selection.ts'
import { isPhone } from './lib/viewport.ts'
import { router } from './router.ts'
import LoginView from './views/LoginView.vue'

const route = useRoute()

onMounted(checkSession)
// The desktop app's shortcut and menu ask for quick capture and today's note (lib/platform.ts).
const stopDesktopWatch = watch(
  () => session.user && workspace.ready,
  (ready) => {
    if (!ready) return
    listenToDesktop()
    queueMicrotask(() => stopDesktopWatch())
  },
  { immediate: true }
)

// On a phone the sidebar is a drawer over the page: it closes when a page opens and on Escape.
watch(() => route.fullPath, () => (ui.sidebarOpen = false))
closesOnBack(() => isPhone.value && ui.sidebarOpen, () => (ui.sidebarOpen = false))
// The row menu and a quick action's question are about the page they were opened on: another page
// closes them (Back on a phone closes them first and stays, lib/back.ts; this is any other way).
watch(
  () => route.path,
  () => {
    closeContextMenu()
    quickAsk.value?.answer(null)
  }
)
// A selection belongs to the page it was made on (the side pane opening keeps it).
watch(() => route.path, clearSelection)
watch(isPhone, () => (ui.sidebarOpen = false))
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && ui.sidebarOpen && isPhone.value) ui.sidebarOpen = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
onBeforeUnmount(installShortcuts())
const main = ref<HTMLElement | null>(null)
onBeforeUnmount(keepsScroll(router, () => main.value))

// A swipe left on the open drawer closes it. Nothing opens it from the screen's left edge: on an
// iPhone that swipe is Back, and a drawer opened under it would make Back close the drawer and stay
// (lib/back.ts). The menu at the top left (and the bottom bar's Menu, if chosen) opens it.
let swipe: { x: number; y: number } | undefined
function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  swipe = isPhone.value && ui.sidebarOpen && event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined
}
function onTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (!swipe || !touch) return
  const dx = touch.clientX - swipe.x
  const dy = Math.abs(touch.clientY - swipe.y)
  if (dx < -60 && dy < -dx) ui.sidebarOpen = false
  swipe = undefined
}
</script>

<template>
  <div v-if="session.user && workspace.ready" class="flex h-full flex-col pt-[env(safe-area-inset-top)]" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <!-- With the macOS traffic lights over the top-left corner, the banner goes below the top bar. -->
    <OfflineBanner v-if="!trafficLights" />
    <div class="relative flex min-h-0 flex-1">
      <Transition name="vasta-fade">
        <!-- The drawer and its backdrop (z-30) sit above the bottom bar and Capture (z-20, PhoneTabBar), and
             below dialogs and the bulk bar (z-40), which is not rendered while the drawer is open. -->
        <div v-if="isPhone && ui.sidebarOpen" class="fixed inset-0 z-30 bg-black/30" data-drawer-backdrop @click="ui.sidebarOpen = false" />
      </Transition>
      <AppSidebar
        data-drawer
        class="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-[min(18rem,85vw)] max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-[env(safe-area-inset-top)] max-md:shadow-2xl max-md:transition-transform max-md:duration-200"
        :class="[isPhone && !ui.sidebarOpen ? 'max-md:-translate-x-full max-md:shadow-none' : '', ui.sidebarCollapsed ? 'md:hidden' : '']"
        :inert="isPhone && !ui.sidebarOpen"
      />
      <div class="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineBanner v-if="trafficLights" class="mb-2 mr-2 rounded-lg" :class="ui.sidebarCollapsed ? 'ml-2' : ''" />
        <!-- The page is a panel on the app's background; isolate: z-indexes inside pages (the calendar's
             sticky headers) stay below the drawer. -->
        <!-- The side pane sits next to the page (SidePane), on the same background. The key leaves out
             the query, so opening or closing the pane (?pane=) keeps the page as it is. -->
        <div class="flex min-h-0 flex-1">
          <main
            ref="main"
            class="isolate min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface md:mb-2 md:mr-2 md:rounded-xl md:border md:border-line md:shadow-[0_1px_3px_rgb(0_0_0/0.04)]"
            :class="[ui.sidebarCollapsed ? 'md:ml-2' : '', selecting ? (isPhone ? 'pb-[calc(10rem+env(safe-area-inset-bottom))]' : 'pb-32') : isPhone ? (notice || lastError ? 'pb-[calc(13rem+env(safe-area-inset-bottom))]' : 'pb-[calc(9rem+env(safe-area-inset-bottom))]') : 'pb-[env(safe-area-inset-bottom)]']"
          >
            <RouterView :key="$route.fullPath.split('?')[0]" />
          </main>
          <SidePane />
        </div>
      </div>
    </div>
    <CommandPalette />
    <ContextMenuHost />
    <DialogHost />
    <QuickAskHost />
    <PickObjectHost />
    <PhoneTabBar v-if="isPhone" />
    <BulkBar v-if="!(isPhone && ui.sidebarOpen)" />
    <AppToast />
    <PasswordDialog v-if="ui.passwordOpen" />
    <QuickCapture v-if="ui.captureOpen" />
    <ShortcutsDialog v-if="ui.shortcutsOpen" />
  </div>
  <LoginView v-else-if="session.checked && !session.user && !session.error" />
  <div v-else class="grid h-full place-items-center text-sm text-ink-soft">
    <p>{{ session.error || workspace.error || 'Loading…' }}</p>
  </div>
  <!-- macOS desktop app: no title bar, so the top of the login and loading screens moves the window. -->
  <div v-if="trafficLights && !(session.user && workspace.ready)" class="fixed inset-x-0 top-0 h-12" data-tauri-drag-region />

</template>
