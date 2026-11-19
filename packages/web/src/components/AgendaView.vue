<script setup lang="ts">
// The agenda layout: the next few days, one section each, from today. Dated objects that match the
// query or view (types and filter, read from the calendar feed rather than the result list, which
// may be limited) and, if asked, the events of subscribed calendars. All-day items come first,
// then timed ones in time order, a thin line marking now on today. A task marked Done here stays
// where it was, checked and struck, until the agenda is looked at afresh (lib/completion-feedback.ts).
// Above the days, tasks that are late (a missed deadline, an unfinished plan) are listed as Overdue,
// each with Move to today (OverdueSection). It reloads when the Calendar page would (changes
// anywhere) and when the day turns. An entry the page allows moves by dragging (after a long press
// on touch): dropping it on another day moves it as on the Calendar page (lib/calendar-drop.ts: a
// task's plan, an event's time); a notice says where it went, with Undo. On touch, dragging near
// the top or bottom of the scrolling page scrolls it, so days off screen can be reached
// (markDragScroll).
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { AgendaSettings, CalendarEntry, CalendarSource, FilterGroup, Id } from '@vasta/core'
import { addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { agendaDays, isPast, lateEntries, nowIndex, placeEntries, selectEntries, splitAllDay } from '../lib/agenda.ts'
import { api } from '../lib/api.ts'
import { formatDayShort, formatWeekday, viewerTimeZone } from '../lib/calendar.ts'
import { dropEntry } from '../lib/calendar-drop.ts'
import { mergeTaskDates } from '../lib/calendar-tasks.ts'
import { ENTRY_DRAGGING, drag, markDragScroll, type DropTarget } from '../lib/calendar-drag.ts'
import { onChange } from '../lib/events.ts'
import { useEntryCompletion } from '../lib/use-completion.ts'
import { queryContext } from '../lib/query.ts'
import { cachedSummary, primeSummaries, summaryOf, typesById, workspace } from '../lib/state.ts'
import { bodyText } from '../lib/type-scale.ts'
import CalendarEntryItem from './calendar/CalendarEntryItem.vue'
import EventDetails from './calendar/EventDetails.vue'
import OccurrenceDetails from './calendar/OccurrenceDetails.vue'
import OverdueSection from './calendar/OverdueSection.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{
  /** What the query or view selects: its types (empty = all) and filter. */
  typeIds: Id[]
  filter?: FilterGroup | undefined
  agenda?: AgendaSettings | undefined
  /** The object a query is embedded in, for filters on `parent`. */
  parentId?: Id | undefined
  /** A readonly embed (a whiteboard card, a page that cannot be edited) offers no dragging. */
  readonly?: boolean
}>()

const today = ref(dayKey())
const now = ref(Date.now())
const days = computed(() => agendaDays(today.value, props.agenda))

// Data -----------------------------------------------------------------------
const entries = ref<CalendarEntry[]>([])
/** The tasks late today (the feed's own: they are before the range). */
const overdue = ref<CalendarEntry[]>([])
const sources = ref<CalendarSource[]>([])
const loaded = ref(false)
const failed = ref(false)
const sourcesById = computed(() => new Map(sources.value.map((s) => [s.id, s])))
let requestId = 0

async function load() {
  if (!workspace.space) return
  const id = ++requestId
  const range = days.value
  try {
    const data = await api.calendar(workspace.space.id, range[0]!, range.at(-1)!, viewerTimeZone(), today.value)
    if (id !== requestId) return
    primeSummaries(data.objects)
    entries.value = data.entries
    overdue.value = data.overdue
    settle()
    failed.value = false
  } catch {
    if (id === requestId) failed.value = true
  } finally {
    if (id === requestId) loaded.value = true
  }
}

async function loadSources() {
  if (!workspace.space || !props.agenda?.calendars) return
  try {
    sources.value = await api.calendarSources(workspace.space.id)
  } catch {
    // Without them the events still show, in the default color.
  }
}

watch(() => `${days.value[0]}:${days.value.at(-1)}`, () => void load(), { immediate: true })
watch(() => !!props.agenda?.calendars, () => void loadSources(), { immediate: true })

let reloadTimer: ReturnType<typeof setTimeout> | undefined
const root = ref<HTMLElement | null>(null)
let unmarkScroll: (() => void) | undefined
onMounted(() => (unmarkScroll = root.value ? markDragScroll(root.value) : undefined))
const stopListening = onChange((event) => {
  if (event.kind === 'calendar') void loadSources()
  // Typing in the page that embeds the query saves it constantly; that alone moves nothing here.
  if (event.kind === 'object' && event.id === props.parentId) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void load(), 300)
})
// The line for now moves each minute; at midnight today moves on, and the range with it.
const tick = setInterval(() => {
  now.value = Date.now()
  today.value = dayKey()
}, 60_000)
onBeforeUnmount(() => {
  stopListening()
  clearTimeout(reloadTimer)
  clearInterval(tick)
  unmarkScroll?.()
})

// What is shown ---------------------------------------------------------------
const selected = computed(() =>
  mergeTaskDates(
    selectEntries([...entries.value, ...overdue.value], {
      settings: props.agenda,
      typeIds: props.typeIds,
      filter: props.filter,
      object: cachedSummary,
      context: queryContext(props.parentId ? summaryOf(props.parentId) : undefined),
    }),
    cachedSummary,
    typesById.value
  )
)

// Completion feedback (lib/use-completion.ts, as on the Calendar page): a task marked Done here
// stays where it was, checked and struck, through the background reloads this page makes; only a
// fresh look at the agenda (a reload, another filter or range) drops it. The source of a fresh
// look is one string: an array would be new on every re-run and clear what it should not.
const { merge, moveEntry, settle } = useEntryCompletion({
  selected: () => selected.value,
  resetOn: () => [JSON.stringify(props.filter), JSON.stringify(props.agenda), props.typeIds.join(), props.parentId, days.value[0], days.value.at(-1)].join('\u0000'),
})

