<script setup lang="ts">
// One calendar entry: a compact chip (month cells, all-day row), a timed block (day columns) or a
// row (the agenda layout: its time, empty all day, then its title, wrapped, and where it comes from).
// Objects open on click; occurrences of repeating dates and external events emit `details`;
// tasks get a checkbox (one the agenda kept after a completion undoes it, exact status back).
// Entries the page allows move by dragging (after a long press on touch
// screens), and timed blocks resize by their bottom edge (lib/calendar-drag.ts). Pressing the
// checkbox stays out of a page editor around an agenda, which would select the embed first.
import { computed, inject } from 'vue'
import type { CalendarEntry, CalendarSource } from '@vasta/core'
import { plannedDateFieldOf } from '@vasta/core'
import { entryTime, formatClock, isDone, setTaskDone } from '../../lib/calendar.ts'
import { ENTRY_DRAGGING, drag, pressEntry } from '../../lib/calendar-drag.ts'
import { ENTRY_COMPLETION } from '../../lib/completion-feedback.ts'
import { blockTextClasses, chip } from '../../lib/colors.ts'
import { displayTitle, formatDateShort } from '../../lib/format.ts'
import { lastError, summaryOf, typesById } from '../../lib/state.ts'
import { dayKey } from '../../lib/actions.ts'
import { taskClosing, taskDate, taskDateRole, taskEntryCheckable, type TaskDateRole } from '../../lib/calendar-tasks.ts'
import AppIcon from '../AppIcon.vue'
import ObjectLink from '../ObjectLink.vue'

const props = defineProps<{
  entry: CalendarEntry
  variant: 'chip' | 'block' | 'row' | 'day-task'
  taskRole?: TaskDateRole
  source?: CalendarSource | undefined
  /** The entry started on an earlier day (multi-day chips repeat on each day). */
  continued?: boolean
  /** It goes on after the last day shown in its row. */
  continues?: boolean
}>()
const emit = defineEmits<{ details: [entry: CalendarEntry, element: HTMLElement] }>()

const dragging = inject(ENTRY_DRAGGING, undefined)
const movable = computed(() => !!dragging?.movable(props.entry))
const resizable = computed(() => props.variant === 'block' && !!dragging?.resizable(props.entry))
// The agenda keeps an entry whose task was completed (lib/completion-feedback.ts): it stays
// checked and struck, and its checkbox undoes the completion instead of reopening the task.
const kept = inject(ENTRY_COMPLETION, undefined)

const summary = computed(() => (props.entry.objectId ? summaryOf(props.entry.objectId) : undefined))
const type = computed(() => typesById.value.get(summary.value?.typeId ?? ''))
const role = computed(() => props.taskRole ?? taskDateRole(type.value, props.entry.field))
const isTask = computed(() => !!taskDateRole(type.value, props.entry.field))
// A repeating task is done one occurrence at a time, the one it is at (completeRepeat): the others have no checkbox.
const checkable = computed(() => taskEntryCheckable(props.entry, type.value, summary.value))
/** The completion this entry is kept for, when the view kept it (another occurrence is not it). */
const retained = computed(() => (props.entry.objectId ? kept?.retained(props.entry) : undefined))
const done = computed(() => isTask.value && (!!retained.value || isDone(type.value, summary.value?.props.status?.kind === 'select' ? summary.value.props.status.value : undefined)))
const dropped = computed(() => taskClosing(type.value, summary.value) === 'dropped')
const plan = computed(() => taskDate(summary.value, plannedDateFieldOf(type.value)?.id))
const due = computed(() => taskDate(summary.value, 'due'))
const dateDay = (value: NonNullable<typeof due.value>) => value.resolution === 'day' ? value.start.slice(0, 10) : dayKey(new Date(value.start))
const afterDeadline = computed(() => !done.value && !!plan.value && !!due.value && dateDay(plan.value) > dateDay(due.value))
const taskNote = computed(() => role.value === 'planned' ? (due.value ? `Due by ${formatDateShort(due.value)}` : 'No deadline') : (plan.value ? `Planned for ${formatDateShort(plan.value)}` : 'No work date planned'))
/** A kept repeating task's note: the next occurrence's day, from the due date the completion moved it to. */
const nextDue = computed(() => {
  const value = retained.value?.repeat ? summary.value?.props.due : undefined
  return value?.kind === 'date' ? value.value : undefined
})
const title = computed(() => (props.entry.kind === 'external' ? (props.entry.title ?? '') : displayTitle(summary.value, type.value)))
const color = computed(() => (props.entry.kind === 'external' ? (props.source?.color ?? 'sky') : (type.value?.color ?? 'gray')))
const fieldName = computed(() => role.value === 'planned' ? 'Planned for' : role.value === 'due' ? 'Due by' : (props.entry.field && props.entry.field !== 'date' ? type.value?.properties.find((p) => p.id === props.entry.field)?.name : undefined))
const time = computed(() => entryTime(props.entry))
/** What a row says after the title, faint: the calendar an event is from, else the object's type. */
const origin = computed(() => (props.entry.kind === 'external' ? props.source?.name : type.value?.name))
const tooltip = computed(() =>
  [title.value, time.value, props.entry.kind === 'external' ? props.source?.name : [type.value?.name, fieldName.value].filter(Boolean).join(' · ')].filter(Boolean).join('\n')
)
const lifted = computed(() => drag.active && drag.entry?.key === props.entry.key)

