<script setup lang="ts">
// A habit's pauses, on its page: Pause starts one today and Resume ends it; each pause has its own
// first and last day to change (no last day: until resumed). Paused days count as days off: they
// are not asked, miss nothing and break no streak (core's habit pauses).
import { computed, ref } from 'vue'
import { habitPauseChange, habitPausedOn, habitPauses, pauseHabit, resumeHabit, type HabitPause, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { dayKey, setProperties } from '../lib/actions.ts'
import { quietButton, greyButton } from '../lib/buttons.ts'
import { lastError } from '../lib/state.ts'
import { formatLongDay } from '../lib/format.ts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ habit: ObjectRecord }>()
const today = dayKey()
const pauses = computed(() => habitPauses(props.habit))
const paused = computed(() => habitPausedOn(props.habit, today))
const open = ref(false)
const text = (pause: HabitPause) => (pause.to ? `${formatLongDay(`${pause.from}T00:00:00.000Z`)} to ${formatLongDay(`${pause.to}T00:00:00.000Z`)}` : `from ${formatLongDay(`${pause.from}T00:00:00.000Z`)}`)

async function save(changes: Record<string, PropertyValue | undefined>) {
  try {
    await setProperties(props.habit.id, changes)
  } catch (error) {
    lastError.value = (error as Error).message
  }
}
/** Change a pause's days: an empty first day is no change, a last day before it is left off. */
function edit(pause: HabitPause, from: string, to: string) {
  if (!from) return
  void save(habitPauseChange(pause, { from, ...(to && to >= from ? { to } : {}) }))
}
</script>

<template>
  <div class="mt-4 text-sm" data-habit-pauses>
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="paused" :class="greyButton" data-habit-resume @click="save(resumeHabit(habit, today))"><AppIcon fallback="ph:play" :size="14" /> Resume</button>
      <button v-else :class="greyButton" data-habit-pause @click="save(pauseHabit(habit, today))"><AppIcon fallback="ph:pause" :size="14" /> Pause</button>
      <span v-if="paused" class="text-xs text-ink-faint">Paused today: paused days are days off.</span>
      <button v-if="pauses.length" :class="quietButton" class="ml-auto" :aria-expanded="open" @click="open = !open">Pauses ({{ pauses.length }})</button>
    </div>
    <ul v-if="open && pauses.length" class="mt-2 space-y-2">
      <li v-for="pause in pauses" :key="pause.from" class="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2" data-habit-pause-row>
        <span class="mr-auto text-xs text-ink-soft">{{ text(pause) }}</span>
        <label class="flex items-center gap-1.5 text-xs text-ink-faint">From<input type="date" :value="pause.from" class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" @change="edit(pause, ($event.target as HTMLInputElement).value, pause.to ?? '')" /></label>
        <label class="flex items-center gap-1.5 text-xs text-ink-faint">To<input type="date" :value="pause.to ?? ''" :min="pause.from" class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" @change="edit(pause, pause.from, ($event.target as HTMLInputElement).value)" /></label>
        <button :class="quietButton" :aria-label="`Remove the pause ${text(pause)}`" @click="save(habitPauseChange(pause, undefined))"><AppIcon fallback="ph:x" :size="14" /></button>
      </li>
    </ul>
  </div>
</template>
