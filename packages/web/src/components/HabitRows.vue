<script setup lang="ts">
// The Habits Tracker on a phone: one row per habit, as in the Habit Tracker app. Its whole name,
// then "2 of 3 this week", its amount today, its streak or its goal; its last two weeks as ticks
// (a tall bar on a day done, a short one partway to a goal, a dot on a day missed, a dash on a day
// off or paused, an underline for a day not needed yet); and a round check for today. A long press
// on a day's tick changes that day, as the check does for today. Paused habits sit at the bottom,
// faded.
import { computed } from 'vue'
import { addDays, habitDayState, habitPausedOn, habitProgress, habitSince, habitStats, habitTarget, habitWeekdays, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { askHabitAmount, habitAmountLabel, habitColor, habitStateWord } from '../lib/habits.ts'
import { longDayLabel } from '../lib/habit-progress.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import HabitCheck from './HabitCheck.vue'
import ObjectLink from './ObjectLink.vue'

const props = defineProps<{ habits: ObjectSummary[]; today: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

/** A long press (a right click) on the ticks changes the day under the finger: the nearest tick. */
function pressTicks(event: MouseEvent, habit: ObjectSummary) {
  const ticks = [...(event.currentTarget as HTMLElement).children] as HTMLElement[]
  const rects = ticks.map((tick) => tick.getBoundingClientRect())
  const nearest = rects.reduce((best, rect, i) => (Math.abs(rect.left + rect.width / 2 - event.clientX) < Math.abs(rects[best]!.left + rects[best]!.width / 2 - event.clientX) ? i : best), 0)
  const day = days.value[nearest]
  if (day) void askHabitAmount(habit, day)
}

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
      const paused = habitPausedOn(habit, props.today)
      const days_ = habitWeekdays(habit)
      const goal = days_.length && days_.length < 7 ? WEEKDAY_IDS.filter((d) => days_.includes(d)).map(weekdayLabel).join(', ') : 'Every day'
      const amount = habitTarget(habit) ? habitAmountLabel(habit, props.today) : ''
      const line = paused
        ? { text: 'Paused', streak: false }
        : stats.weekly
          ? { text: `${stats.thisWeek.done} of ${stats.thisWeek.of} this week`, streak: false }
          : amount
            ? { text: `${amount} today`, streak: false }
            : stats.current > 0
              ? { text: `${stats.current}-day streak`, streak: true }
              : { text: goal, streak: false }
      const ticks = days.value.map((day) => {
        const state = habitDayState(habit, day, props.today, since)
        const part = state === 'done' ? 1 : habitProgress(habit, day)
        return { day, state, part, title: `${longDayLabel(day)}: ${habitStateWord(state, part)}` }
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
        <div class="ml-[18px] mt-0.5 tabular-nums" :class="[metaText, row.line.streak ? 'text-orange-600 dark:text-orange-400' : 'text-ink-faint']">{{ row.line.text }}</div>
      </div>
      <div class="flex h-[26px] items-end gap-[3px]" role="img" :aria-label="`${row.habit.title}: the last two weeks`" data-habit-ticks @contextmenu.stop.prevent="pressTicks($event, row.habit)">
        <i
          v-for="(tick, i) in row.ticks"
          :key="tick.day"
          class="block w-[5px] rounded-[2px]"
          :class="[
            tick.state === 'missed' ? 'h-1 bg-line-strong' : tick.state === 'off' || tick.state === 'paused' ? 'h-0.5 bg-line' : tick.state === 'later' ? 'h-[3px] bg-ink-faint' : swatchClasses[habitColor(row.habit)],
            i === 6 ? 'mr-1' : '',
          ]"
          :style="tick.state === 'done' || tick.state === 'partial' ? { height: `${Math.max(6, Math.round(tick.part * 22))}px`, opacity: tick.part < 1 ? 0.55 : 1 } : undefined"
          :data-state="tick.state"
          :data-day="tick.day"
          :title="tick.title"
        />
      </div>
      <!-- 36px drawn, 44px to tap. -->
      <HabitCheck :habit="row.habit" :day="today" :size="36" class="justify-self-end after:absolute after:-inset-1 after:content-['']" />
    </div>
    <p v-if="!rows.length" class="py-10 text-center text-ink-faint" :class="bodyText">No habits match the filter.</p>
  </div>
</template>