function toggleDone() {
  if (!props.entry.objectId) return
  if (retained.value) kept!.undo(props.entry.objectId)
  else void setTaskDone(props.entry.objectId, type.value, !done.value).catch((error) => { lastError.value = (error as Error).message })
}

/** Single dates of objects open the object; the rest show details. */
const opens = computed(() => !!props.entry.objectId && !props.entry.recurring)

function onClick(event: MouseEvent | KeyboardEvent) {
  if (opens.value) return
  event.preventDefault()
  emit('details', props.entry, event.currentTarget as HTMLElement)
}

let lastPointer = ''
function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
  lastPointer = event.pointerType
  if (!dragging || (mode === 'move' ? !movable.value : !resizable.value)) return
  pressEntry(event, props.entry, mode, dragging.drop)
}

function onContextMenu(event: MouseEvent) {
  // A long press waits to drag: no link menu from the browser.
  if (lastPointer === 'touch' && movable.value) event.preventDefault()
}
</script>

<template>
  <!-- Occurrences of repeating dates open their details, so they are no links. -->
  <component
    :is="opens ? ObjectLink : 'div'"
    v-bind="opens ? { id: entry.objectId } : { role: 'button', tabindex: 0 }"
    :title="tooltip"
    draggable="false"
    data-calendar-entry
    class="vasta-entry group/entry relative flex w-full min-w-0 text-left leading-tight"
    :class="[
      variant === 'day-task' ? 'rounded-lg border border-line bg-hover/50 px-3 py-2 text-sm hover:bg-hover' : variant === 'row' ? 'items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover' : ['text-xs', chip(color)],
      variant === 'chip' ? 'items-center gap-1 rounded-md px-1.5 py-[3px]' : variant === 'block' ? 'h-full flex-col gap-0.5 overflow-hidden rounded-md border-l-[3px] border-current/40 px-1.5 py-1' : '',
      done ? 'opacity-60' : '',
      continued ? 'rounded-l-none' : '',
      continues ? 'rounded-r-none' : '',
      movable ? 'vasta-movable cursor-grab' : '',
      lifted ? 'opacity-40' : '',
    ]"
    @click="onClick"
    @keydown.enter="!opens && onClick($event)"
    @pointerdown="onPointerDown($event, 'move')"
    @contextmenu="onContextMenu"
  >
    <span v-if="variant === 'row'" class="w-[4.25rem] shrink-0 pt-px text-xs tabular-nums text-ink-soft">{{ entry.allDay ? '' : formatClock(entry.start) }}</span>
    <!-- A row wraps its title (an agenda sits in narrow columns); chips and blocks cut it short. -->
    <span class="flex min-w-0 gap-1" :class="variant === 'day-task' ? 'w-full items-start gap-2' : variant === 'row' ? 'items-start' : 'items-center'">
      <button
        v-if="checkable"
        class="relative shrink-0 rounded-sm hover:opacity-70 max-md:before:absolute max-md:before:-inset-2"
        :class="variant === 'row' ? 'mt-[3px]' : ''"
        :title="done ? 'Mark as to do' : 'Mark as done'"
        :aria-label="`${done ? 'Reopen' : 'Complete'} ${title}`"
        :aria-pressed="done"
        @pointerdown.stop
        @mousedown.stop
        @click.prevent.stop="toggleDone"
      >
        <AppIcon :fallback="dropped ? 'ph:x-circle' : done ? 'ph:check-circle-fill' : 'ph:circle'" :size="variant === 'day-task' ? 18 : 13" :class="variant === 'day-task' && done && !dropped ? 'text-teal-700 dark:text-teal-300' : ''" />
      </button>
      <AppIcon v-else-if="isTask" :fallback="dropped ? 'ph:x-circle' : done ? 'ph:check-circle-fill' : 'ph:circle'" :size="variant === 'day-task' ? 18 : 13" class="shrink-0 opacity-80" :title="'Complete a repeating task from its current due occurrence'" />
      <AppIcon v-else-if="entry.kind === 'external'" fallback="ph:calendar-dots" :size="12" class="shrink-0 opacity-70" :class="variant === 'row' ? ['mt-[3px]', blockTextClasses[color]] : ''" />
      <AppIcon v-else :icon="type?.system === 'task' ? undefined : summary?.icon ?? type?.icon" :fallback="type?.system === 'task' ? 'ph:calendar-blank' : 'ph:cube'" :size="12" class="shrink-0 opacity-80" :class="variant === 'row' ? ['mt-[3px]', blockTextClasses[color]] : ''" />
      <span v-if="variant === 'chip' && time && !continued" class="shrink-0 tabular-nums opacity-70">{{ time.split(' – ')[0] }}</span>
      <span v-if="variant === 'day-task'" class="min-w-0 flex-1">
        <span class="block break-words font-medium" :class="done ? 'line-through' : ''">{{ title }}</span>
        <span class="mt-1 block text-xs text-ink-soft">{{ time ? `${time} · ` : '' }}{{ taskNote }}</span>
        <span v-if="afterDeadline" class="mt-1 block text-xs text-amber-700 dark:text-amber-400">Planned after deadline</span>
        <span v-if="nextDue" data-completion-note class="mt-1 block text-xs text-ink-soft">Done this time · Next: {{ formatDateShort(nextDue) }}</span>
      </span>
      <span v-else-if="variant === 'row'" class="min-w-0 break-words"
        ><span class="font-medium" :class="done ? 'line-through' : ''">{{ title }}</span
        ><span v-if="origin" class="text-xs text-ink-faint"> · {{ origin }}</span
        ><span v-if="nextDue" data-completion-note class="block text-xs text-ink-soft">Done this time · Next: {{ formatDateShort(nextDue) }}</span></span
      >
      <span v-else class="truncate font-medium" :class="done ? 'line-through' : ''">{{ title }}</span>
      <span v-if="role" class="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium" :class="role === 'planned' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'">{{ dropped ? 'Dropped' : done ? 'Done' : role === 'planned' ? 'Planned' : 'Due' }}</span>
      <span v-else-if="type?.system === 'task' && fieldName" class="text-[10px] opacity-80">{{ fieldName }}</span>
      <AppIcon v-if="entry.recurring" fallback="ph:repeat" :size="11" class="shrink-0 opacity-60" />
    </span>
    <span v-if="variant === 'block' && time" class="truncate tabular-nums opacity-70">{{ time }}</span>
    <span v-if="variant === 'block' && entry.location" class="truncate opacity-70">{{ entry.location }}</span>
    <span
      v-if="resizable"
      class="vasta-resize absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize max-md:h-3"
      title="Drag to change the end"
      @pointerdown.stop="onPointerDown($event, 'resize')"
      @click.prevent.stop
    />
  </component>
</template>
