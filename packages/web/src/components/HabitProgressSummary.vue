<script setup lang="ts">
// Habit progress on the Tracker: the total over the range in a sentence, then one of the two
// charts (a trend line or a calendar of done days), above the habits or, as a column, beside them
// (below on a phone; then each habit's share too). Numbers from lib/habit-progress.ts (core
// habitReport), as the Progress tab counts them.
import { computed } from 'vue'
import { habitPercent, type HabitChart, type HabitTally, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor } from '../lib/habits.ts'
import { percentText, type ProgressDay, type ProgressWeek } from '../lib/habit-progress.ts'
import { isPhone } from '../lib/viewport.ts'
import HabitDaysChart from './HabitDaysChart.vue'
import HabitTrendChart from './HabitTrendChart.vue'

const props = defineProps<{
  chart: HabitChart
  weeks: number
  total: HabitTally
  byWeek: ProgressWeek[]
  days: ProgressDay[][]
  /** Beside the habits: a column, with each habit's share. */
  beside?: boolean
  habitRows: { habit: ObjectSummary; paused: boolean; row: { total: HabitTally } }[]
  progressLink: string
}>()

const thisWeek = computed(() => props.byWeek.at(-1))
/** The calendar shows at most 4 weeks on a phone, 8 on a computer when above the habits; a column has room for 13. */
const calendarDays = computed(() => (props.beside ? props.days : props.days.slice(-(isPhone.value ? 4 : 8))))
</script>

<template>
  <component :is="beside ? 'aside' : 'div'" :class="beside ? 'text-sm' : 'mb-5'" data-progress-summary :data-layout="beside ? 'beside' : 'above'" :data-chart="chart">
    <div class="flex flex-wrap items-end gap-x-7 gap-y-3">
      <div class="min-w-0 flex-1" data-progress-headline>
        <div class="text-[15px] font-semibold tabular-nums">{{ percentText(total) }} over the last {{ weeks }} weeks</div>
        <div class="mt-0.5 text-[13px] text-ink-soft">
          <span class="tabular-nums">{{ total.done }} of {{ total.expected }} done</span>
          <span v-if="thisWeek" class="tabular-nums"> · this week {{ thisWeek.tally.done }} so far</span> ·
          <RouterLink :to="progressLink" class="text-accent hover:underline">See progress</RouterLink>
        </div>
      </div>
      <HabitTrendChart v-if="chart === 'line' && !beside" :weeks="byWeek" :height="44" class="w-[200px] max-w-full max-sm:w-full" />
    </div>

    <HabitTrendChart v-if="chart === 'line' && beside" :weeks="byWeek" :height="96" labels class="mt-3" />
    <HabitDaysChart v-else-if="chart === 'calendar'" :days="calendarDays" :cell="beside ? 12 : isPhone ? 10 : 14" class="mt-3" />

    <!-- Beside the habits: each habit's share over the range, best first. -->
    <div v-if="beside" class="mt-4 grid gap-2 border-t border-line pt-3.5">
      <div v-for="r in habitRows" :key="r.habit.id" class="grid grid-cols-[minmax(0,1fr)_4.5rem_2.25rem] items-center gap-2 text-xs" :class="r.paused ? 'opacity-50' : ''" :title="`${r.habit.title}: ${r.row.total.done} of ${r.row.total.expected}`">
        <span class="flex min-w-0 items-center gap-1.5"><span class="size-2 shrink-0 rounded-full" :class="swatchClasses[habitColor(r.habit)]" /><span class="truncate">{{ r.habit.title || 'Untitled' }}</span></span>
        <span class="h-1.5 overflow-hidden rounded bg-hover"><i class="block h-full bg-[var(--color-chart)]" :style="{ width: `${habitPercent(r.row.total) ?? 0}%` }" /></span>
        <span class="text-right tabular-nums text-ink-soft">{{ percentText(r.row.total) }}</span>
      </div>
    </div>
  </component>
</template>
