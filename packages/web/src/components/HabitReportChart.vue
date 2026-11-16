<script setup lang="ts">
// The Progress tab's "Each week" chart, the one picked beside the range (HabitTypeSettings.report):
// bars of the share done each week, a trend line through the finished weeks, a calendar of days, or
// done and missed counts. The same four as the Tracker's panel, drawn to the tab's width. Numbers
// from lib/habit-progress.ts (core habitReport and habitDayTotals).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { HabitTally } from '@vasta/core'
import { dayLabel, heatStyle, longDayLabel, type PanelChart } from '../lib/habit-progress.ts'
import BarChart, { type Bar } from './charts/BarChart.vue'

type Week = { monday: string; tally: HabitTally; current: boolean; plan: number; percent: number | undefined }
type Day = { day: string; total?: { done: number; due: number }; future: boolean; today: boolean }
const props = defineProps<{ chart: PanelChart; weeks: number; byWeek: Week[]; days: Day[][] }>()

const root = ref<HTMLElement | null>(null)
const width = ref(600)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (width.value = Math.max(200, entry!.contentRect.width)))
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const H = 150
const LEFT = 30
const BOTTOM = H - 20
const TOP = 12
/** Every nth week label, so they don't run into each other. */
const labelEvery = computed(() => Math.max(1, Math.ceil((props.byWeek.length * 52) / Math.max(1, width.value - LEFT))))
const weekTitle = (w: Week) => (w.current ? `This week: ${w.tally.done} done so far, ${w.plan} planned` : `Week of ${dayLabel(w.monday)}: ${w.tally.done} of ${w.tally.expected}${w.tally.expected ? ` (${w.percent}%)` : ''}`)

// Bars: the shared column chart; this week and weeks with nothing to do faded.
const bars = computed<Bar[]>(() =>
  props.byWeek.map((w) => ({
    key: w.monday,
    label: w.current ? 'This week' : dayLabel(w.monday),
    title: `Week of ${dayLabel(w.monday)}${w.current ? ' (this week)' : ''}`,
    value: w.percent ?? 0,
    faded: w.current || !w.tally.expected,
    note: w.tally.expected ? `${w.tally.done} of ${w.tally.expected}` : 'Nothing scheduled',
  }))
)

// Line: finished weeks with something to do, 0–100%; the last one marked and labelled.
const RIGHT = 44
const y = (p: number) => BOTTOM - (p / 100) * (BOTTOM - TOP)
const points = computed(() => {
  const list = props.byWeek.filter((w) => !w.current && w.tally.expected)
  const step = list.length > 1 ? (width.value - LEFT - RIGHT) / (list.length - 1) : 0
  return list.map((w, i) => ({ w, x: LEFT + i * step, y: y(w.percent ?? 0) }))
})
const path = computed(() => points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))

// Done and missed: counts, the tallest week sets the scale; this week's still-possible part hatched.
const countTop = computed(() => Math.max(1, ...props.byWeek.map((w) => (w.current ? w.plan : w.tally.expected))))
const cy = (n: number) => BOTTOM - (n / countTop.value) * (BOTTOM - TOP)
const slot = computed(() => (width.value - LEFT) / Math.max(1, props.byWeek.length))
const colWidth = computed(() => Math.max(4, Math.min(30, slot.value * 0.6)))
const colX = (i: number) => LEFT + i * slot.value + (slot.value - colWidth.value) / 2

// Calendar: a row per week, Monday first.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const dayTitle = (d: Day) =>
  d.future ? `${longDayLabel(d.day)}: still to come` : d.total?.due ? `${longDayLabel(d.day)}: ${d.total.done} of ${d.total.due} done` : d.today ? `${longDayLabel(d.day)}: today, nothing done yet` : `${longDayLabel(d.day)}: nothing to do`
</script>

