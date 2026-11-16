<script setup lang="ts">
// The Habits Tracker on a phone: one row per habit, as in the Habit Tracker app. Its whole name,
// then "2 of 3 this week", its amount today, its streak or its goal; its last two weeks as ticks
// (a tall bar on a day done, a short one partway to a goal, a dot on a day missed, a dash on a day
// off, an underline for today); and a round check for today. Past days are changed on the habit's
// page. Paused habits sit at the bottom, faded.
import { computed } from 'vue'
import { addDays, habitProgress, habitSince, habitStats, habitTarget, habitWeekdays, isHabitDone, isHabitPaused, isHabitScheduled, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { habitAmountLabel, habitColor } from '../lib/habits.ts'
import { longDayLabel } from '../lib/habit-progress.ts'
import HabitCheck from './HabitCheck.vue'
import ObjectLink from './ObjectLink.vue'

const props = defineProps<{ habits: ObjectSummary[]; today: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

const WEEKDAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const weekdayName = new Intl.DateTimeFormat(typeof navigator !== 'undefined' ? navigator.language : 'en', { weekday: 'short', timeZone: 'UTC' })
// 2026-11-16 is a Monday: the weekday ids in order from it.
const weekdayLabel = (id: string) => weekdayName.format(new Date(`2026-11-${16 + WEEKDAY_IDS.indexOf(id)}T00:00:00Z`))

const days = computed(() => Array.from({ length: 14 }, (_, i) => addDays(props.today, i - 13)))

const rows = computed(() =>
  props.habits
    .map((habit) => {
      const stats = habitStats(habit, props.today)
      const since = habitSince(habit)
      const paused = isHabitPaused(habit)
      const days_ = habitWeekdays(habit)
      const goal = days_.length && days_.length < 7 ? WEEKDAY_IDS.filter((d) => days_.includes(d)).map(weekdayLabel).join(', ') : 'Every day'
      const amount = habitTarget(habit) ? habitAmountLabel(habit, props.today) : ''
      const line = paused
        ? { text: 'Paused', streak: false }
        : stats.weekly
          ? { text: `${stats.weekDone} of ${stats.weekly} this week`, streak: false }
          : amount
            ? { text: `${amount} today`, streak: false }
            : stats.current > 0
              ? { text: `${stats.current}-day streak`, streak: true }
              : { text: goal, streak: false }
      const ticks = days.value.map((day) => {
        const done = isHabitDone(habit, day)
        const part = done ? 1 : habitProgress(habit, day)
        const kind = done || part > 0 ? 'done' : day === props.today ? 'today' : day < since || !isHabitScheduled(habit, day) ? 'off' : 'miss'
        const word = kind === 'done' ? (done ? 'done' : `${Math.round(part * 100)}% of the goal`) : kind === 'today' ? 'today, not done yet' : kind === 'off' ? 'day off' : 'not done'
        return { day, kind, part, title: `${longDayLabel(day)}: ${word}` }
      })
      return { habit, paused, line, ticks }
    })
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.habit.title.localeCompare(b.habit.title))
)
</script>

<template>
  <div data-habit-rows>
    <div
      v-for="row in rows"
      :key="row.habit.id"
      class="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-3 border-t border-line py-2.5"
      :class="row.paused ? 'opacity-50' : ''"
      data-habit-row
      @contextmenu.prevent="emit('menu', $event, row.habit)"
    >
      <div class="min-w-0">
        <ObjectLink :id="row.habit.id" class="flex items-baseline gap-2 text-base font-semibold leading-snug">
          <span class="size-2.5 shrink-0 -translate-y-px rounded-full" :class="swatchClasses[habitColor(row.habit)]" />
          <span class="min-w-0 break-words">{{ row.habit.title || 'Untitled' }}</span>
        </ObjectLink>
        <div class="ml-[18px] mt-0.5 text-[13px] tabular-nums" :class="row.line.streak ? 'text-orange-600 dark:text-orange-400' : 'text-ink-faint'">{{ row.line.text }}</div>
      </div>
      <div class="flex h-[26px] items-end gap-[3px]" role="img" :aria-label="`${row.habit.title}: the last two weeks`">
        <i
          v-for="(tick, i) in row.ticks"
          :key="tick.day"
          class="block w-[5px] rounded-[2px]"
          :class="[
            tick.kind === 'miss' ? 'h-1 bg-line-strong' : tick.kind === 'off' ? 'h-0.5 bg-line' : tick.kind === 'today' ? 'h-[3px] bg-ink-faint' : swatchClasses[habitColor(row.habit)],
            i === 6 ? 'mr-1' : '',
          ]"
          :style="tick.kind === 'done' ? { height: `${Math.max(6, Math.round(tick.part * 22))}px`, opacity: tick.part < 1 ? 0.55 : 1 } : undefined"
          :title="tick.title"
        />
      </div>
      <!-- 36px drawn, 44px to tap. -->
      <HabitCheck :habit="row.habit" :day="today" :size="36" class="justify-self-end after:absolute after:-inset-1 after:content-['']" />
    </div>
    <p v-if="!rows.length" class="py-10 text-center text-sm text-ink-faint">No habits match the filter.</p>
  </div>
</template>
