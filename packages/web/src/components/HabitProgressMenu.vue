<script setup lang="ts">
// The Tracker's Progress button and its menu (a sheet on a phone): where progress shows on this
// device (off, above the habits, or beside them; below them on a phone), which chart, and the
// range. Saved per device (lib/habit-progress.ts).
import { computed, ref } from 'vue'
import { PANEL_CHARTS, STRIP_CHARTS, progressLayout, setProgressLayout, type PanelChart, type ProgressPlace, type StripChart } from '../lib/habit-progress.ts'
import { greyButton, quietButton } from '../lib/buttons.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import PopoverMenu from './PopoverMenu.vue'

defineProps<{ compact?: boolean }>()
const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const layout = progressLayout
const places = computed<{ id: ProgressPlace; label: string }[]>(() => [
  { id: 'off', label: 'Off' },
  { id: 'above', label: 'Above' },
  { id: 'beside', label: isPhone.value ? 'Below' : 'Beside' },
])
const placeLabel = computed(() => places.value.find((p) => p.id === layout.value.place)!.label)
const charts = computed(() => (layout.value.place === 'beside' ? PANEL_CHARTS : STRIP_CHARTS))
const chosen = computed(() => (layout.value.place === 'beside' ? layout.value.panel : layout.value.strip))
function pick(id: string) {
  if (layout.value.place === 'beside') setProgressLayout({ panel: id as PanelChart })
  else setProgressLayout({ strip: id as StripChart })
}
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
          :class="layout.place === p.id ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
          :aria-pressed="layout.place === p.id"
          :data-place="p.id"
          @click="setProgressLayout({ place: p.id })"
        >
          {{ p.label }}
        </button>
      </div>
      <template v-if="layout.place !== 'off'">
        <p class="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Chart</p>
        <button
          v-for="c in charts"
          :key="c.id"
          class="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left max-md:min-h-[52px]"
          :class="chosen === c.id ? 'bg-hover' : 'hover:bg-hover'"
          :aria-pressed="chosen === c.id"
          :data-chart="c.id"
          @click="pick(c.id)"
        >
          <span class="grid h-8 place-items-center overflow-hidden rounded-md border border-line bg-surface" aria-hidden="true">
            <svg width="44" height="20" viewBox="0 0 44 20">
              <template v-if="c.id === 'weeks'">
                <rect v-for="(h, i) in [10, 13, 9, 7]" :key="i" :x="4 + i * 9" :y="18 - h" width="6" :height="h" rx="1.5" fill="var(--color-chart)" :opacity="i === 3 ? 0.4 : 1" />
              </template>
              <template v-else-if="c.id === 'days' || c.id === 'calendar'">
                <rect v-for="i in 14" :key="i" :x="1 + ((i - 1) % 7) * 6" :y="c.id === 'days' ? 7 : 3 + Math.floor((i - 1) / 7) * 7" width="5" :height="c.id === 'days' ? 6 : 6" rx="1" fill="var(--color-chart-heat)" :opacity="[0.9, 0.5, 0.7, 0.3, 0.8, 0.4, 0.2, 0.6, 0.9, 0.5, 0.3, 0.7, 0.4, 0.6][i - 1]" />
              </template>
              <template v-else-if="c.id === 'meters'">
                <g v-for="(w, i) in [26, 20, 30]" :key="i"><rect x="3" :y="3 + i * 6" width="38" height="3" rx="1.5" fill="var(--color-hover)" /><rect x="3" :y="3 + i * 6" :width="w" height="3" rx="1.5" fill="var(--color-chart)" /></g>
              </template>
              <template v-else-if="c.id === 'habits'">
                <g v-for="(w, i) in [10, 8, 12]" :key="i"><rect :x="1 + (i % 2) * 22" :y="2 + Math.floor(i / 2) * 9" width="20" height="7" rx="2" fill="none" stroke="var(--color-line-strong)" /><rect :x="4 + (i % 2) * 22" :y="5 + Math.floor(i / 2) * 9" :width="w" height="1.5" fill="var(--color-chart)" /></g>
              </template>
              <template v-else-if="c.id === 'line'">
                <polyline points="3,13 11,9 19,11 27,6 35,8 41,12" fill="none" stroke="var(--color-chart)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              </template>
              <template v-else>
                <g v-for="(d, i) in [9, 12, 8, 10]" :key="i"><rect :x="4 + i * 9" :y="18 - d" width="6" :height="d" fill="var(--color-chart)" /><rect :x="4 + i * 9" :y="18 - d - (14 - d)" width="6" :height="12 - d" rx="1" fill="var(--color-line-strong)" /></g>
              </template>
            </svg>
          </span>
          <span class="min-w-0">
            <span class="block font-medium">{{ c.label }}</span>
            <span class="block truncate text-xs text-ink-faint">{{ c.hint }}</span>
          </span>
          <AppIcon v-if="chosen === c.id" fallback="ph:check" :size="14" class="text-accent" />
        </button>
        <p class="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Range</p>
        <div class="mx-1.5 mb-1 flex rounded-lg bg-hover p-0.5" role="group" aria-label="Range">
          <button
            v-for="w in [4, 8, 13] as const"
            :key="w"
            class="min-h-8 flex-1 rounded-md px-2 max-md:min-h-11 max-md:text-[15px]"
            :class="layout.weeks === w ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
            :aria-pressed="layout.weeks === w"
            :data-weeks="w"
            @click="setProgressLayout({ weeks: w })"
          >
            {{ w }} weeks
          </button>
        </div>
      </template>
    </div>
  </PopoverMenu>
</template>
