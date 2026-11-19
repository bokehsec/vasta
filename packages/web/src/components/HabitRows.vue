<script setup lang="ts">
// The phone Tracker's day picker makes every row's round check work on the chosen day, starting
// with today again at midnight. Each row keeps its name, amount, streak or weekly count and its
// last two weeks as ticks; tapping the ticks opens large checks for that habit's days. Habits
// paused today sit at the bottom, faded; a day off or paused has a faded check, as on the desktop.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addDays, habitDayState, habitPausedOn, habitProgress, habitSince, habitStats, habitTarget, habitWeekdays, type ObjectSummary } from '@vasta/core'
import { swatchClasses } from '../lib/colors.ts'
import { quietButton } from '../lib/buttons.ts'
import { habitAmountLabel, habitColor, habitStateWord } from '../lib/habits.ts'
import { longDayLabel } from '../lib/habit-progress.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import HabitCheck from './HabitCheck.vue'
import HabitDaysSheet from './HabitDaysSheet.vue'
import ObjectLink from './ObjectLink.vue'

const props = defineProps<{ habits: ObjectSummary[]; today: string }>()
const emit = defineEmits<{ menu: [event: MouseEvent, object: ObjectSummary] }>()

const selectedDay = ref(props.today)
const picker = ref<HTMLElement | null>(null)
const sheetId = ref<string | null>(null)
const sheetHabit = computed(() => props.habits.find((habit) => habit.id === sheetId.value))
const sheetOpener = ref<HTMLElement | null>(null)

function openDays(event: MouseEvent, habit: ObjectSummary) {
  sheetOpener.value = event.currentTarget as HTMLElement
  sheetId.value = habit.id
}

/** Keep today in view when the rows open, the day rolls over or the person returns to today. */
async function showToday() {
  await nextTick()
  if (picker.value) picker.value.scrollLeft = picker.value.scrollWidth
}
onMounted(showToday)
watch(() => props.today, () => { selectedDay.value = props.today; void showToday() })
watch(selectedDay, (day) => { if (day === props.today) void showToday() })

const weekday = new Intl.DateTimeFormat(typeof navigator !== 'undefined' ? navigator.language : 'en', { weekday: 'narrow', timeZone: 'UTC' })
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
      const amount = habitTarget(habit) ? habitAmountLabel(habit, selectedDay.value) : ''
      const state = habitDayState(habit, selectedDay.value, props.today, since)
      const line = state === 'paused'
        ? { text: 'Paused', streak: false }
        : stats.weekly
          ? { text: `${stats.thisWeek.done} of ${stats.thisWeek.of} this week`, streak: false }
          : amount
            ? { text: selectedDay.value === props.today ? `${amount} today` : amount, streak: false }
            : stats.current > 0
              ? { text: `${stats.current}-day streak`, streak: true }
              : { text: goal, streak: false }
      const ticks = days.value.map((day) => {
        const state = habitDayState(habit, day, props.today, since)
        const part = state === 'done' ? 1 : habitProgress(habit, day)
        return { day, state, part, title: `${longDayLabel(day)}: ${habitStateWord(state, part)}` }
      })
      return { habit, paused, state, line, ticks }
    })
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.habit.title.localeCompare(b.habit.title))
)
</script>

<template>
  <div data-habit-rows>
    <div class="flex min-h-11 items-center justify-between gap-2" aria-live="polite">
      <p class="font-medium" :class="bodyText" data-habit-selected-day>{{ selectedDay === today ? 'Today' : longDayLabel(selectedDay) }}</p>
      <button v-if="selectedDay !== today" :class="quietButton" @click="selectedDay = today">Back to today</button>
    </div>
    <div ref="picker" class="mb-2 flex gap-1 overflow-x-auto py-1" aria-label="Day to check" data-habit-days>
      <button
        v-for="day in days"
        :key="day"
        class="min-h-12 min-w-11 shrink-0 rounded-lg px-2 py-1 text-center focus-visible:outline-2 focus-visible:outline-accent"
        :class="[day === selectedDay ? 'bg-accent/12 ring-1 ring-inset ring-accent/40' : 'hover:bg-hover', day === today || day === selectedDay ? 'text-accent' : 'text-ink-faint']"
        :aria-label="longDayLabel(day)"
        :aria-pressed="day === selectedDay"
        :aria-current="day === today ? 'date' : undefined"
        :data-habit-day="day"
        @click="selectedDay = day"
      >
        <span class="block first-letter:uppercase" :class="metaText">{{ weekday.format(new Date(`${day}T00:00:00Z`)) }}</span>
        <span class="block tabular-nums" :class="[bodyText, day === today || day === selectedDay ? 'font-semibold' : '']">{{ Number(day.slice(8)) }}</span>
      </button>
    </div>
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
      <button class="flex min-h-11 items-end gap-[3px] rounded-md pb-2 focus-visible:outline-2 focus-visible:outline-accent" :aria-label="`${row.habit.title}: last two weeks, edit days`" aria-haspopup="dialog" data-habit-ticks @click.stop="openDays($event, row.habit)" @contextmenu.stop.prevent="openDays($event, row.habit)">
        <i
          v-for="(tick, i) in row.ticks"
          :key="tick.day"
          class="block w-[5px] rounded-[2px]"
          :class="[
            tick.state === 'missed' ? 'h-1 bg-line-strong' : tick.state === 'off' || tick.state === 'paused' ? 'h-0.5 bg-line' : tick.state === 'later' ? 'h-[3px] bg-ink-faint' : swatchClasses[habitColor(row.habit)],
            i === 6 ? 'mr-1' : '',
            tick.day === selectedDay ? 'ring-1 ring-accent/50 ring-offset-2 ring-offset-surface' : '',
          ]"
          :style="tick.state === 'done' || tick.state === 'partial' ? { height: `${Math.max(6, Math.round(tick.part * 22))}px`, opacity: tick.part < 1 ? 0.55 : 1 } : undefined"
          :data-state="tick.state"
          :data-day="tick.day"
          :title="tick.title"
        />
      </button>
      <!-- 36px drawn, 44px to tap. -->
      <HabitCheck :habit="row.habit" :day="selectedDay" :size="36" class="justify-self-end after:absolute after:-inset-1 after:content-['']" :class="['off', 'paused'].includes(row.state) ? 'opacity-40' : ''" data-habit-row-check />
    </div>
    <p v-if="!rows.length" class="py-10 text-center text-ink-faint" :class="bodyText">No habits match the filter.</p>
    <HabitDaysSheet v-if="sheetHabit" :habit="sheetHabit" :today="today" :opener="sheetOpener" @close="sheetId = null" />
  </div>
</template>
