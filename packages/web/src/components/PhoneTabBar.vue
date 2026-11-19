<script setup lang="ts">
// The bar at the bottom of a phone: places chosen in Settings, with the one "+" as a round button
// above it on the right: on a type's page it starts a new item of that type from the view (the quick
// card, lib/new-item.ts); elsewhere it opens quick capture. The sidebar stays behind the menu at the top left (and Menu here, if
// chosen). Hidden while the keyboard is up or a full-screen surface (a whiteboard) is open; dialogs
// cover it. Its z-index (20) is below the sidebar drawer's (30).
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { isTodayRoute } from '../lib/actions.ts'
import { myHomeId, openHome } from '../lib/home.ts'
import { phonePlacePath, visiblePhonePlaces, type PhonePlace } from '../lib/phone-places.ts'
import { newPlace, startNew } from '../lib/new-item.ts'
import { lastError, notice, typesById, ui } from '../lib/state.ts'
import { keyboardInset } from '../lib/viewport.ts'
import { metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'

const route = useRoute()
const router = useRouter()
/** Home always belongs to this person, even when the space opens on Today or a shared page. */
const homePath = computed(() => myHomeId.value ? `/o/${myHomeId.value}` : '/')
function active(place: PhonePlace) {
  if (place.id === 'home') return !!myHomeId.value && route.path === homePath.value
  if (place.id === 'today') return isTodayRoute(route)
  if (place.id === 'calendar') return (route.path === '/calendar' || route.path.startsWith('/day/')) && !(visiblePhonePlaces.value.some((item) => item.id === 'today') && isTodayRoute(route))
  return !!place.to && route.path === place.to
}
function goHome(event: MouseEvent) {
  event.preventDefault()
  void openHome()
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
/** The type a "+" here makes an item of: the type page showing; none elsewhere (a note is captured). */
const newType = computed(() => (newPlace.value ? typesById.value.get(newPlace.value.typeId) : undefined))
const plus = () => (newType.value ? startNew(newType.value.id, { capture: true, template: 'blank' }) : (ui.captureOpen = true))
const hidden = computed(() => keyboardInset.value > 80 || ui.surfaceFull)
</script>

<template>
  <template v-if="!hidden">
    <button
      class="fixed right-4 z-20 grid h-13 w-13 place-items-center rounded-2xl bg-ink text-surface shadow-[0_6px_16px_rgb(0_0_0/0.22)] transition-[bottom] duration-200 active:scale-95 motion-reduce:transition-none"
      :class="notice || lastError ? 'bottom-[calc(8rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]'"
      :aria-label="newType ? `New ${newType.name}` : 'Capture'"
      data-capture-button
      @click="plus"
    >
      <AppIcon fallback="ph:plus" :size="24" />
    </button>
    <nav
      class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      aria-label="Places"
      data-tab-bar
    >
      <template v-for="tab in visiblePhonePlaces" :key="tab.id">
        <RouterLink v-if="phonePlacePath(tab)" v-slot="{ href, navigate }" :to="tab.id === 'home' ? homePath : phonePlacePath(tab)!" custom>
          <a
            :href="href"
            class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1"
            :class="[metaText, active(tab) ? 'text-accent' : 'text-ink-soft']"
            :aria-current="active(tab) ? 'page' : undefined"
            :aria-label="tab.label"
            :data-tab="tab.label"
            @click="active(tab) ? again($event, tab) : tab.id === 'home' ? goHome($event) : navigate($event)"
          >
            <AppIcon :icon="tab.icon" :fallback="tab.fallback" :size="22" /><span class="w-full truncate text-center">{{ tab.label }}</span>
          </a>
        </RouterLink>
        <button v-else class="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-ink-soft" :class="metaText" :data-tab="tab.label" @click="tab.id === 'menu' ? (ui.sidebarOpen = true) : (ui.paletteOpen = true)">
          <AppIcon :fallback="tab.fallback" :size="22" />{{ tab.label }}
        </button>
      </template>
    </nav>
  </template>
</template>
