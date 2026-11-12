<script setup lang="ts">
// The agenda layout: the next few days, one section each, from today. Dated objects that match the
// query or view (types and filter, read from the calendar feed rather than the result list, which
// may be limited) and, if asked, the events of subscribed calendars. All-day items come first,
// then timed ones in time order, a thin line marking now on today. It reloads when the Calendar
// page would (changes anywhere) and when the day turns.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AgendaSettings, CalendarEntry, CalendarSource, FilterGroup, Id } from '@vasta/core'
import { addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { agendaDays, isPast, nowIndex, placeEntries, selectEntries } from '../lib/agenda.ts'
import { api } from '../lib/api.ts'
import { formatDayShort, formatWeekday, viewerTimeZone } from '../lib/calendar.ts'
import { onChange } from '../lib/events.ts'
import { queryContext } from '../lib/query.ts'
import { cachedSummary, primeSummaries, summaryOf, workspace } from '../lib/state.ts'
import CalendarEntryItem from './calendar/CalendarEntryItem.vue'
import EventDetails from './calendar/EventDetails.vue'
import OccurrenceDetails from './calendar/OccurrenceDetails.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{
  /** What the query or view selects: its types (empty = all) and filter. */
  typeIds: Id[]
  filter?: FilterGroup | undefined
  agenda?: AgendaSettings | undefined
  /** The object a query is embedded in, for filters on `parent`. */
  parentId?: Id | undefined
}>()

const today = ref(dayKey())
const now = ref(Date.now())
const days = computed(() => agendaDays(today.value, props.agenda))

// Data -----------------------------------------------------------------------
const entries = ref<CalendarEntry[]>([])
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
    const data = await api.calendar(workspace.space.id, range[0]!, range.at(-1)!, viewerTimeZone())
    if (id !== requestId) return
    primeSummaries(data.objects)
    entries.value = data.entries
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
})

// What is shown ---------------------------------------------------------------
const placed = computed(() =>
  placeEntries(
    selectEntries(entries.value, {
      settings: props.agenda,
      typeIds: props.typeIds,
      filter: props.filter,
      object: cachedSummary,
      context: queryContext(props.parentId ? summaryOf(props.parentId) : undefined),
    }),
    days.value
  )
)

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
  <div data-agenda>
    <p v-if="!loaded" class="py-3 text-sm text-ink-faint">Loading…</p>
    <p v-else-if="failed && !entries.length" class="py-3 text-sm text-red-600">Could not load the agenda.</p>
    <template v-else>
      <section v-for="{ day, allDay, timed } in placed" :key="day" class="mt-4 first:mt-0" :data-agenda-day="day">
        <h3 class="mb-1 px-1.5 text-sm">
          <template v-if="heading(day).lead">
            <span class="font-semibold" :class="day === today ? 'text-accent' : 'text-ink'">{{ heading(day).lead }}</span>
            <span class="text-ink-faint"> · {{ heading(day).date }}</span>
          </template>
          <span v-else class="font-semibold text-ink">{{ heading(day).date }}</span>
        </h3>

        <!-- All day first, as rows too: long titles (school notices…) need the room to wrap. -->
        <div v-for="entry in allDay" :key="entry.key">
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

        <p v-if="!allDay.length && !timed.length" class="px-1.5 py-1 text-sm text-ink-faint">Nothing planned</p>
      </section>
    </template>

    <PopoverMenu v-model:open="popoverOpen" :anchor="popover?.anchor" placement="bottom-start" width="19rem">
      <OccurrenceDetails v-if="popover?.entry.objectId" :key="`o:${popover.entry.key}`" :entry="popover.entry" @done="detailsDone" />
      <EventDetails v-else-if="popover" :key="popover.entry.key" :entry="popover.entry" :source="sourcesById.get(popover.entry.sourceId ?? '')" @done="detailsDone" />
    </PopoverMenu>
  </div>
</template>
