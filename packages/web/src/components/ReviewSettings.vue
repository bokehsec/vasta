<script setup lang="ts">
// A task type's Review settings (Type settings › Review; @vasta/core task-review.ts, task-status.ts):
// how often a placed task comes back for a check-in, how long Snooze hides a task, and which statuses count as new. Tasks with
// no status are always new. Unset means the defaults (a week; the status called Inbox).
import { computed } from 'vue'
import type { Id, ObjectType, ReviewSettings } from '@vasta/core'
import { DEFAULT_REVIEW_EVERY, DEFAULT_SNOOZE_DAYS, STATUS_PROPERTY_ID, reviewEveryOf, reviewFieldOf, snoozeDaysOf, snoozeFieldOf, triageOptionsOf } from '@vasta/core'
import { quietButton } from '../lib/buttons.ts'

const props = defineProps<{ type: ObjectType }>()
const emit = defineEmits<{ update: [value: ReviewSettings | undefined] }>()

const openStatuses = computed(() => {
  const def = props.type.properties.find((p) => p.id === STATUS_PROPERTY_ID)
  return def?.kind === 'select' ? def.options.filter((o) => o.status !== 'done') : []
})
function emitSettings(patch: Partial<ReviewSettings>) {
  const next: ReviewSettings = { ...props.type.review, ...patch }
  for (const key of Object.keys(next) as (keyof ReviewSettings)[]) if (next[key] === undefined) delete next[key]
  emit('update', Object.keys(next).length ? next : undefined)
}
/** Days between reviews: a whole number from 0 (every review); empty goes back to a week. */
function setEvery(text: string) {
  const days = Number(text)
  emitSettings({ every: text.trim() === '' || !Number.isInteger(days) || days < 0 || days === DEFAULT_REVIEW_EVERY ? undefined : days })
}
/** Days Snooze hides a task: a whole number from 1; empty or invalid goes back to a day. */
function setSnooze(text: string) {
  const days = Number(text)
  emitSettings({ snooze: text.trim() === '' || !Number.isInteger(days) || days < 1 || days === DEFAULT_SNOOZE_DAYS ? undefined : days })
}
function toggleIncoming(id: Id) {
  const selected = triageOptionsOf(props.type).map((o) => o.id)
  emitSettings({ incoming: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] })
}
const control = 'rounded-md bg-hover px-1.5 py-1 text-sm outline-none max-md:min-h-11'
</script>

<template>
  <section v-if="type.system === 'task'" class="mt-4" data-review-settings>
    <div class="text-sm">Review</div>
    <p class="mt-0.5 text-xs text-ink-faint">Review tasks shows every new task first, whatever its review date or next step, then the check-ins.</p>
    <label v-if="reviewFieldOf(type)" class="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span class="text-ink-soft">Check in on each {{ type.name.toLowerCase() }} every</span>
      <input :value="reviewEveryOf(type)" type="number" min="0" step="1" inputmode="numeric" :class="[control, 'w-16']" data-review-every @change="setEvery(($event.target as HTMLInputElement).value)" />
      <span class="text-ink-soft">days</span>
      <span class="w-full text-xs text-ink-faint">A placed, open task with no date, or one that has passed, comes back once it has not been reviewed for this many days (0: every time); one with a date ahead waits for it, unless Snooze or Waiting… brings it back sooner. Keep marks it reviewed.</span>
    </label>
    <label v-if="snoozeFieldOf(type)" class="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span class="text-ink-soft">Snooze hides a {{ type.name.toLowerCase() }} from Review for</span>
      <input :value="snoozeDaysOf(type)" type="number" min="1" step="1" inputmode="numeric" :class="[control, 'w-16']" data-review-snooze @change="setSnooze(($event.target as HTMLInputElement).value)" />
      <span class="text-ink-soft">days</span>
      <span class="w-full text-xs text-ink-faint">It comes back as it was, new or a check-in. Nothing else changes and it is not marked reviewed.</span>
    </label>
    <fieldset class="mt-3 space-y-1 text-sm" data-triage-settings>
      <legend class="text-ink-soft">Statuses that count as new</legend>
      <p class="text-xs text-ink-faint">Tasks with no status are always new.</p>
      <label v-for="option in openStatuses" :key="option.id" class="flex min-h-11 items-center gap-2">
        <input type="checkbox" class="h-5 w-5 accent-[var(--color-accent)]" :checked="triageOptionsOf(type).some((o) => o.id === option.id)" @change="toggleIncoming(option.id)" />
        {{ option.label }}
      </label>
      <button v-if="type.review?.incoming" :class="[quietButton, '-ml-3']" @click="emitSettings({ incoming: undefined })">Use default incoming statuses</button>
    </fieldset>
  </section>
</template>
