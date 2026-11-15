<script setup lang="ts">
// The bar at the bottom of a phone: places chosen in Settings, with Capture as a round button
// above it on the right. The sidebar stays behind the menu at the top left. Hidden while the
// keyboard is up or a full-screen surface (a whiteboard) is open; dialogs cover it; while rows are
// selected the bulk bar takes its place. Its z-index (20) is below the sidebar drawer's (30).
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { isTodayRoute } from '../lib/actions.ts'
import { phonePlacePath, visiblePhonePlaces, type PhonePlace } from '../lib/phone-places.ts'
import { selecting } from '../lib/selection.ts'
import { lastError, notice, ui, workspace } from '../lib/state.ts'
import { keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const route = useRoute()
/** Where Home lands: the page the space opens on, when it is one (else "/" decides). */
const homePath = computed(() => (workspace.space?.opensOn?.kind === 'object' ? `/o/${workspace.space.opensOn.id}` : '/'))
function active(place: PhonePlace) {
  if (place.id === 'home') return route.path === '/' || route.path === homePath.value
  if (place.id === 'today') return isTodayRoute(route)
  if (place.id === 'calendar') return (route.path === '/calendar' || route.path.startsWith('/day/')) && !(visiblePhonePlaces.value.some((item) => item.id === 'today') && isTodayRoute(route))
  return !!place.to && route.path === place.to
}
const hidden = computed(() => keyboardInset.value > 80 || ui.surfaceFull)
</script>

<template>
  <template v-if="!hidden">
    <button
      v-if="!selecting"
      class="fixed right-4 z-20 grid h-13 w-13 place-items-center rounded-2xl bg-ink text-surface shadow-[0_6px_16px_rgb(0_0_0/0.22)] transition-[bottom] duration-200 active:scale-95 motion-reduce:transition-none"
      :class="notice || lastError ? 'bottom-[calc(8rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]'"
      aria-label="Capture"
      data-capture-button
      @click="ui.captureOpen = true"
    >
      <AppIcon fallback="ph:plus" :size="24" />
    </button>
    <nav
      v-if="!selecting"
      class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      aria-label="Places"
      data-tab-bar
    >
      <template v-for="tab in visiblePhonePlaces" :key="tab.id">
        <RouterLink
          v-if="tab.id !== 'search'"
          :to="phonePlacePath(tab)!"
          class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px]"
          :class="active(tab) ? 'text-accent' : 'text-ink-soft'"
          :aria-current="active(tab) ? 'page' : undefined"
          :aria-label="tab.label"
          :data-tab="tab.label"
        >
          <AppIcon :icon="tab.icon" :fallback="tab.fallback" :size="22" /><span class="w-full truncate text-center">{{ tab.label }}</span>
        </RouterLink>
        <button v-else class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-ink-soft" data-tab="Search" @click="ui.paletteOpen = true">
          <AppIcon :fallback="tab.fallback" :size="22" />Search
        </button>
      </template>
    </nav>
  </template>
</template>
