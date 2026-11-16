<script setup lang="ts">
// Habit progress as a strip above the habits (Tracker): the total over the range in a sentence,
// then one of four small charts: week columns, a heat strip of days, week meters or a chip per
// habit. Numbers from lib/habit-progress.ts (core habitReport), as the Progress tab counts them.
import { computed } from 'vue'
import type { HabitTally, ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor } from '../lib/habits.ts'
import { dayLabel, heatStyle, longDayLabel, percentOf, percentText, type StripChart } from '../lib/habit-progress.ts'
import { isPhone } from '../lib/viewport.ts'

type Week = { monday: string; tally: HabitTally; current: boolean; plan: number; percent: number | undefined }
type Day = { day: string; total?: { done: number; due: number }; future: boolean; today: boolean }
const props = defineProps<{
  chart: StripChart
  weeks: number
  total: HabitTally
  byWeek: Week[]
  days: Day[][]
  habitRows: { habit: ObjectSummary; paused: boolean; row: { total: HabitTally } }[]
  progressLink: string
}>()

const thisWeek = computed(() => props.byWeek.at(-1))
/** The heat strip shows at most 4 weeks of days on a phone, 8 on a computer. */
const heatWeeks = computed(() => props.days.slice(-(isPhone.value ? 4 : 8)))
const meterWeeks = computed(() => props.byWeek.slice(-5))
const dayTitle = (d: Day) =>
  d.future ? `${longDayLabel(d.day)}: still to come` : d.total?.due ? `${longDayLabel(d.day)}: ${d.total.done} of ${d.total.due} done` : d.today ? `${longDayLabel(d.day)}: today, nothing done yet` : `${longDayLabel(d.day)}: nothing to do`
const weekTitle = (w: Week) => (w.current ? `This week: ${w.tally.done} done so far, ${w.plan} planned` : `Week of ${dayLabel(w.monday)}: ${w.tally.done} of ${w.tally.expected}${w.tally.expected ? ` (${w.percent}%)` : ''}`)
</script>

<template>
  <div class="mb-5" data-progress-strip :data-chart="chart">
    <div class="flex flex-wrap items-end gap-x-7 gap-y-3">
      <div class="min-w-0 flex-1" data-progress-headline>
        <div class="text-[15px] font-semibold tabular-nums">{{ percentText(total) }} over the last {{ weeks }} weeks</div>
        <div class="mt-0.5 text-[13px] text-ink-soft">
          <span class="tabular-nums">{{ total.done }} of {{ total.expected }} done</span>
          <span v-if="thisWeek" class="tabular-nums"> · this week {{ thisWeek.tally.done }} so far</span> ·
          <RouterLink :to="progressLink" class="text-accent hover:underline">See progress</RouterLink>
        </div>
      </div>

      <!-- Week columns: share done each week, this week faded while under way. -->
      <div v-if="chart === 'weeks'" class="flex items-end gap-1.5" role="img" :aria-label="`Share done each week, last ${weeks} weeks`">
        <div v-for="w in byWeek" :key="w.monday" class="grid justify-items-center gap-1" :title="weekTitle(w)">
          <div class="relative h-11 overflow-hidden rounded bg-hover" :class="byWeek.length > 8 ? 'w-3.5 sm:w-5' : 'w-6'">
            <i class="absolute inset-x-0 bottom-0 rounded-t bg-[var(--color-chart)]" :class="w.current ? 'opacity-40' : ''" :style="{ height: `${w.current ? percentOf({ done: w.tally.done, expected: w.plan }) ?? 0 : (w.percent ?? 0)}%` }" />
          </div>
          <span class="text-[11px] tabular-nums text-ink-faint">{{ Number(w.monday.slice(8)) }}</span>
        </div>
      </div>
    </div>

    <!-- Day heat strip: every day, darker when more of its habits got done. -->
    <template v-if="chart === 'days'">
      <div class="mt-3 flex gap-1.5 sm:gap-2" role="img" :aria-label="`Share of each day's habits done, last ${heatWeeks.length} weeks`">
        <div v-for="week in heatWeeks" :key="week[0]!.day" class="grid min-w-0 gap-1">
          <div class="flex gap-0.5 sm:gap-[3px]">
            <i
              v-for="d in week"
              :key="d.day"
              class="block size-[9.5px] rounded-[2px] sm:size-3.5 sm:rounded-[3px]"
              :class="d.future ? 'opacity-0' : ''"
              :style="heatStyle(d.total?.due ? d.total.done / d.total.due : undefined)"
              :title="dayTitle(d)"
            />
          </div>
          <span class="text-[11px] text-ink-faint">{{ dayLabel(week[0]!.day) }}</span>
        </div>
      </div>
      <p class="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
        Share of the day's habits done
        <span class="inline-flex gap-0.5"><i v-for="s in [0, 0.25, 0.5, 0.75, 1]" :key="s" class="inline-block size-2.5 rounded-[2px]" :style="heatStyle(s)" /></span>
        less to more
      </p>
    </template>

    <!-- Week meters: a bar per week; this week's still-possible part hatched. -->
    <div v-else-if="chart === 'meters'" class="mt-3 grid max-w-md gap-1.5 text-xs" role="img" aria-label="Share done each week">
      <div v-for="w in meterWeeks" :key="w.monday" class="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-2.5" :title="weekTitle(w)">
        <span class="text-ink-faint">{{ w.current ? 'This week' : dayLabel(w.monday) }}</span>
        <span class="flex h-2 gap-0.5 overflow-hidden rounded bg-hover">
          <template v-if="w.current">
            <i class="block h-full bg-[var(--color-chart)]" :style="{ width: `${w.plan ? (w.tally.done / w.plan) * 100 : 0}%` }" />
            <s class="hatch block h-full flex-1" />
          </template>
          <i v-else class="block h-full bg-[var(--color-chart)]" :style="{ width: `${w.percent ?? 0}%` }" />
        </span>
        <span class="text-right tabular-nums text-ink-soft">{{ w.current ? `${w.tally.done} of ${w.plan}` : percentText(w.tally) }}</span>
      </div>
    </div>

    <!-- Habit chips: each habit's share over the range. -->
    <div v-else-if="chart === 'habits'" class="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <div v-for="r in habitRows" :key="r.habit.id" class="min-w-0 rounded-[10px] border border-line px-2.5 pb-2 pt-1.5 sm:min-w-32" :class="r.paused ? 'opacity-50' : ''" :title="`${r.habit.title}: ${r.row.total.done} of ${r.row.total.expected}`">
        <div class="flex items-center gap-1.5 text-xs font-medium sm:text-[13px]">
          <span class="size-2 shrink-0 rounded-full" :class="swatchClasses[habitColor(r.habit)]" />
          <span class="truncate">{{ r.habit.title || 'Untitled' }}</span>
          <span class="ml-auto pl-1 tabular-nums text-ink-soft">{{ percentText(r.row.total) }}</span>
        </div>
        <div class="mt-1.5 h-1 overflow-hidden rounded-sm bg-hover"><i class="block h-full bg-[var(--color-chart)]" :style="{ width: `${percentOf(r.row.total) ?? 0}%` }" /></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hatch {
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-chart) 35%, transparent) 0 3px, transparent 3px 6px);
}
</style>
