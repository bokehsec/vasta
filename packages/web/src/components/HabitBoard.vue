<script setup lang="ts">
// The Habits page's Tracker view: one row per habit, the last two weeks (one beside a panel) to
// check off, and each habit's streak and its last 4 weeks (counted as the Progress view counts
// them); on a phone, rows as in the Habit Tracker app (HabitRows). Progress shows above the habits
// or beside them (below on a phone), or not at all; where, which chart and over how many weeks are
// the type's own (the Tracker's Display menu). Paused habits sit at the bottom, faded.
import { computed, toRef } from 'vue'
import { useRoute } from 'vue-router'
import { addDays, habitReport, habitStats, habitTarget, habitUnit, isHabitDone, isHabitDue, isHabitPaused, type HabitTally, type ObjectType, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitColor, useFoodHabits, useToday } from '../lib/habits.ts'
import { useHabitProgress, useTypeHabitProgress } from '../lib/habit-progress.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import HabitCheck from './HabitCheck.vue'
import HabitProgressPanel from './HabitProgressPanel.vue'
import HabitProgressStrip from './HabitProgressStrip.vue'
import HabitRows from './HabitRows.vue'
import ObjectLink from './ObjectLink.vue'

const props = defineProps<{ habits: ObjectSummary[]; type?: ObjectType; filter?: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

const today = useToday()
/** The type's progress (the Tracker's Display menu): where, which charts, the range; on every device alike. */
const charts = useTypeHabitProgress(toRef(props, 'type'))
const place = computed(() => charts.value.place)
const beside = computed(() => place.value === 'beside')
const weeks = computed(() => charts.value.weeks)
/** Days to check off: two weeks, one beside a panel. */
const days = computed(() => {
  const count = beside.value ? 7 : 14
  return Array.from({ length: count }, (_, i) => addDays(today.value, i - (count - 1)))
})
const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`)

const habits = useFoodHabits(toRef(props, 'habits'))
/** Each habit's last 4 weeks, done of expected (core habitReport, as in Progress). */
const fourWeeks = computed(() => new Map(habitReport(habits.value, 4, today.value).habits.map((r) => [r.id, r.total])))
const percent = (tally: HabitTally | undefined) => (tally?.expected ? `${Math.round((tally.done / tally.expected) * 100)}%` : '—')

const shown = computed(() => {
  const q = props.filter?.trim().toLowerCase()
  return habits.value.filter((h) => !q || h.title.toLowerCase().includes(q))
})
const rows = computed(() => {
  return shown.value
    .map((habit) => ({ habit, paused: isHabitPaused(habit), stats: habitStats(habit, today.value), weeks: fourWeeks.value.get(habit.id) }))
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.habit.title.localeCompare(b.habit.title))
})

// Progress over the shown habits (the filter applies), and the link to the Progress tab.
const progress = useHabitProgress(shown, today, weeks)
const route = useRoute()
const progressLink = computed(() => `${route.path}?view=__progress`)
</script>

<template>
  <div class="mt-4 max-md:pb-24">
    <HabitProgressStrip
      v-if="place === 'above' && shown.length"
      :chart="charts.strip"
      :weeks="weeks"
      :total="progress.total.value"
      :by-week="progress.byWeek.value"
      :days="progress.days.value"
      :habit-rows="progress.habitRows.value"
      :progress-link="progressLink"
    />
    <div :class="beside && !isPhone ? 'grid grid-cols-[minmax(0,1fr)_16.25rem] gap-7' : ''">
    <HabitRows v-if="isPhone" :habits="shown" :today="today" @menu="(event, object) => emit('menu', event, object)" />
    <div v-else class="min-w-0 overflow-x-auto">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="text-[11px] text-ink-faint">
          <th class="sticky left-0 z-10 bg-surface pb-2 text-left font-medium">Habit</th>
          <th v-for="day in days" :key="day" class="w-8 pb-2 text-center font-normal" :class="day === today ? 'text-accent' : ''">
            <div class="first-letter:uppercase">{{ weekday.format(utc(day)) }}</div>
            <div class="tabular-nums" :class="day === today ? 'font-semibold' : ''">{{ Number(day.slice(8)) }}</div>
          </th>
          <th class="w-16 pb-2 pl-3 text-right font-medium">Streak</th>
          <th class="w-16 pb-2 pl-3 text-right font-medium max-sm:hidden" title="Done of expected over the last 4 weeks, this one included">4 weeks</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.habit.id" class="group" :class="row.paused ? 'opacity-50' : ''" @contextmenu.prevent="emit('menu', $event, row.habit)">
          <td class="sticky left-0 z-10 max-w-[14rem] border-t border-line/70 bg-surface py-1.5 pr-3">
            <ObjectLink :id="row.habit.id" class="flex min-w-0 items-center gap-2 hover:underline">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="swatchClasses[habitColor(row.habit)]" />
              <span class="truncate font-medium">{{ row.habit.title || 'Untitled' }}</span>
              <span v-if="row.paused" class="text-xs text-ink-faint">paused</span>
              <span v-else-if="habitTarget(row.habit)" class="shrink-0 text-xs text-ink-faint">{{ habitTarget(row.habit) }} {{ habitUnit(row.habit) }}</span>
            </ObjectLink>
          </td>
          <td v-for="day in days" :key="day" class="border-t border-line/70 py-1.5 text-center">
            <HabitCheck :habit="row.habit" :day="day" :size="24" square class="mx-auto" :class="isHabitDue(row.habit, day) || isHabitDone(row.habit, day) ? '' : 'opacity-40'" />
          </td>
          <td class="border-t border-line/70 py-1.5 pl-3 text-right tabular-nums">
            <span v-if="row.stats.current" class="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400"><AppIcon fallback="ph:fire-fill" :size="12" />{{ row.stats.current }}<template v-if="row.stats.streakUnit === 'week'">&nbsp;wk</template></span>
            <span v-else class="text-ink-faint">0</span>
          </td>
          <td class="border-t border-line/70 py-1.5 pl-3 text-right tabular-nums text-ink-soft max-sm:hidden" :title="row.weeks?.expected ? `${row.weeks.done} of ${row.weeks.expected}` : undefined">{{ percent(row.weeks) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="py-10 text-center text-sm text-ink-faint">No habits match the filter.</p>
    </div>
    <HabitProgressPanel
      v-if="beside && shown.length"
      :class="isPhone ? 'mt-2 border-t border-line pt-5' : 'border-l border-line pl-6'"
      :chart="charts.panel"
      :weeks="weeks"
      :total="progress.total.value"
      :by-week="progress.byWeek.value"
      :days="progress.days.value"
      :habit-rows="progress.habitRows.value"
      :progress-link="progressLink"
    />
    </div>
  </div>
</template>
