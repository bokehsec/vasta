<script setup lang="ts">
// The agenda layout: the next few days, one section each, from today. Dated objects that match the
// query or view (types and filter, read from the calendar feed rather than the result list, which
// may be limited) and, if asked, the events of subscribed calendars. All-day items come first,
// then timed ones in time order, a thin line marking now on today. A task marked Done here stays
// where it was, checked and struck, until the agenda is looked at afresh (lib/completion-feedback.ts).
// It reloads when the Calendar page would (changes anywhere) and when the day turns. An entry the
// page allows moves by dragging (after a long press on touch): dropping it on another day sets the
// date field the agenda places it by (a task's due, an event's time), as the Calendar page does
// (lib/calendar-drag.ts); a notice says where it went, with Undo for a single date. On touch,
// dragging near the top or bottom of the scrolling page scrolls it, so days off screen can be
// reached (markDragScroll).
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import type { AgendaSettings, CalendarEntry, CalendarSource, FilterGroup, Id, ObjectRecord, ObjectSummary } from '@vasta/core'
import { addDays } from '@vasta/core'
import { dayKey, setProperties } from '../lib/actions.ts'
import { agendaDays, isPast, nowIndex, placeEntries, selectEntries, splitAllDay } from '../lib/agenda.ts'
import { api } from '../lib/api.ts'
import { changeEntryTimes, formatDayShort, formatWeekday, movedTimes, viewerTimeZone } from '../lib/calendar.ts'
import { ENTRY_DRAGGING, drag, markDragScroll, type DropTarget } from '../lib/calendar-drag.ts'
import { ENTRY_COMPLETION, createCompletionFeedback, type RetainedCompletion } from '../lib/completion-feedback.ts'
import { onChange } from '../lib/events.ts'
import { onObjectSave } from '../lib/object-saves.ts'
import { queryContext } from '../lib/query.ts'
import { cachedSummary, lastError, notice, primeSummaries, summaryOf, typesById, workspace } from '../lib/state.ts'
import CalendarEntryItem from './calendar/CalendarEntryItem.vue'
import EventDetails from './calendar/EventDetails.vue'
import OccurrenceDetails from './calendar/OccurrenceDetails.vue'
import { taskEntryCheckable } from '../lib/calendar-tasks.ts'
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
    // What the agenda kept after a completion: an entry whose task was deleted goes with it, and
    // one whose completion was undone (or failed) keeps its place only until this fresh feed says
    // where the task now is.
    for (const [key, entry] of kept) {
      if (!entry.objectId || !cachedSummary(entry.objectId) || !completion.entries.has(entry.objectId)) kept.delete(key)
    }
    completion.prune(new Set([...kept.values()].map((entry) => entry.objectId!)))
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
  selectEntries(entries.value, {
    settings: props.agenda,
    typeIds: props.typeIds,
    filter: props.filter,
    object: cachedSummary,
    context: queryContext(props.parentId ? summaryOf(props.parentId) : undefined),
  })
)

// Completion feedback (lib/completion-feedback.ts), as on type pages: a task marked Done here
// saves, then its entry stays where it was, checked and struck, through the background reloads
// this page makes; only a fresh look at the agenda (a reload, another filter or range) drops it.
// The filter would drop the task, so the entry it had is kept here and merged back where it was
// (its own times put it back on its day, among its neighbours); a repeating task's entry stays at
// the occurrence just done, its note saying the next one. Only entries the agenda shows when the
// completion happens are kept.
const kept = reactive(new Map<string, CalendarEntry>())
function replace(object: ObjectRecord | ObjectSummary) {
  if (!completion.entries.has(object.id)) return
  if ([...kept.values()].some((entry) => entry.objectId === object.id)) return
  for (const entry of selected.value) {
    if (entry.objectId !== object.id || !taskEntryCheckable(entry, typesById.value.get(object.typeId), object)) continue
    kept.set(entry.key, { ...entry })
  }
}
const completion = createCompletionFeedback({
  type: (object) => typesById.value.get(object.typeId),
  rows: () => {
    // The summaries behind what is shown, kept completions included (an undone one reaches
    // observe only if its row is still here, as on a type page).
    const summaries: ObjectSummary[] = []
    const seen = new Set<Id>()
    for (const entry of [...selected.value, ...kept.values()]) {
      if (!entry.objectId || seen.has(entry.objectId)) continue
      seen.add(entry.objectId)
      const summary = cachedSummary(entry.objectId)
      if (summary) summaries.push(summary)
    }
    return summaries
  },
  replace,
  save: setProperties,
  failed: (retry) => {
    notice.value = { message: 'The task was not saved. Try again.', action: { label: 'Retry', run: () => retry().catch(() => {}) } }
  },
})
/** What a kept entry's checkbox asks: the completion it is kept for, and its Undo. */
provide(ENTRY_COMPLETION, {
  retained: (entry: CalendarEntry): RetainedCompletion | undefined => (kept.has(entry.key) ? completion.entries.get(entry.objectId ?? '') : undefined),
  undo: (objectId: Id) => void completion.undo(objectId),
})
const stopSaves = onObjectSave((object, base) => completion.observe(object, base))
onBeforeUnmount(stopSaves)
// A fresh look at the agenda (another filter, date field or range) drops what it kept. The source
// is one string: an array would be new on every re-run and clear what it should not.
watch(
  () => [JSON.stringify(props.filter), JSON.stringify(props.agenda), props.typeIds.join(), props.parentId, days.value[0], days.value.at(-1)].join('\u0000'),
  () => {
    completion.clear()
    kept.clear()
  },
  { flush: 'sync' }
)

