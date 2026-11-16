<script setup lang="ts">
// The Habits page's Progress view: how much of what the habits asked for got done over the last
// 4, 8 or 13 whole weeks (core habitReport: done ÷ expected, added up, never an average of
// percents). A headline, a chart of each week (bars, a line, a calendar of days or done and missed)
// and a row per habit with its own weeks. The range and the chart are the habit type's (Type
// settings › Progress): the switches here change them, so every device shows the same. Paused
// habits sit at the bottom, faded, and are left out of the headline and the chart.
import { computed, ref, toRef } from 'vue'
import { HABIT_WEEKS_RANGES, habitWeekdays, habitWeeklyTarget, isHabitPaused, type HabitTally, type HabitTypeSettings, type ObjectSummary, type ObjectType } from '@vasta/core'
import { api } from '../lib/api.ts'
import { clone } from '../lib/clone.ts'
import { habitProgressOf, REPORT_CHARTS, useHabitProgress, type PanelChart } from '../lib/habit-progress.ts'
import { isPhone } from '../lib/viewport.ts'
import { replaceType } from '../lib/state.ts'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor, useFoodHabits, useToday } from '../lib/habits.ts'
import AppIcon from './AppIcon.vue'
import HabitChartPicker from './HabitChartPicker.vue'
import HabitReportChart from './HabitReportChart.vue'
import ObjectLink from './ObjectLink.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType; habits: ObjectSummary[]; filter?: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

const RANGES = HABIT_WEEKS_RANGES
const settings = computed(() => habitProgressOf(props.type))
const weeks = computed(() => settings.value.weeks)
const chart = computed(() => settings.value.report)
/** Saves a change of range or chart on the type, as Type settings would. */
function setProgress(patch: Partial<HabitTypeSettings>) {
  const next = clone(props.type)
  next.habits = { ...settings.value, ...patch }
  replaceType(next)
  void api.saveType(next).then(replaceType)
}
const setWeeks = (value: HabitTypeSettings['weeks']) => value !== weeks.value && setProgress({ weeks: value })
const chartButton = ref<HTMLElement | null>(null)
const chartMenu = ref(false)
function setChart(value: PanelChart) {
  chartMenu.value = false
  if (value !== chart.value) setProgress({ report: value })
}
const chartLabel = computed(() => REPORT_CHARTS.find((c) => c.id === chart.value)!.label)

const today = useToday()
// Habits done from food get their days from what was logged; without this they would chart as never done.
const habits = useFoodHabits(toRef(props, 'habits'))
const shown = computed(() => {
  const q = props.filter?.trim().toLowerCase()
  return habits.value.filter((h) => !q || h.title.toLowerCase().includes(q))
})
const { report, byWeek, days } = useHabitProgress(shown, today, weeks)

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekdayName = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
const dayLabel = (day: string) => short.format(new Date(`${day}T00:00:00Z`))
// 2026-11-16 is a Monday: the weekday ids in order from it.
const WEEKDAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const weekdayLabel = (id: string) => weekdayName.format(new Date(`2026-11-${16 + WEEKDAY_IDS.indexOf(id)}T00:00:00Z`))

const percent = (tally: HabitTally) => (tally.expected ? Math.round((tally.done / tally.expected) * 100) : undefined)
const percentText = (tally: HabitTally) => {
  const value = percent(tally)
  return value === undefined ? '—' : `${value}%`
}

/** A habit's goal in words: "3 a week", its weekdays, or every day. */
function goalText(habit: ObjectSummary) {
  const weekly = habitWeeklyTarget(habit)
  if (weekly) return `${weekly} a week`
  const days = habitWeekdays(habit)
  return days.length && days.length < 7 ? WEEKDAY_IDS.filter((d) => days.includes(d)).map(weekdayLabel).join(', ') : 'Every day'
}

const rows = computed(() => {
  const byId = new Map(report.value.habits.map((r) => [r.id, r]))
  return shown.value
    .map((habit) => ({ habit, paused: isHabitPaused(habit), tally: byId.get(habit.id)!.total, byWeek: byId.get(habit.id)!.byWeek }))
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.habit.title.localeCompare(b.habit.title))
})
/** A habit's own weeks as small columns (share done; this week faded; nothing asked: a stub). */
const MINI = { step: 9.5, bar: 7, h: 16 }
const miniWeeks = (tallies: HabitTally[]) => (isPhone.value ? tallies.slice(-6) : tallies)
const miniTitle = (tallies: HabitTally[]) =>
  miniWeeks(tallies)
    .map((t, i, all) => `${i === all.length - 1 ? 'This week' : dayLabel(report.value.weeks[report.value.weeks.length - all.length + i]!)}: ${t.expected ? `${t.done} of ${t.expected}` : 'nothing asked'}`)
    .join('\n')
const nothingYet = computed(() => !report.value.total.expected && !report.value.total.done)
</script>