const shown = computed(() => merge(selected.value))
const late = computed(() => lateEntries(shown.value))
const placed = computed(() => placeEntries(shown.value, days.value))

/** "Today · Thu Nov 12", "Tomorrow · Fri Nov 13", then "Sat Nov 14". */
function heading(day: string): { lead?: string; date: string } {
  const date = `${formatWeekday(day)} ${formatDayShort(day)}`
  return day === today.value ? { lead: 'Today', date } : day === addDays(today.value, 1) ? { lead: 'Tomorrow', date } : { date }
}

/** A day's timed entries as rows; on today, the line for now sits among them, and what is over is faded. */
function rowsOf(day: string, timed: CalendarEntry[]) {
  const isToday = day === today.value
  const rows: { key: string; entry?: CalendarEntry; past?: boolean }[] = timed.map((entry) => ({ key: entry.key, entry, past: isToday && isPast(entry, now.value) }))
  if (isToday) rows.splice(nowIndex(timed, now.value), 0, { key: 'now' })
  return rows
}

// Dragging --------------------------------------------------------------------
// A day's section is a drop target (data-day); objects move to the day they land on (lib/calendar-drop.ts).
// Events of subscribed calendars never move, nor do the late tasks (they have Move to today), nor
// anything in a readonly embed.
const movable = (entry: CalendarEntry) => !props.readonly && !entry.overdue && (entry.kind === 'property' || entry.kind === 'object')
async function drop(entry: CalendarEntry, mode: 'move' | 'resize', target: DropTarget) {
  if (mode === 'move' && (await dropEntry(entry, mode, target, moveEntry))) await load()
}
/** The day a dragged entry would land on, tinted as on the Calendar page. */
const dropDay = computed(() => (drag.active && drag.mode === 'move' && drag.target ? drag.target.day : ''))
provide(ENTRY_DRAGGING, { movable, resizable: () => false, drop: (entry, mode, target) => void drop(entry, mode, target) })

// Details of external events and occurrences of repeating dates, as on the Calendar page.
const popover = ref<{ entry: CalendarEntry; anchor: HTMLElement } | null>(null)
const popoverOpen = computed({
  get: () => !!popover.value,
  set: (open) => {
    if (!open) popover.value = null
  },
})
function showDetails(entry: CalendarEntry, element: HTMLElement) {
  popover.value = { entry, anchor: element }
}
async function detailsDone() {
  popover.value = null
  await load()
}
</script>

<template>
  <div ref="root" data-agenda>
    <p v-if="!loaded" class="py-3 text-ink-faint" :class="bodyText">Loading…</p>
    <p v-else-if="failed && !entries.length" class="py-3 text-red-600" :class="bodyText">Could not load the agenda.</p>
    <template v-else>
      <OverdueSection :entries="late" variant="row" @details="showDetails" @moved="load" />
      <section v-for="{ day, allDay, timed } in placed" :key="day" class="mt-4 rounded-lg first:mt-0" :class="dropDay === day ? 'bg-accent/10' : ''" :data-agenda-day="day" :data-day="day">
        <h3 class="mb-1 px-1.5" :class="bodyText">
          <template v-if="heading(day).lead">
            <span class="font-semibold" :class="day === today ? 'text-accent' : 'text-ink'">{{ heading(day).lead }}</span>
            <span class="text-ink-faint"> · {{ heading(day).date }}</span>
          </template>
          <span v-else class="font-semibold text-ink">{{ heading(day).date }}</span>
        </h3>

        <!-- All day first: events as one wrapping row of chips, lined up with the titles below; objects (a task due) stay rows. -->
        <div v-if="splitAllDay(allDay).chips.length" class="flex flex-wrap gap-1 py-1 pl-[4.75rem] pr-1.5" data-agenda-chips>
          <div v-for="entry in splitAllDay(allDay).chips" :key="entry.key" class="min-w-0 max-w-64">
            <CalendarEntryItem :entry="entry" variant="chip" :source="sourcesById.get(entry.sourceId ?? '')" @details="showDetails" />
          </div>
        </div>
        <div v-for="entry in splitAllDay(allDay).rows" :key="entry.key">
          <CalendarEntryItem :entry="entry" variant="row" :source="sourcesById.get(entry.sourceId ?? '')" @details="showDetails" />
        </div>

        <div v-if="timed.length">
          <template v-for="row in rowsOf(day, timed)" :key="row.key">
            <div v-if="!row.entry" role="separator" aria-label="Now" data-agenda-now class="relative mx-1.5 my-0.5 h-px bg-accent">
              <span class="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-accent" />
            </div>
            <div v-else :class="row.past ? 'opacity-50' : ''" :data-past="row.past ? '' : undefined">
              <CalendarEntryItem :entry="row.entry" variant="row" :source="sourcesById.get(row.entry.sourceId ?? '')" @details="showDetails" />
            </div>
          </template>
        </div>

        <p v-if="!allDay.length && !timed.length" class="px-1.5 py-1 text-ink-faint" :class="bodyText">Nothing planned</p>
      </section>
    </template>

    <PopoverMenu v-model:open="popoverOpen" :anchor="popover?.anchor" placement="bottom-start" width="19rem">
      <OccurrenceDetails v-if="popover?.entry.objectId" :key="`o:${popover.entry.key}`" :entry="popover.entry" @done="detailsDone" />
      <EventDetails v-else-if="popover" :key="popover.entry.key" :entry="popover.entry" :source="sourcesById.get(popover.entry.sourceId ?? '')" @done="detailsDone" />
    </PopoverMenu>
  </div>
</template>