const placed = computed(() => {
  const fresh = selected.value
  const held = [...kept.values()].filter((entry) => !fresh.some((one) => one.key === entry.key))
  return placeEntries([...fresh, ...held], days.value)
})

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
// A day's section is a drop target (data-day); objects move to the day they land on, keeping their
// time of day. Events of subscribed calendars never move, and neither does anything in a readonly
// embed.
const movable = (entry: CalendarEntry) => !props.readonly && (entry.kind === 'property' || entry.kind === 'object')
/** A drag moves the task on purpose: the entry a completion kept goes with it (suppressed while it saves). */
async function forget<T>(objectId: Id, run: () => Promise<T>): Promise<T> {
  for (const [key, entry] of kept) if (entry.objectId === objectId) kept.delete(key)
  return await completion.moving(objectId, run)
}
async function drop(entry: CalendarEntry, mode: 'move' | 'resize', target: DropTarget) {
  if (mode !== 'move') return
  const times = movedTimes(entry, target)
  if (times.start === entry.start && (times.end ?? '') === (entry.end ?? '')) return
  try {
    const move = () => changeEntryTimes(entry, times)
    const changed = await (entry.objectId && completion.entries.has(entry.objectId) ? forget(entry.objectId, move) : move())
    if (!changed) return
    announceMove(entry, target.day)
  } catch (error) {
    lastError.value = (error as Error).message
  }
  await load()
}
/**
 * "Moved to Thu, Nov 19", with Undo putting the previous times back. A repeating date's change was
 * asked for a scope (this, the following, all) that Undo cannot know, so that one only says it.
 */
function announceMove(entry: CalendarEntry, day: string) {
  const message = `Moved to ${formatWeekday(day)}, ${formatDayShort(day)}`
  if (entry.recurring) {
    notice.value = { message }
    return
  }
  const previous = { start: entry.start, ...(entry.end ? { end: entry.end } : {}) }
  const undo = async () => {
    try {
      await changeEntryTimes(entry, previous)
    } catch (error) {
      lastError.value = (error as Error).message
    }
    await load()
  }
  notice.value = { message, action: { label: 'Undo', run: undo } }
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
    <p v-if="!loaded" class="py-3 text-sm text-ink-faint">Loading…</p>
    <p v-else-if="failed && !entries.length" class="py-3 text-sm text-red-600">Could not load the agenda.</p>
    <template v-else>
      <section v-for="{ day, allDay, timed } in placed" :key="day" class="mt-4 rounded-lg first:mt-0" :class="dropDay === day ? 'bg-accent/10' : ''" :data-agenda-day="day" :data-day="day">
        <h3 class="mb-1 px-1.5 text-sm">
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

        <p v-if="!allDay.length && !timed.length" class="px-1.5 py-1 text-sm text-ink-faint">Nothing planned</p>
      </section>
    </template>

    <PopoverMenu v-model:open="popoverOpen" :anchor="popover?.anchor" placement="bottom-start" width="19rem">
      <OccurrenceDetails v-if="popover?.entry.objectId" :key="`o:${popover.entry.key}`" :entry="popover.entry" @done="detailsDone" />
      <EventDetails v-else-if="popover" :key="popover.entry.key" :entry="popover.entry" :source="sourcesById.get(popover.entry.sourceId ?? '')" @done="detailsDone" />
    </PopoverMenu>
  </div>
</template>
