<script setup lang="ts">
// On a habit's page: today's mark, its streaks and how it is doing (the Progress view's numbers), and
// as many weeks of days as fit (up to a year), one square per day in the habit's color, fainter for
// a goal partly reached, hatched for a paused day. A click marks a day (a goal: adds 1; a habit
// linked to SparkyFitness asks); a right click asks for the amount.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { addDays, habitDayState, habitSparkyRule, habitFoodRule, habitProgress, habitStats, habitTarget, habitUnit, habitValue, isHabitDone, type ObjectRecord } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { swatchClasses } from '../lib/colors.ts'
import { askHabitAmount, formatAmount, habitAmountLabel, habitColor, habitStateWord, setHabitAmount, stepHabit, useFoodHabits } from '../lib/habits.ts'
import { percentText } from '../lib/habit-progress.ts'
import { locale, t } from '../lib/i18n.ts'
import { bodyText, metaText, tinyText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import HabitCheck from './HabitCheck.vue'
import HabitPauses from './HabitPauses.vue'
import HabitSparkyLink from './HabitSparkyLink.vue'

const props = defineProps<{ habit: ObjectRecord }>()
// A habit done from food has its days from what was logged.
const linked = useFoodHabits(computed(() => [props.habit as ObjectRecord & { preview: string }]))
const habit = computed(() => linked.value[0]!)
const fromFood = computed(() => !!habitFoodRule(props.habit))
const fromSparky = computed(() => !!habitSparkyRule(props.habit))

const today = dayKey()
const stats = computed(() => habitStats(habit.value, today))
const color = computed(() => habitColor(habit.value))
const target = computed(() => habitTarget(habit.value))
const unit = computed(() => habitUnit(habit.value))

const monthName = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', timeZone: 'UTC' }))
const longDay = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`)

// As many weeks as the width allows: 11px squares, 3px apart, a year at most.
const CELL = 11
const GAP = 3
const box = ref<HTMLElement | null>(null)
const width = ref(700)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!box.value) return
  observer = new ResizeObserver(([entry]) => (width.value = entry?.contentRect.width ?? width.value))
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** Columns of weeks, Monday on top, ending with this week. */
const weeks = computed(() => {
  const count = Math.max(8, Math.min(53, Math.floor((width.value + GAP) / (CELL + GAP))))
  const monday = addDays(today, -((utc(today).getUTCDay() + 6) % 7))
  const start = addDays(monday, -7 * (count - 1))
  return Array.from({ length: count }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
})
/** A month's name over the week its first day is in; one too close to the one before is left out. */
const monthLabels = computed(() => {
  const labels: { column: number; text: string }[] = []
  weeks.value.forEach((week, column) => {
    const first = week.find((d) => d.endsWith('-01'))
    if (!first) return
    if (labels.length && column - labels.at(-1)!.column < 3) return
    labels.push({ column, text: monthName.value.format(utc(first)) })
  })
  return labels
})

/** A day's state (core's habitDayState). */
const stateOf = (day: string) => habitDayState(habit.value, day, today, stats.value.since)
const todayState = computed(() => stateOf(today))

/** A square: the habit's color fills it from the bottom as far as the day got (all of it once done). */
function cellClass(day: string) {
  if (day > today) return 'invisible'
  return ['off', 'paused'].includes(stateOf(day)) ? 'bg-hover/50 hover:ring-1 hover:ring-line' : 'bg-hover hover:ring-1 hover:ring-line-strong'
}
/** Paused days are hatched, so they don't look like a weekday it does not repeat on. */
const hatch = { backgroundImage: 'repeating-linear-gradient(135deg, var(--color-line) 0 2px, transparent 2px 4px)' }

// The hovered (or focused) square's details, shown at once above it.
const hovered = ref<{ day: string; left: number; top: number } | null>(null)
function hover(event: Event, day: string) {
  if (day > today || !box.value) return
  const cell = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const area = box.value.getBoundingClientRect()
  // Kept inside the area, so a square at either end does not push its tooltip out of the page.
  hovered.value = { day, left: Math.min(Math.max(cell.left - area.left + cell.width / 2, 80), area.width - 80), top: cell.top - area.top }
}
const details = computed(() => {
  const day = hovered.value?.day
  if (!day) return null
  const state = stateOf(day)
  const status = state === 'later' ? (day === today ? t('habits.status.notDoneYet') : 'Not needed yet') : habitStateWord(state, habitProgress(habit.value, day))
  return { date: longDay.value.format(utc(day)), status, amount: target.value ? habitAmountLabel(habit.value, day) : '', done: isHabitDone(habit.value, day) }
})

/** A streak, in weeks for a habit counted by the week. */
const streak = (count: number) => (stats.value.streakUnit === 'week' ? `${count} wk` : count)

const cards = computed(() => [
  { label: t('habits.card.currentStreak'), value: streak(stats.value.current), icon: 'ph:fire', tint: 'text-orange-500' },
  { label: t('habits.card.bestStreak'), value: streak(stats.value.best), icon: 'ph:trophy', tint: 'text-amber-500' },
  { label: 'This week so far', value: `${stats.value.thisWeek.done} of ${stats.value.thisWeek.of}`, icon: 'ph:calendar-check', tint: 'text-sky-500' },
  { label: 'Last 4 weeks', value: percentText(stats.value.last4Weeks), icon: 'ph:chart-line-up', tint: 'text-emerald-500' },
  target.value
    ? { label: t('habits.card.averageDay'), value: `${formatAmount(stats.value.average30)}${unit.value ? ` ${unit.value}` : ''}`, icon: 'ph:gauge', tint: 'text-violet-500' }
    : { label: t('habits.card.timesDone'), value: stats.value.total, icon: 'ph:check-circle', tint: 'text-violet-500' },
])
const doneToday = computed(() => isHabitDone(habit.value, today))
</script>

<template>
  <section class="mt-8">
    <HabitSparkyLink :habit="props.habit" />
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2.5 rounded-xl border border-line py-1.5 pl-2 pr-3">
        <HabitCheck :habit="habit" :day="today" :size="26" />
        <div :class="bodyText">
          <div class="font-medium">{{ doneToday ? t('habits.doneToday') : t('common.today') }}</div>
          <div v-if="target" class="tabular-nums text-ink-faint" :class="metaText">{{ habitAmountLabel(habit, today) }}</div>
        </div>
        <div v-if="target && !fromFood && !fromSparky" class="ml-2 flex items-center gap-1">
          <button class="grid h-7 w-7 place-items-center rounded-md ring-1 ring-line hover:bg-hover" :title="t('habits.takeOneAway')" @click="setHabitAmount(habit.id, today, Math.max(0, habitValue(habit, today) - 1), habit)">
            <AppIcon fallback="ph:minus" :size="13" />
          </button>
          <button class="grid h-7 w-7 place-items-center rounded-md ring-1 ring-line hover:bg-hover" :title="t('habits.addOne')" @click="setHabitAmount(habit.id, today, habitValue(habit, today) + 1, habit)">
            <AppIcon fallback="ph:plus" :size="13" />
          </button>
        </div>
      </div>
      <span v-if="todayState === 'paused'" class="text-ink-faint" :class="metaText">Paused today.</span>
      <span v-else-if="todayState === 'off' && stats.weekly" class="text-ink-faint" :class="metaText">This week’s goal is met.</span>
      <span v-else-if="todayState === 'off'" class="text-ink-faint" :class="metaText">{{ t('habits.todayDayOff') }}</span>
      <span v-else-if="stats.weekly" class="text-ink-faint" :class="metaText">{{ stats.weekly }} a week, on any days.</span>
      <span v-if="fromSparky" class="text-ink-faint" :class="metaText" data-habit-from-sparkyfitness>From SparkyFitness · a hand entry takes priority</span>
      <span v-if="fromFood" class="flex items-center gap-1 text-ink-faint" :class="metaText" data-habit-from-food><AppIcon fallback="ph:bowl-food" :size="13" /> {{ t('habits.doneFromFood') }}</span>
    </div>

    <HabitPauses :habit="props.habit" />

    <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div v-for="card in cards" :key="card.label" class="rounded-xl border border-line px-3 py-2.5">
        <div class="flex items-center gap-1.5 text-ink-faint" :class="metaText"><AppIcon :fallback="card.icon" :class="card.tint" :size="14" /> {{ card.label }}</div>
        <div class="mt-1 truncate text-xl font-semibold tabular-nums">{{ card.value }}</div>
      </div>
    </div>

    <div ref="box" class="relative mt-6">
      <div class="relative h-4">
        <span
          v-for="label in monthLabels"
          :key="label.column"
          class="absolute top-0 leading-none text-ink-faint first-letter:uppercase"
          :class="tinyText"
          :style="{ left: `${label.column * (CELL + GAP)}px` }"
        >{{ label.text }}</span
        >
      </div>
      <div class="grid w-fit gap-[3px]" :style="{ gridTemplateColumns: `repeat(${weeks.length}, ${CELL}px)`, gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoFlow: 'column' }">
        <template v-for="week in weeks" :key="week[0]">
          <button
            v-for="day in week"
            :key="day"
            class="relative overflow-hidden rounded-[3px]"
            :class="cellClass(day)"
            :style="day <= today && stateOf(day) === 'paused' ? hatch : undefined"
            :aria-label="day"
            :disabled="day > today"
            @click="stepHabit(habit, day)"
            @contextmenu.prevent="askHabitAmount(habit, day)"
            @mouseenter="hover($event, day)"
            @focus="hover($event, day)"
            @mouseleave="hovered = null"
            @blur="hovered = null"
          >
            <span
              v-if="day <= today && habitProgress(habit, day) > 0"
              class="absolute inset-x-0 bottom-0"
              :class="swatchClasses[color]"
              :style="{ height: `${habitProgress(habit, day) * 100}%` }"
            />
          </button>
        </template>
      </div>
      <div
        v-if="hovered && details"
        class="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-surface shadow-lg"
        :class="metaText"
        :style="{ left: `${hovered.left}px`, top: `${hovered.top - 6}px` }"
        role="tooltip"
      >
        <div class="font-medium first-letter:uppercase">{{ details.date }}</div>
        <div class="opacity-80">
          <template v-if="details.amount">{{ details.amount }} · </template>{{ details.status }}
        </div>
      </div>
      <p class="mt-2 text-ink-faint" :class="metaText">
        <template v-if="fromSparky">Click a day to type its amount or go back to SparkyFitness’s.</template>
        <template v-else>Click a day to {{ target ? 'add 1' : 'mark it' }}, right click to type {{ target ? 'the amount' : 'it' }}.</template>
        Counting since {{ longDay.format(utc(stats.since)) }}.
      </p>
    </div>
  </section>
</template>
