<script setup lang="ts">
// The bar at the bottom of a phone: places chosen in Settings, with Capture as a round button
// above it on the right. The sidebar stays behind the menu at the top left (and Menu here, if
// chosen). Hidden while the keyboard is up or a full-screen surface (a whiteboard) is open; dialogs
// cover it. Its z-index (20) is below the sidebar drawer's (30).
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { isTodayRoute, sidebarItemPath } from '../lib/actions.ts'
import { phonePlacePath, visiblePhonePlaces, type PhonePlace } from '../lib/phone-places.ts'
import { lastError, notice, ui, workspace } from '../lib/state.ts'
import { keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const route = useRoute()
const router = useRouter()
/** Where Home lands ("/" opens it, views/HomeView.vue): the page the space opens on, else its first sidebar item. */
const homePath = computed(() => {
  const space = workspace.space
  if (space?.opensOn?.kind === 'object') return `/o/${space.opensOn.id}`
  const first = space?.opensOn?.kind === 'today' ? undefined : space?.sidebar[0]?.items[0]
  return first ? sidebarItemPath(first) : '/'
})
function active(place: PhonePlace) {
  if (place.id === 'home') return route.path === '/' || route.path === homePath.value || (workspace.space?.opensOn?.kind === 'today' && isTodayRoute(route))
  if (place.id === 'today') return isTodayRoute(route)
  if (place.id === 'calendar') return (route.path === '/calendar' || route.path.startsWith('/day/')) && !(visiblePhonePlaces.value.some((item) => item.id === 'today') && isTodayRoute(route))
  return !!place.to && route.path === place.to
}
/**
 * The place showing tapped again goes back to its start (the calendar to today) or, already there,
 * to its top, as on an iPhone; neither adds a step for Back.
 */
function again(event: MouseEvent, place: PhonePlace) {
  event.preventDefault()
  const path = phonePlacePath(place)!
  if (place.id !== 'home' && route.fullPath !== path) void router.replace(path)
  else document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
}
const hidden = computed(() => keyboardInset.value > 80 || ui.surfaceFull)
</script>

<template>
  <template v-if="!hidden">
    <button
      class="fixed right-4 z-20 grid h-13 w-13 place-items-center rounded-2xl bg-ink text-surface shadow-[0_6px_16px_rgb(0_0_0/0.22)] transition-[bottom] duration-200 active:scale-95 motion-reduce:transition-none"
      :class="notice || lastError ? 'bottom-[calc(8rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]'"
      aria-label="Capture"
      data-capture-button
      @click="ui.captureOpen = true"
    >
      <AppIcon fallback="ph:plus" :size="24" />
    </button>
    <nav
      class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      aria-label="Places"
      data-tab-bar
    >
      <template v-for="tab in visiblePhonePlaces" :key="tab.id">
        <RouterLink v-if="phonePlacePath(tab)" v-slot="{ href, navigate }" :to="phonePlacePath(tab)!" custom>
          <a
            :href="href"
            class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px]"
            :class="active(tab) ? 'text-accent' : 'text-ink-soft'"
            :aria-current="active(tab) ? 'page' : undefined"
            :aria-label="tab.label"
            :data-tab="tab.label"
            @click="active(tab) ? again($event, tab) : navigate($event)"
          >
            <AppIcon :icon="tab.icon" :fallback="tab.fallback" :size="22" /><span class="w-full truncate text-center">{{ tab.label }}</span>
          </a>
        </RouterLink>
        <button v-else class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-ink-soft" :data-tab="tab.label" @click="tab.id === 'menu' ? (ui.sidebarOpen = true) : (ui.paletteOpen = true)">
          <AppIcon :fallback="tab.fallback" :size="22" />{{ tab.label }}
        </button>
      </template>
    </nav>
  </template>
</template>
