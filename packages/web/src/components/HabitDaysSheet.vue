<script setup lang="ts">
// A habit's last two weeks on a phone, with large checks to fix any day. A tap toggles a plain
// habit or adds to its goal; a long press asks for Done / Not done or the exact amount.
import { computed } from 'vue'
import { addDays, habitDayState, habitTarget, type ObjectSummary } from '@vasta/core'
import { quietButton } from '../lib/buttons.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import BottomSheet from './BottomSheet.vue'
import HabitCheck from './HabitCheck.vue'

const props = defineProps<{ habit: ObjectSummary; today: string; opener?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const days = computed(() => Array.from({ length: 14 }, (_, i) => {
  const day = addDays(props.today, i - 13)
  return { day, state: habitDayState(props.habit, day, props.today) }
}))
const weekday = new Intl.DateTimeFormat(typeof navigator !== 'undefined' ? navigator.language : 'en', { weekday: 'narrow', timeZone: 'UTC' })
</script>

<template>
  <BottomSheet :label="`${habit.title || 'Habit'}: edit days`" :opener="opener" data-habit-sheet @close="emit('close')">
    <header class="flex items-center gap-2 px-2 pb-2">
      <h2 class="min-w-0 flex-1 break-words text-base font-semibold">{{ habit.title || 'Habit' }}</h2>
      <button :class="quietButton" @click="emit('close')">Close</button>
    </header>
    <p class="px-2 text-ink-faint" :class="metaText">{{ habitTarget(habit) ? 'Tap a day to add 1. Hold it to type the amount.' : 'Tap a day to check or uncheck it.' }}</p>
    <div class="grid grid-cols-7 gap-x-1 gap-y-5 px-1 pb-5 pt-4">
      <div v-for="{ day, state } in days" :key="day" class="flex min-w-0 flex-col items-center gap-2">
        <div class="text-center" :class="day === today ? 'font-semibold text-accent' : 'text-ink-faint'">
          <div class="first-letter:uppercase" :class="metaText">{{ weekday.format(new Date(`${day}T00:00:00Z`)) }}</div>
          <div class="tabular-nums" :class="bodyText">{{ Number(day.slice(8)) }}</div>
        </div>
        <!-- 40px drawn, 44px to tap. -->
        <HabitCheck :habit="habit" :day="day" :size="40" class="after:absolute after:-inset-0.5 after:content-['']" :class="['off', 'paused'].includes(state) ? 'opacity-40' : ''" :data-habit-day="day" :data-state="state" />
      </div>
    </div>
  </BottomSheet>
</template>
