<script setup lang="ts" generic="T extends string">
// One of the Tracker's progress charts, picked in Type settings › Progress: a small drawing of
// each chart, its name and what it shows. Shared by the strip (above the habits) and panel (beside
// them) lists.
import AppIcon from './AppIcon.vue'

defineProps<{ charts: { id: T; label: string; hint: string }[]; modelValue: T }>()
defineEmits<{ update: [id: T] }>()
</script>

<template>
  <div class="space-y-0.5" data-chart-picker>
    <button
      v-for="c in charts"
      :key="c.id"
      class="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left max-md:min-h-[52px]"
      :class="modelValue === c.id ? 'bg-hover' : 'hover:bg-hover'"
      :aria-pressed="modelValue === c.id"
      :data-chart="c.id"
      @click="$emit('update', c.id)"
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
      <AppIcon v-if="modelValue === c.id" fallback="ph:check" :size="14" class="text-accent" />
    </button>
  </div>
</template>
