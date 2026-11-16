<script setup lang="ts">
// Habit progress as a panel beside the habits (Tracker; under them on a phone): the total over the
// range, a chart over time (week columns, a trend line, a calendar of days, or done and missed
// counts), then the habits (ranked, done of expected, or each habit's own weeks). Numbers from
// lib/habit-progress.ts (core habitReport), as the Progress tab counts them.
import { computed } from 'vue'
import type { HabitTally, Id, ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor } from '../lib/habits.ts'
import { dayLabel, heatStyle, longDayLabel, percentOf, percentText, type PanelChart } from '../lib/habit-progress.ts'

type Week = { monday: string; tally: HabitTally; current: boolean; plan: number; percent: number | undefined }
type Day = { day: string; total?: { done: number; due: number }; future: boolean; today: boolean }
const props = defineProps<{
  chart: PanelChart
  weeks: number
  total: HabitTally
  byWeek: Week[]
  days: Day[][]
  habitRows: { habit: ObjectSummary; paused: boolean; row: { id: Id; total: HabitTally; byWeek: HabitTally[] } }[]
  progressLink: string
}>()

const finished = computed(() => props.byWeek.filter((w) => !w.current))
const weekTitle = (w: Week) => (w.current ? `This week: ${w.tally.done} done so far, ${w.plan} planned` : `Week of ${dayLabel(w.monday)}: ${w.tally.done} of ${w.tally.expected}${w.tally.expected ? ` (${w.percent}%)` : ''}`)
const dayTitle = (d: Day) =>
  d.future ? `${longDayLabel(d.day)}: still to come` : d.total?.due ? `${longDayLabel(d.day)}: ${d.total.done} of ${d.total.due} done` : d.today ? `${longDayLabel(d.day)}: today, nothing done yet` : `${longDayLabel(d.day)}: nothing to do`

// The trend line: finished weeks' share done, 0–100%.
const W = 240
const H = 96
const PLOT = { left: 22, top: 10, bottom: 82 }
const y = (p: number) => PLOT.bottom - (p / 100) * (PLOT.bottom - PLOT.top)
const points = computed(() => {
  const list = finished.value.filter((w) => w.tally.expected)
  const step = list.length > 1 ? (W - PLOT.left - 6) / (list.length - 1) : 0
  return list.map((w, i) => ({ w, x: PLOT.left + i * step, y: y(w.percent ?? 0) }))
})
const path = computed(() => points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))

// Done and missed: the tallest week sets the scale.
const countTop = computed(() => Math.max(1, ...props.byWeek.map((w) => (w.current ? w.plan : w.tally.expected))))
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
</script>

