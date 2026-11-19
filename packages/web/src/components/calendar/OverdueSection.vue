<script setup lang="ts">
// The tasks that are late, at the top of Today and of an agenda: each is a row (opens the task,
// says what is late: "Due Tue", "Planned Mon") with a one-tap "Move to today", which plans it for
// today and keeps its deadline, with Undo (lib/calendar-drop.ts). A task marked Done here stays,
// checked and struck, until the view is looked at afresh, like any entry.
import { computed, inject } from 'vue'
import { dayOfDate, taskDatesOf, type CalendarEntry } from '@vasta/core'
import { dayKey } from '../../lib/actions.ts'
import { greyButton } from '../../lib/buttons.ts'
import { viewerTimeZone } from '../../lib/calendar.ts'
import { moveToToday } from '../../lib/calendar-drop.ts'
import { taskDate } from '../../lib/calendar-tasks.ts'
import { ENTRY_COMPLETION } from '../../lib/completion-feedback.ts'
import { cachedSummary, typesById } from '../../lib/state.ts'
import { metaText, overdueHeading } from '../../lib/type-scale.ts'
import AppIcon from '../AppIcon.vue'
import CalendarEntryItem from './CalendarEntryItem.vue'

const props = defineProps<{
  entries: CalendarEntry[]
  /** The agenda's compact rows, or the Day view's task cards. */
  variant: 'row' | 'day-task'
}>()
const emit = defineEmits<{ details: [entry: CalendarEntry, element: HTMLElement]; moved: [] }>()

const kept = inject(ENTRY_COMPLETION, undefined)

/** Whether Move to today is offered: an open task whose type has a plan date, not already planned for today. */
function movable(entry: CalendarEntry): boolean {
  const summary = cachedSummary(entry.objectId ?? '')
  const plan = taskDatesOf(typesById.value.get(summary?.typeId ?? '')).plan
  const planned = taskDate(summary, plan?.id)
  return !kept?.retained(entry) && !!plan && !(planned && !planned.rrule && dayOfDate(planned, viewerTimeZone()) === dayKey())
}

async function move(entry: CalendarEntry) {
  if (await moveToToday(entry)) emit('moved')
}

const heading = computed(() => [overdueHeading, props.variant === 'row' ? 'mb-1 px-1.5' : 'mb-3'])
</script>

<template>
  <section v-if="entries.length" :class="variant === 'row' ? '' : 'mt-8'" data-overdue>
    <h3 :class="heading">
      <AppIcon v-if="variant === 'day-task'" fallback="ph:warning-circle" />
      Overdue <span class="font-normal text-ink-faint" :class="metaText">{{ entries.length }}</span>
    </h3>
    <div :class="variant === 'row' ? '' : 'space-y-1.5'">
      <div v-for="entry in entries" :key="entry.key" class="flex items-center gap-2" data-overdue-row>
        <CalendarEntryItem :entry="entry" :variant="variant" class="min-w-0 flex-1 !w-auto" @details="(e, el) => emit('details', e, el)" />
        <button v-if="movable(entry)" :class="[greyButton, 'shrink-0']" aria-label="Move to today" @click="move(entry)">
          <AppIcon fallback="ph:arrow-bend-down-right" :size="16" class="md:hidden" /><span class="md:hidden">Today</span><span class="max-md:hidden">Move to today</span>
        </button>
      </div>
    </div>
  </section>
</template>
