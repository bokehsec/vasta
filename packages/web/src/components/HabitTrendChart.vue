<script setup lang="ts">
// Habit progress as a trend line: the share done each finished week, 0–100%, the last one marked
// and labelled. One of the two progress charts (the other is HabitDaysChart), drawn to its
// container's width and the `height` it is given, for the Tracker and the Progress tab alike;
// `labels` adds the scale and the first and last week's date.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { dayLabel, type ProgressWeek } from '../lib/habit-progress.ts'

const props = defineProps<{ weeks: ProgressWeek[]; height: number; labels?: boolean }>()

const root = ref<HTMLElement | null>(null)
const width = ref(240)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (width.value = Math.max(120, entry!.contentRect.width)))
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const LEFT = computed(() => (props.labels ? 26 : 4))
const RIGHT = 40
const TOP = 8
const bottom = computed(() => props.height - (props.labels ? 18 : 4))
const y = (percent: number) => bottom.value - (percent / 100) * (bottom.value - TOP)
const points = computed(() => {
  const list = props.weeks.filter((w) => !w.current && w.tally.expected)
  const step = list.length > 1 ? (width.value - LEFT.value - RIGHT) / (list.length - 1) : 0
  return list.map((w, i) => ({ w, x: LEFT.value + i * step, y: y(w.percent ?? 0) }))
})
const path = computed(() => points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const title = (w: ProgressWeek) => `Week of ${dayLabel(w.monday)}: ${w.tally.done} of ${w.tally.expected} (${w.percent}%)`
</script>

<template>
  <div ref="root" class="w-full" data-habit-trend>
    <svg v-if="points.length" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block overflow-visible" role="img" :aria-label="`Share done each week, last ${weeks.length} weeks`">
      <g v-for="t in [0, 50, 100]" :key="t">
        <line :x1="LEFT" :x2="width - RIGHT + 8" :y1="y(t)" :y2="y(t)" stroke="var(--color-line)" stroke-width="1" shape-rendering="crispEdges" />
        <text v-if="labels" :x="LEFT - 6" :y="y(t) + 3" font-size="10" fill="var(--color-ink-faint)" text-anchor="end">{{ t }}</text>
      </g>
      <path :d="path" fill="none" stroke="var(--color-chart)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />
      <g v-for="(p, i) in points" :key="p.w.monday">
        <circle :cx="p.x" :cy="p.y" :r="i === points.length - 1 ? 4 : 2.5" fill="var(--color-chart)" :stroke="i === points.length - 1 ? 'var(--color-surface)' : 'none'" stroke-width="2" />
        <rect :x="p.x - 10" y="0" width="20" :height="height" fill="transparent"><title>{{ title(p.w) }}</title></rect>
      </g>
      <text :x="points.at(-1)!.x + 9" :y="points.at(-1)!.y + 4" font-size="12" font-weight="600" fill="var(--color-ink)">{{ points.at(-1)!.w.percent }}%</text>
      <template v-if="labels">
        <text :x="points[0]!.x" :y="height - 3" font-size="10" fill="var(--color-ink-faint)" text-anchor="start">{{ dayLabel(points[0]!.w.monday) }}</text>
        <text v-if="points.length > 1" :x="points.at(-1)!.x" :y="height - 3" font-size="10" fill="var(--color-ink-faint)" text-anchor="middle">{{ dayLabel(points.at(-1)!.w.monday) }}</text>
      </template>
    </svg>
    <p v-else class="py-2 text-xs text-ink-faint">A line shows once a week is over.</p>
  </div>
</template>