<template>
  <div ref="root" data-report-chart :data-chart="chart">
    <BarChart v-if="chart === 'weeks'" :bars="bars" label="Share done each week" :max="100" unit="%" :height="H" />

    <template v-else-if="chart === 'line'">
      <svg v-if="points.length" :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="block overflow-visible" role="img" :aria-label="`Share done each week, last ${weeks} weeks`">
        <g v-for="t in [0, 50, 100]" :key="t">
          <line :x1="LEFT" :x2="width - RIGHT + 8" :y1="y(t)" :y2="y(t)" stroke="var(--color-line)" stroke-width="1" shape-rendering="crispEdges" />
          <text :x="LEFT - 6" :y="y(t) + 3" font-size="10" fill="var(--color-ink-faint)" text-anchor="end">{{ t }}</text>
        </g>
        <path :d="path" fill="none" stroke="var(--color-chart)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />
        <g v-for="(p, i) in points" :key="p.w.monday">
          <circle :cx="p.x" :cy="p.y" :r="i === points.length - 1 ? 4.5 : 2.5" fill="var(--color-chart)" :stroke="i === points.length - 1 ? 'var(--color-surface)' : 'none'" stroke-width="2" />
          <text v-if="i % labelEvery === 0 || i === points.length - 1" :x="p.x" :y="H - 4" font-size="10" fill="var(--color-ink-faint)" text-anchor="middle">{{ dayLabel(p.w.monday) }}</text>
          <rect :x="p.x - 12" y="0" width="24" :height="H" fill="transparent"><title>{{ weekTitle(p.w) }}</title></rect>
        </g>
        <text :x="points.at(-1)!.x + 9" :y="points.at(-1)!.y + 4" font-size="12" font-weight="600" fill="var(--color-ink)">{{ points.at(-1)!.w.percent }}%</text>
      </svg>
      <p v-else class="py-6 text-sm text-ink-faint">A line shows once a week is over.</p>
    </template>

    <template v-else-if="chart === 'calendar'">
      <div class="grid max-w-[30rem] grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-1 text-[10px] text-ink-faint" role="img" :aria-label="`Share of each day's habits done, last ${weeks} weeks`">
        <span />
        <span v-for="(d, i) in WEEKDAYS" :key="i" class="text-center">{{ d }}</span>
        <template v-for="week in days" :key="week[0]!.day">
          <span class="self-center">{{ dayLabel(week[0]!.day) }}</span>
          <i
            v-for="d in week"
            :key="d.day"
            class="block rounded"
            :class="days.length > 8 ? 'h-4' : 'h-6'"
            :style="d.future ? { boxShadow: 'inset 0 0 0 1.5px var(--color-line)' } : heatStyle(d.total?.due ? d.total.done / d.total.due : undefined)"
            :title="dayTitle(d)"
          />
        </template>
      </div>
      <p class="mt-2 flex items-center gap-1 text-[11px] text-ink-faint">
        Share of the day's habits done
        <span class="inline-flex gap-0.5"><i v-for="s in [0, 0.25, 0.5, 0.75, 1]" :key="s" class="inline-block size-2.5 rounded-[2px]" :style="heatStyle(s)" /></span>
        less to more
      </p>
    </template>

    <template v-else>
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="block" role="img" :aria-label="`Done and missed each week, last ${weeks} weeks`">
        <defs>
          <pattern id="report-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="3" height="6" fill="var(--color-chart)" opacity="0.4" /></pattern>
        </defs>
        <line :x1="LEFT" :x2="width" :y1="BOTTOM" :y2="BOTTOM" stroke="var(--color-line-strong)" stroke-width="1" shape-rendering="crispEdges" />
        <g v-for="(w, i) in byWeek" :key="w.monday">
          <rect :x="colX(i)" :y="cy(w.tally.done)" :width="colWidth" :height="BOTTOM - cy(w.tally.done)" fill="var(--color-chart)" />
          <rect
            v-if="(w.current ? w.plan : w.tally.expected) > w.tally.done"
            :x="colX(i)"
            :y="cy(w.current ? w.plan : w.tally.expected)"
            :width="colWidth"
            :height="Math.max(0, cy(w.tally.done) - cy(w.current ? w.plan : w.tally.expected) - 1)"
            rx="2"
            :fill="w.current ? 'url(#report-hatch)' : 'var(--color-line-strong)'"
          />
          <text v-if="i % labelEvery === 0 || w.current" :x="w.current ? Math.min(colX(i) + colWidth / 2 + 24, width) : colX(i) + colWidth / 2" :y="H - 4" font-size="10" fill="var(--color-ink-faint)" :text-anchor="w.current ? 'end' : 'middle'">{{ w.current ? 'This week' : dayLabel(w.monday) }}</text>
          <rect :x="LEFT + i * slot" y="0" :width="slot" :height="BOTTOM" fill="transparent"><title>{{ weekTitle(w) }}</title></rect>
        </g>
      </svg>
      <div class="mt-2 flex gap-3.5 text-[11px] text-ink-faint">
        <span class="flex items-center gap-1"><i class="inline-block size-2.5 rounded-[2px] bg-[var(--color-chart)]" />Done</span>
        <span class="flex items-center gap-1"><i class="inline-block size-2.5 rounded-[2px] bg-line-strong" />Missed</span>
        <span class="flex items-center gap-1"><i class="hatch inline-block size-2.5 rounded-[2px]" />Still possible</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hatch {
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-chart) 40%, transparent) 0 3px, transparent 3px 6px);
}
</style>
