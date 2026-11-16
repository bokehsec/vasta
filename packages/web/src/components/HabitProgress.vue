<script setup lang="ts">
// The Habits page's Progress view: how much of what the habits asked for got done over the last
// 4, 8 or 13 whole weeks (core habitReport: done ÷ expected, added up, never an average of
// percents). A headline, one bar per week (the current one faded, being under way) and a row per
// habit. Paused habits sit at the bottom, faded, and are left out of the headline and the bars.
import { computed, ref, toRef, watch } from 'vue'
import { habitReport, habitWeekdays, habitWeeklyTarget, isHabitPaused, type HabitTally, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor, useFoodHabits, useToday } from '../lib/habits.ts'
import BarChart, { type Bar } from './charts/BarChart.vue'
import ObjectLink from './ObjectLink.vue'

const props = defineProps<{ habits: ObjectSummary[]; filter?: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

const RANGES = [4, 8, 13]
const RANGE_KEY = 'vasta.habit-progress.weeks'
function savedRange() {
  try {
    const value = Number(localStorage.getItem(RANGE_KEY))
    return RANGES.includes(value) ? value : 4
  } catch {
    return 4
  }
}
const weeks = ref(savedRange())
watch(weeks, (value) => {
  try {
    localStorage.setItem(RANGE_KEY, String(value))
  } catch {}
})

const today = useToday()
// Habits done from food get their days from what was logged; without this they would chart as never done.
const habits = useFoodHabits(toRef(props, 'habits'))
const shown = computed(() => {
  const q = props.filter?.trim().toLowerCase()
  return habits.value.filter((h) => !q || h.title.toLowerCase().includes(q))
})
const report = computed(() => habitReport(shown.value, weeks.value, today.value))

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

const bars = computed<Bar[]>(() =>
  report.value.weeks.map((week, i) => {
    const tally = report.value.byWeek[i]!
    const current = i === report.value.weeks.length - 1
    return {
      key: week,
      label: dayLabel(week),
      title: `Week of ${dayLabel(week)}${current ? ' (this week)' : ''}`,
      value: percent(tally) ?? 0,
      faded: current || !tally.expected,
      note: tally.expected ? `${tally.done} of ${tally.expected}` : 'Nothing scheduled',
    }
  })
)

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
    .map((habit) => ({ habit, paused: isHabitPaused(habit), tally: byId.get(habit.id)!.total }))
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.habit.title.localeCompare(b.habit.title))
})
const nothingYet = computed(() => !report.value.total.expected && !report.value.total.done)
</script>

<template>
  <div class="mt-6 space-y-6 max-md:pb-24" data-habit-progress>
    <div class="inline-flex rounded-lg bg-hover p-0.5 text-sm" role="group" aria-label="Range">
      <button
        v-for="count in RANGES"
        :key="count"
        class="min-h-9 rounded-md px-3 py-1 max-md:min-h-11"
        :class="weeks === count ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
        :aria-pressed="weeks === count"
        :data-range="count"
        @click="weeks = count"
      >
        {{ count }} weeks
      </button>
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
        <BarChart :bars="bars" label="Share done each week" :max="100" unit="%" :height="150" />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold">Each habit</h3>
        <table class="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr class="text-[11px] text-ink-faint">
              <th class="pb-2 text-left font-medium">Habit</th>
              <th class="pb-2 pl-3 text-left font-medium max-sm:hidden">Goal</th>
              <th class="w-24 pb-2 pl-3 text-right font-medium">Done</th>
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
              <td class="border-t border-line/70 py-2 pl-3 text-right tabular-nums text-ink-soft">{{ row.tally.done }} of {{ row.tally.expected }}</td>
              <td class="border-t border-line/70 py-2 pl-3 text-right font-medium tabular-nums">{{ percentText(row.tally) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
