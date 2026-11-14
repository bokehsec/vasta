<script setup lang="ts">
// The bar at the bottom of a phone: places to go, as iPhone apps have (Home: what the space opens
// on; Tasks: the type's last picked view; Inbox; Calendar; Search), with Capture as a round button
// above it on the right. The sidebar stays behind the menu at the top left. Hidden while the
// keyboard is up or a full-screen surface (a whiteboard) is open; dialogs cover it; while rows are
// selected the bulk bar takes its place. Its z-index (20) is below the sidebar drawer's (30).
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { selecting } from '../lib/selection.ts'
import { lastError, notice, systemType, ui, workspace } from '../lib/state.ts'
import { keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const route = useRoute()
const taskType = computed(() => systemType('task'))
/** Where Home lands: the page the space opens on, when it is one (else "/" decides). */
const homePath = computed(() => (workspace.space?.opensOn?.kind === 'object' ? `/o/${workspace.space.opensOn.id}` : '/'))
const tabs = computed(() => [
  { label: 'Home', icon: 'ph:house', to: '/', active: route.path === '/' || route.path === homePath.value },
  ...(taskType.value ? [{ label: 'Tasks', icon: 'ph:check-circle', to: `/t/${taskType.value.id}`, active: route.path === `/t/${taskType.value.id}` }] : []),
  { label: 'Inbox', icon: 'ph:tray', to: '/inbox', active: route.path === '/inbox' },
  { label: 'Calendar', icon: 'ph:calendar-blank', to: '/calendar', active: route.path === '/calendar' || route.path.startsWith('/day/') },
])
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
      <RouterLink
        v-for="tab in tabs"
        :key="tab.label"
        :to="tab.to"
        class="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]"
        :class="tab.active ? 'text-accent' : 'text-ink-soft'"
        :aria-current="tab.active ? 'page' : undefined"
        :data-tab="tab.label"
      >
        <AppIcon :fallback="tab.icon" :size="22" />{{ tab.label }}
      </RouterLink>
      <button class="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-ink-soft" data-tab="Search" @click="ui.paletteOpen = true">
        <AppIcon fallback="ph:magnifying-glass" :size="22" />Search
      </button>
    </nav>
  </template>
</template>