<template>
  <aside class="text-sm" data-progress-panel :data-chart="chart">
    <h3 class="text-[13px] font-semibold">Last {{ weeks }} weeks</h3>
    <div class="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums" data-progress-headline>{{ percentText(total) }}</div>
    <p class="mt-1.5 text-xs text-ink-soft">
      <span class="tabular-nums">{{ total.done }} of {{ total.expected }} done</span> · using your current goals ·
      <RouterLink :to="progressLink" class="text-accent hover:underline">See progress</RouterLink>
    </p>

    <!-- Columns: each week's share done; this week faded. -->
    <template v-if="chart === 'weeks'">
      <div class="mt-3.5 flex h-[90px] items-end gap-[3px] border-b border-line-strong" role="img" :aria-label="`Share done each week, last ${weeks} weeks`">
        <i
          v-for="w in byWeek"
          :key="w.monday"
          class="block flex-1 rounded-t bg-[var(--color-chart)]"
          :class="w.current ? 'opacity-40' : ''"
          :style="{ height: `${Math.max(2, w.current ? (percentOf({ done: w.tally.done, expected: w.plan }) ?? 0) : (w.percent ?? 0))}%` }"
          :title="weekTitle(w)"
        />
      </div>
      <div class="mt-1 flex justify-between text-[11px] text-ink-faint"><span>{{ dayLabel(byWeek[0]!.monday) }}</span><span>this week</span></div>
    </template>

    <!-- Trend: one line through the finished weeks. -->
    <template v-else-if="chart === 'line'">
      <svg :viewBox="`0 0 ${W} ${H}`" width="100%" :height="H" class="mt-3 overflow-visible" role="img" :aria-label="`Share done each week, last ${weeks} weeks`">
        <g v-for="t in [0, 50, 100]" :key="t">
          <line :x1="PLOT.left" :x2="W" :y1="y(t)" :y2="y(t)" stroke="var(--color-line)" stroke-width="1" shape-rendering="crispEdges" />
          <text :x="PLOT.left - 5" :y="y(t) + 3" font-size="9" fill="var(--color-ink-faint)" text-anchor="end">{{ t }}</text>
        </g>
        <path :d="path" fill="none" stroke="var(--color-chart)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <g v-for="(p, i) in points" :key="p.w.monday">
          <circle v-if="i === points.length - 1" :cx="p.x" :cy="p.y" r="4" fill="var(--color-chart)" stroke="var(--color-surface)" stroke-width="2" />
          <rect :x="p.x - 10" y="0" width="20" :height="H" fill="transparent"><title>{{ weekTitle(p.w) }}</title></rect>
        </g>
        <text v-if="points.length" :x="points.at(-1)!.x - 4" :y="points.at(-1)!.y - 9" font-size="11" font-weight="600" fill="var(--color-ink)" text-anchor="end">{{ points.at(-1)!.w.percent }}%</text>
      </svg>
      <div v-if="points.length" class="mt-1 flex justify-between text-[11px] text-ink-faint"><span>{{ dayLabel(points[0]!.w.monday) }}</span><span>{{ dayLabel(points.at(-1)!.w.monday) }}</span></div>
      <p v-else class="mt-2 text-xs text-ink-faint">A line shows once a week is over.</p>
    </template>

    <!-- Calendar: each day, weeks as rows. -->
    <template v-else-if="chart === 'calendar'">
      <div class="mt-3 grid max-w-[17rem] grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] gap-[3px] text-[10px] text-ink-faint" role="img" :aria-label="`Share of each day's habits done, last ${weeks} weeks`">
        <span />
        <span v-for="(d, i) in WEEKDAYS" :key="i" class="text-center">{{ d }}</span>
        <template v-for="week in days" :key="week[0]!.day">
          <span class="self-center">{{ Number(week[0]!.day.slice(8)) }}</span>
          <i v-for="d in week" :key="d.day" class="block aspect-square rounded-[3px]" :class="[d.future ? 'opacity-0' : '', days.length > 8 ? 'max-h-3.5' : '']" :style="heatStyle(d.total?.due ? d.total.done / d.total.due : undefined)" :title="dayTitle(d)" />
        </template>
      </div>
      <p class="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
        Share of habits done
        <span class="inline-flex gap-0.5"><i v-for="s in [0, 0.25, 0.5, 0.75, 1]" :key="s" class="inline-block size-2.5 rounded-[2px]" :style="heatStyle(s)" /></span>
      </p>
    </template>

    <!-- Done and missed: counts per week; this week's still-possible part hatched. -->
    <template v-else>
      <div class="mt-3.5 flex h-24 items-end gap-[3px] border-b border-line-strong" role="img" :aria-label="`Done and missed each week, last ${weeks} weeks`">
        <div v-for="w in byWeek" :key="w.monday" class="flex h-full flex-1 flex-col justify-end gap-0.5" :title="w.current ? weekTitle(w) : `Week of ${dayLabel(w.monday)}: ${w.tally.done} done, ${w.tally.expected - w.tally.done} missed`">
          <template v-if="w.current">
            <b class="hatch block rounded-t" :style="{ height: `${((w.plan - w.tally.expected) / countTop) * 100}%` }" />
            <b class="block bg-line-strong" :style="{ height: `${((w.tally.expected - w.tally.done) / countTop) * 100}%` }" />
            <i class="block bg-[var(--color-chart)]" :style="{ height: `${(w.tally.done / countTop) * 100}%` }" />
          </template>
          <template v-else>
            <b class="block rounded-t bg-line-strong" :style="{ height: `${((w.tally.expected - w.tally.done) / countTop) * 100}%` }" />
            <i class="block bg-[var(--color-chart)]" :class="w.tally.expected === w.tally.done ? 'rounded-t' : ''" :style="{ height: `${(w.tally.done / countTop) * 100}%` }" />
          </template>
        </div>
      </div>
      <div class="mt-1 flex justify-between text-[11px] text-ink-faint"><span>{{ dayLabel(byWeek[0]!.monday) }}</span><span>this week</span></div>
      <div class="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-faint">
        <span class="flex items-center gap-1"><i class="inline-block size-2.5 rounded-[2px] bg-[var(--color-chart)]" />Done</span>
        <span class="flex items-center gap-1"><i class="inline-block size-2.5 rounded-[2px] bg-line-strong" />Missed</span>
        <span class="flex items-center gap-1"><i class="hatch inline-block size-2.5 rounded-[2px]" />Still possible</span>
      </div>
    </template>

    <!-- The habits. -->
    <div class="mt-4 border-t border-line pt-3.5">
      <!-- Done of expected. -->
      <div v-if="chart === 'line'" class="grid gap-2.5">
        <div v-for="r in habitRows" :key="r.habit.id" :class="r.paused ? 'opacity-50' : ''" :title="`${r.habit.title}: ${r.row.total.done} of ${r.row.total.expected}`">
          <div class="flex items-center gap-1.5 text-xs">
            <span class="size-2 shrink-0 rounded-full" :class="swatchClasses[habitColor(r.habit)]" />
            <span class="truncate">{{ r.habit.title || 'Untitled' }}</span>
            <span class="ml-auto shrink-0 pl-2 tabular-nums text-ink-soft">{{ r.row.total.done }} of {{ r.row.total.expected }}</span>
          </div>
          <div class="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded bg-hover"><i class="block h-full bg-[var(--color-chart)]" :style="{ width: `${percentOf(r.row.total) ?? 0}%` }" /></div>
        </div>
      </div>
      <!-- Each habit's own weeks. -->
      <div v-else-if="chart === 'calendar'" class="grid gap-2">
        <div v-for="r in habitRows" :key="r.habit.id" class="grid grid-cols-[minmax(0,1fr)_4.5rem_2.25rem] items-center gap-2 text-xs" :class="r.paused ? 'opacity-50' : ''">
          <span class="flex min-w-0 items-center gap-1.5"><span class="size-2 shrink-0 rounded-full" :class="swatchClasses[habitColor(r.habit)]" /><span class="truncate">{{ r.habit.title || 'Untitled' }}</span></span>
          <span class="flex h-4 items-end gap-px" role="img" :aria-label="`${r.habit.title}: each week`">
            <i
              v-for="(t, i) in r.row.byWeek"
              :key="i"
              class="block min-h-px flex-1 rounded-t-[1.5px]"
              :class="t.expected ? 'bg-[var(--color-chart)]' : 'bg-line-strong'"
              :style="{ height: t.expected ? `${Math.max(6, percentOf(t) ?? 0)}%` : '1px' }"
              :title="`Week of ${dayLabel(byWeek[i]!.monday)}: ${t.done} of ${t.expected}`"
            />
          </span>
          <span class="text-right tabular-nums text-ink-soft">{{ percentText(r.row.total) }}</span>
        </div>
      </div>
      <!-- Ranked. -->
      <div v-else class="grid gap-2">
        <div v-for="r in habitRows" :key="r.habit.id" class="grid grid-cols-[minmax(0,1fr)_4.5rem_2.25rem] items-center gap-2 text-xs" :class="r.paused ? 'opacity-50' : ''" :title="`${r.habit.title}: ${r.row.total.done} of ${r.row.total.expected}`">
          <span class="flex min-w-0 items-center gap-1.5"><span class="size-2 shrink-0 rounded-full" :class="swatchClasses[habitColor(r.habit)]" /><span class="truncate">{{ r.habit.title || 'Untitled' }}</span></span>
          <span class="h-1.5 overflow-hidden rounded bg-hover"><i class="block h-full bg-[var(--color-chart)]" :style="{ width: `${percentOf(r.row.total) ?? 0}%` }" /></span>
          <span class="text-right tabular-nums text-ink-soft">{{ percentText(r.row.total) }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.hatch {
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-chart) 35%, transparent) 0 3px, transparent 3px 6px);
}
</style>