<template>
  <div class="mt-6 space-y-6 max-md:pb-24" data-habit-progress>
    <div class="flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-lg bg-hover p-0.5 text-sm max-md:min-w-[14.5rem] max-md:flex-1" role="group" aria-label="Range">
        <button
          v-for="count in RANGES"
          :key="count"
          class="min-h-9 whitespace-nowrap rounded-md px-3 py-1 max-md:min-h-11 max-md:flex-1 max-md:px-2"
          :class="weeks === count ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
          :aria-pressed="weeks === count"
          :data-range="count"
          @click="setWeeks(count)"
        >
          {{ count }} weeks
        </button>
      </div>
      <!-- The chart: a switch on a computer, a button opening the list (a sheet) on a phone. -->
      <template v-if="isPhone">
        <button ref="chartButton" class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-hover px-3 text-sm font-medium" :aria-expanded="chartMenu" data-report-chart-button @click="chartMenu = !chartMenu">
          {{ chartLabel }}
          <AppIcon fallback="ph:caret-down" :size="14" class="text-ink-faint" />
        </button>
        <PopoverMenu v-model:open="chartMenu" :anchor="chartButton" label="Chart">
          <HabitChartPicker picker="report" :charts="REPORT_CHARTS" :model-value="chart" @update="setChart" />
        </PopoverMenu>
      </template>
      <div v-else class="inline-flex rounded-lg bg-hover p-0.5 text-sm" role="group" aria-label="Chart" data-chart-picker="report">
        <button
          v-for="c in REPORT_CHARTS"
          :key="c.id"
          class="min-h-9 whitespace-nowrap rounded-md px-3 py-1"
          :class="chart === c.id ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
          :aria-pressed="chart === c.id"
          :title="c.hint"
          :data-chart="c.id"
          @click="setChart(c.id)"
        >
          {{ c.label }}
        </button>
      </div>
    </div>

    <p v-if="!rows.length" class="py-10 text-center text-sm text-ink-faint">No habits match the filter.</p>
    <p v-else-if="nothingYet" class="py-10 text-center text-sm text-ink-faint">Nothing to count yet. Check habits off from Today.</p>
    <template v-else>
      <div data-progress-headline>
        <div class="text-3xl font-semibold tabular-nums">{{ percentText(report.total) }}</div>
        <div class="mt-0.5 text-sm text-ink-soft">
          <span class="tabular-nums">{{ report.total.done }} of {{ report.total.expected }}</span> done over {{ weeks }} weeks
          <span class="text-ink-faint"> · using your current goals</span>
        </div>
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold">Each week</h3>
        <HabitReportChart :chart="chart" :weeks="weeks" :by-week="byWeek" :days="days" />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold">Each habit</h3>
        <table class="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr class="text-[11px] text-ink-faint">
              <th class="pb-2 text-left font-medium">Habit</th>
              <th class="pb-2 pl-3 text-left font-medium max-sm:hidden">Goal</th>
              <th class="pb-2 pl-3 text-right font-medium">Weeks</th>
              <th class="w-24 pb-2 pl-3 text-right font-medium max-sm:hidden">Done</th>
              <th class="w-14 pb-2 pl-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.habit.id" :class="row.paused ? 'opacity-50' : ''" data-progress-row @contextmenu.prevent="emit('menu', $event, row.habit)">
              <td class="max-w-[14rem] border-t border-line/70 py-2 pr-3">
                <ObjectLink :id="row.habit.id" class="flex min-w-0 items-center gap-2 hover:underline">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="swatchClasses[habitColor(row.habit)]" />
                  <span class="truncate font-medium">{{ row.habit.title || 'Untitled' }}</span>
                  <span v-if="row.paused" class="text-xs text-ink-faint">paused</span>
                </ObjectLink>
              </td>
              <td class="border-t border-line/70 py-2 pl-3 text-ink-soft max-sm:hidden">{{ goalText(row.habit) }}</td>
              <td class="border-t border-line/70 py-2 pl-3 text-right" data-habit-weeks>
                <svg :width="miniWeeks(row.byWeek).length * MINI.step" :height="MINI.h" class="ml-auto block" role="img" :aria-label="`${row.habit.title}: each week`">
                  <title>{{ miniTitle(row.byWeek) }}</title>
                  <rect
                    v-for="(t, i) in miniWeeks(row.byWeek)"
                    :key="i"
                    :x="i * MINI.step"
                    :y="MINI.h - (t.expected ? Math.max(1.5, ((percent(t) ?? 0) / 100) * MINI.h) : 1.5)"
                    :width="MINI.bar"
                    :height="t.expected ? Math.max(1.5, ((percent(t) ?? 0) / 100) * MINI.h) : 1.5"
                    rx="1"
                    :fill="t.expected ? 'var(--color-chart)' : 'var(--color-line-strong)'"
                    :opacity="i === miniWeeks(row.byWeek).length - 1 ? 0.4 : 1"
                  />
                </svg>
              </td>
              <td class="border-t border-line/70 py-2 pl-3 text-right tabular-nums text-ink-soft max-sm:hidden">{{ row.tally.done }} of {{ row.tally.expected }}</td>
              <td class="border-t border-line/70 py-2 pl-3 text-right font-medium tabular-nums">{{ percentText(row.tally) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
