<script setup lang="ts">
// The Tracker's Progress button and its menu (a sheet on a phone): where progress shows on this
// device (off, above the habits, or beside them; below them on a phone). Which chart, and over how
// many weeks, is the type's own — Type settings › Progress (lib/habit-progress.ts).
import { computed, ref } from 'vue'
import { progressPlace, setProgressPlace, type ProgressPlace } from '../lib/habit-progress.ts'
import { greyButton, quietButton } from '../lib/buttons.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import PopoverMenu from './PopoverMenu.vue'

defineProps<{ compact?: boolean }>()
const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const place = progressPlace
const places = computed<{ id: ProgressPlace; label: string }[]>(() => [
  { id: 'off', label: 'Off' },
  { id: 'above', label: 'Above' },
  { id: 'beside', label: isPhone.value ? 'Below' : 'Beside' },
])
const placeLabel = computed(() => places.value.find((p) => p.id === place.value)!.label)
</script>

<template>
  <button
    ref="anchor"
    :class="compact ? quietButton : greyButton"
    data-progress-menu
    :aria-expanded="open"
    :aria-label="`Progress: ${placeLabel}`"
    :title="compact ? 'Progress settings' : undefined"
    @click="open = !open"
  >
    <AppIcon :fallback="compact ? 'ph:sliders-horizontal' : 'ph:chart-bar'" :size="15" /><template v-if="!compact"> Progress: {{ placeLabel }}</template>
  </button>
  <PopoverMenu v-model:open="open" :anchor="anchor" placement="bottom-end" width="20rem" label="Progress">
    <div class="text-sm" data-progress-options>
      <p class="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Progress on this {{ isPhone ? 'phone' : 'device' }}</p>
      <div class="mx-1.5 mb-2 flex rounded-lg bg-hover p-0.5" role="group" aria-label="Where progress shows">
        <button
          v-for="p in places"
          :key="p.id"
          class="min-h-8 flex-1 rounded-md px-2 max-md:min-h-11 max-md:text-[15px]"
          :class="place === p.id ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
          :aria-pressed="place === p.id"
          :data-place="p.id"
          @click="setProgressPlace(p.id)"
        >
          {{ p.label }}
        </button>
      </div>
      <p class="px-2.5 pb-1 text-xs text-ink-faint">The chart and the weeks are in Type settings › Progress.</p>
    </div>
  </PopoverMenu>
</template>
