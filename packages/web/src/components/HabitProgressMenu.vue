<script setup lang="ts">
// The Tracker's Display button (beside Filter; beside Filters on a phone; not "Progress", the tab
// beside it) and its menu, a sheet on
// a phone: where progress shows (off, above the habits, or beside them; below them on a phone), its
// chart and over how many weeks. Saved on the habit type, so every device shows the same
// (lib/habit-progress.ts). The menu stays open while picking, so each change shows behind it.
import { computed, ref } from 'vue'
import { HABIT_WEEKS_RANGES, type ObjectType } from '@vasta/core'
import { greyButton } from '../lib/buttons.ts'
import { habitProgressOf, PANEL_CHARTS, saveHabitProgress, STRIP_CHARTS, type ProgressPlace } from '../lib/habit-progress.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import HabitChartPicker from './HabitChartPicker.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType }>()
const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const settings = computed(() => habitProgressOf(props.type))
const places = computed<{ id: ProgressPlace; label: string }[]>(() => [
  { id: 'off', label: 'Off' },
  { id: 'above', label: 'Above' },
  { id: 'beside', label: isPhone.value ? 'Below' : 'Beside' },
])
const seg = 'min-h-8 flex-1 rounded-md px-2 max-md:min-h-11 max-md:text-[15px]'
const segOn = (on: boolean) => (on ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink')
</script>

<template>
  <button
    ref="anchor"
    :class="isPhone ? greyButton : 'flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover hover:text-ink'"
    data-progress-menu
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click="open = !open"
  >
    <AppIcon fallback="ph:sliders-horizontal" :size="isPhone ? 16 : 14" /> Display
  </button>
  <PopoverMenu v-model:open="open" :anchor="anchor" placement="bottom-end" width="20rem" label="Progress on the Tracker">
    <div class="text-sm" data-progress-options>
      <p class="px-2.5 pb-1.5 pt-1 text-base font-semibold md:text-sm">Progress on the Tracker</p>
      <div class="mx-1.5 flex rounded-lg bg-hover p-0.5" role="group" aria-label="Where progress shows">
        <button v-for="p in places" :key="p.id" :class="[seg, segOn(settings.place === p.id)]" :aria-pressed="settings.place === p.id" :data-place="p.id" @click="saveHabitProgress(type, { place: p.id })">
          {{ p.label }}
        </button>
      </div>
      <template v-if="settings.place !== 'off'">
        <div class="mt-1.5">
          <HabitChartPicker v-if="settings.place === 'above'" picker="strip" :charts="STRIP_CHARTS" :model-value="settings.strip" @update="(id) => saveHabitProgress(type, { strip: id })" />
          <HabitChartPicker v-else picker="panel" :charts="PANEL_CHARTS" :model-value="settings.panel" @update="(id) => saveHabitProgress(type, { panel: id })" />
        </div>
        <div class="mx-1.5 mb-1 mt-1.5 flex rounded-lg bg-hover p-0.5" role="group" aria-label="Progress range">
          <button v-for="w in HABIT_WEEKS_RANGES" :key="w" :class="[seg, segOn(settings.weeks === w)]" :aria-pressed="settings.weeks === w" :data-weeks="w" @click="saveHabitProgress(type, { weeks: w })">
            {{ w }} weeks
          </button>
        </div>
      </template>
      <p v-else class="px-2.5 pb-1 pt-2 text-xs text-ink-faint">Just the habits. The Progress tab still has the full report.</p>
    </div>
  </PopoverMenu>
</template>
