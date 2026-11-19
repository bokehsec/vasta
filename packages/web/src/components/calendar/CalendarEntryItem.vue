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
import { closingOf, isClosedTask, taskDatesOf } from '@vasta/core'
import { entryTime, formatClock, pastDay, viewerTimeZone } from '../../lib/calendar.ts'
import { ENTRY_DRAGGING, drag, pressEntry } from '../../lib/calendar-drag.ts'
import { ENTRY_COMPLETION } from '../../lib/completion-feedback.ts'
import { blockTextClasses, chip } from '../../lib/colors.ts'
import { displayTitle, formatDateShort } from '../../lib/format.ts'
import { lastError, summaryOf, typesById } from '../../lib/state.ts'
import { setTaskDone } from '../../lib/task-completion.ts'
import { entryBadges, entryNote, plannedAfterDeadline, taskDateRole, taskEntryCheckable } from '../../lib/calendar-tasks.ts'
import { bodyText, metaText, tinyText } from '../../lib/type-scale.ts'
import AppIcon from '../AppIcon.vue'
import ObjectLink from '../ObjectLink.vue'

const props = defineProps<{
  entry: CalendarEntry
  variant: 'chip' | 'block' | 'row' | 'day-task'
  source?: CalendarSource | undefined
  /** The entry started on an earlier day (multi-day chips repeat on each day). */
  continued?: boolean
  /** It goes on after the last day shown in its row. */
  continues?: boolean
}>()
const emit = defineEmits<{ details: [entry: CalendarEntry, element: HTMLElement] }>()

const BADGE_TONES = {
  plan: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  deadline: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  late: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  done: 'bg-hover text-ink-soft',
  field: 'bg-hover text-ink-soft',
}
const badgeClasses = (badge: { tone: keyof typeof BADGE_TONES }) => [tinyText, 'rounded px-1 py-0.5 font-medium', BADGE_TONES[badge.tone]]

const dragging = inject(ENTRY_DRAGGING, undefined)
const movable = computed(() => !!dragging?.movable(props.entry))
const resizable = computed(() => props.variant === 'block' && !!dragging?.resizable(props.entry))
// The agenda keeps an entry whose task was completed (lib/completion-feedback.ts): it stays
// checked and struck, and its checkbox undoes the completion instead of reopening the task.
const kept = inject(ENTRY_COMPLETION, undefined)

const summary = computed(() => (props.entry.objectId ? summaryOf(props.entry.objectId) : undefined))
const type = computed(() => typesById.value.get(summary.value?.typeId ?? ''))
const role = computed(() => taskDateRole(type.value, props.entry.field))
const isTask = computed(() => !!role.value)
// A repeating task is done one occurrence at a time, the one it is at (completeRepeat): the others have no checkbox.
const checkable = computed(() => taskEntryCheckable(props.entry, type.value, summary.value))
/** The completion this entry is kept for, when the view kept it (another occurrence is not it). */
const retained = computed(() => (props.entry.objectId ? kept?.retained(props.entry) : undefined))
const done = computed(() => isTask.value && (!!retained.value || (!!summary.value && isClosedTask(type.value, summary.value))))
const dropped = computed(() => !!summary.value && closingOf(type.value, summary.value) === 'dropped')
const dates = computed(() => taskDatesOf(type.value))
const afterDeadline = computed(() => !done.value && plannedAfterDeadline(summary.value, type.value, viewerTimeZone()))
const badges = computed(() => entryBadges(props.entry, type.value, dropped.value ? 'dropped' : done.value ? 'done' : undefined, pastDay))
const taskNote = computed(() => entryNote(props.entry, type.value, summary.value, formatDateShort))
/** A kept repeating task's note: the next occurrence's day, from the due date the completion moved it to. */
const nextDue = computed(() => {
  const deadline = dates.value.deadline?.id
  const value = retained.value?.repeat && deadline ? summary.value?.props[deadline] : undefined
  return value?.kind === 'date' ? value.value : undefined
})
const title = computed(() => (props.entry.kind === 'external' ? (props.entry.title ?? '') : displayTitle(summary.value, type.value)))
const color = computed(() => (props.entry.kind === 'external' ? (props.source?.color ?? 'sky') : (type.value?.color ?? 'gray')))
const fieldName = computed(() => (role.value === 'plan' ? 'Planned for' : role.value === 'deadline' ? 'Due by' : props.entry.field && props.entry.field !== 'date' ? type.value?.properties.find((p) => p.id === props.entry.field)?.name : undefined))
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
      variant === 'day-task' ? [bodyText, 'rounded-lg border border-line bg-hover/50 px-3 py-2 hover:bg-hover'] : variant === 'row' ? [bodyText, 'items-start gap-2 rounded-md px-1.5 py-1 hover:bg-hover'] : [metaText, chip(color)],
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
    <!-- A late task has no time: on a phone its row gives the empty column to the title. -->
    <span v-if="variant === 'row'" class="w-[4.25rem] shrink-0 pt-px tabular-nums text-ink-soft" :class="[metaText, entry.overdue ? 'max-md:hidden' : '']">{{ entry.allDay || entry.overdue ? '' : formatClock(entry.start) }}</span>
    <!-- A row wraps its title (an agenda sits in narrow columns), its badges flowing after it;
         chips and blocks cut it short. -->
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
        <span v-if="(time && !entry.overdue) || taskNote" class="mt-1 block text-ink-soft" :class="metaText">{{ time && !entry.overdue ? `${time}${taskNote ? ' · ' : ''}` : '' }}{{ taskNote }}</span>
        <span v-if="afterDeadline" class="mt-1 block text-amber-700 dark:text-amber-400" :class="metaText">Planned after deadline</span>
        <span v-if="nextDue" data-completion-note class="mt-1 block text-ink-soft" :class="metaText">Done this time · Next: {{ formatDateShort(nextDue) }}</span>
      </span>
      <span v-else-if="variant === 'row'" class="min-w-0 break-words"
      ><span class="font-medium" :class="done ? 'line-through' : ''">{{ title }}</span
        ><span v-if="origin" class="text-ink-faint" :class="metaText"> · {{ origin }}</span
        ><span v-for="badge in badges" :key="badge.label" data-entry-badge class="ml-1 inline-block whitespace-nowrap align-[1px]" :class="badgeClasses(badge)">{{ badge.label }}</span
        ><span v-if="nextDue" data-completion-note class="block text-ink-soft" :class="metaText">Done this time · Next: {{ formatDateShort(nextDue) }}</span></span
      >
      <span v-else class="truncate font-medium" :class="done ? 'line-through' : ''">{{ title }}</span>
      <span v-for="badge in variant === 'row' ? [] : badges" :key="badge.label" data-entry-badge class="shrink-0" :class="badgeClasses(badge)">{{ badge.label }}</span>
      <AppIcon v-if="afterDeadline && variant !== 'day-task'" fallback="ph:warning" :size="12" class="shrink-0 text-amber-700 dark:text-amber-400" title="Planned after its deadline" aria-label="Planned after its deadline" data-after-deadline />
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
