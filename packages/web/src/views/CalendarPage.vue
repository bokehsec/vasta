<script setup lang="ts">
// Calendar: month, week, three-day and day views over everything dated in the space (daily notes,
// date properties, task due dates) plus events from subscribed calendars. The day view is a page of
// its own (DayPage), and Today opens it. Beside the week and day views, a small month calendar marks
// what each day holds. The view and day live in the URL (?view=week&date=2026-10-18). Closed tasks
// (Done, Dropped) are left out unless asked for; one marked Done here stays where it was, checked
// and struck, until the calendar is looked at afresh (lib/completion-feedback.ts, as in an agenda).
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CalendarEntry, CalendarSource, Id, ObjectRecord, ObjectSummary } from '@vasta/core'
import { addDays, dayEntries, dayTotals, isClosedTask, isValidDay } from '@vasta/core'
import AppIcon from '../components/AppIcon.vue'
import PopoverMenu from '../components/PopoverMenu.vue'
import CalendarSources from '../components/calendar/CalendarSources.vue'
import DayPage from '../components/calendar/DayPage.vue'
import HabitChecklist from '../components/HabitChecklist.vue'
import EventDetails from '../components/calendar/EventDetails.vue'
import MiniMonth from '../components/calendar/MiniMonth.vue'
import MonthGrid from '../components/calendar/MonthGrid.vue'
import OccurrenceDetails from '../components/calendar/OccurrenceDetails.vue'
import QuickCreate from '../components/calendar/QuickCreate.vue'
import TimeGrid from '../components/calendar/TimeGrid.vue'
import { dayKey, setProperties } from '../lib/actions.ts'
import { nutritionOn } from '../lib/nutrition.ts'
import { api } from '../lib/api.ts'
import {
  CALENDAR_VIEWS,
  changeEntryTimes,
  instantAt,
  movedTimes,
  stepAnchor,
  viewerTimeZone,
  viewTitle,
  visibleDays,
  type CalendarView,
  type DayMarks,
} from '../lib/calendar.ts'
import { ENTRY_DRAGGING, type DropTarget } from '../lib/calendar-drag.ts'
import { swatchClasses } from '../lib/colors.ts'
import { ENTRY_COMPLETION, createCompletionFeedback, type RetainedCompletion } from '../lib/completion-feedback.ts'
import { onChange } from '../lib/events.ts'
import { onObjectSave } from '../lib/object-saves.ts'
import { cachedSummary, lastError, notice, primeFromObject, primeSummaries, refreshCounts, typesById, workspace } from '../lib/state.ts'
import { isPhone } from '../lib/viewport.ts'
import { openObject } from '../lib/open.ts'
import { taskDateRole, taskEntryCheckable } from '../lib/calendar-tasks.ts'

const route = useRoute()
const router = useRouter()

const VIEW_KEY = 'vasta.calendar.view'
const HIDDEN_KEY = 'vasta.calendar.hidden'
const CLOSED_KEY = 'vasta.calendar.showClosed'
const PANEL_KEY = 'vasta.calendar.panel'
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
}

const isView = (value: unknown): value is CalendarView => CALENDAR_VIEWS.some((v) => v.id === value)
const view = computed<CalendarView>(() => (isView(route.query.view) ? route.query.view : isView(storage.get(VIEW_KEY)) ? (storage.get(VIEW_KEY) as CalendarView) : isPhone.value ? 'three-days' : 'month'))
const anchor = computed(() => (typeof route.query.date === 'string' && isValidDay(route.query.date) ? route.query.date : dayKey()))
const days = computed(() => visibleDays(view.value, anchor.value))
const title = computed(() => viewTitle(view.value, days.value, anchor.value))

function go(next: { view?: CalendarView; date?: string }) {
  const nextView = next.view ?? view.value
  storage.set(VIEW_KEY, nextView)
  void router.replace({ path: '/calendar', query: { view: nextView, date: next.date ?? anchor.value } })
}

// Data -----------------------------------------------------------------------
const entries = ref<CalendarEntry[]>([])
const sources = ref<CalendarSource[]>([])
const loading = ref(false)
const sourcesById = computed(() => new Map(sources.value.map((s) => [s.id, s])))
let requestId = 0

async function load() {
  if (!workspace.space) return
  const id = ++requestId
  const range = days.value
  loading.value = true
  try {
    const data = await api.calendar(workspace.space.id, range[0]!, range.at(-1)!, viewerTimeZone())
    if (id !== requestId) return
    primeSummaries(data.objects)
    entries.value = data.entries
    // What was kept after a completion: an entry whose task was deleted goes with it, and one
    // whose completion was undone (or failed) keeps its place only until this fresh feed says
    // where the task now is.
    for (const [key, entry] of kept) {
      if (!entry.objectId || !cachedSummary(entry.objectId) || !completion.entries.has(entry.objectId)) kept.delete(key)
    }
    completion.prune(new Set([...kept.values()].map((entry) => entry.objectId!)))
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function loadSources() {
  if (workspace.space) sources.value = await api.calendarSources(workspace.space.id)
}

watch(() => `${days.value[0]}:${days.value.at(-1)}`, load)
onMounted(() => {
  void load()
  void loadSources()
})

let reloadTimer: ReturnType<typeof setTimeout> | undefined
const stopListening = onChange((event) => {
  if (event.kind === 'calendar') void loadSources()
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    void load()
    void loadMini()
    void loadCreated()
  }, 300)
})
onBeforeUnmount(() => {
  stopListening()
  clearTimeout(reloadTimer)
})

// What is shown ---------------------------------------------------------------
type Category = 'tasks' | 'objects' | `source:${string}`
const hidden = reactive(new Set<string>(JSON.parse(storage.get(HIDDEN_KEY) ?? '[]') as string[]))
watch(hidden, () => storage.set(HIDDEN_KEY, JSON.stringify([...hidden])))
const showDailyNotes = computed(() => !hidden.has('daily-notes'))
// Closed tasks are their own choice, off by default: not in `hidden`, so a saved list of hidden
// categories never brings them back.
const showClosed = ref(storage.get(CLOSED_KEY) === '1')
watch(showClosed, (show) => storage.set(CLOSED_KEY, show ? '1' : '0'))

/** Whether the entry's object is closed (done, dropped) and closed tasks are not asked for. */
function leftOut(entry: CalendarEntry): boolean {
  if (showClosed.value || !entry.objectId) return false
  const summary = cachedSummary(entry.objectId)
  return !!summary && isClosedTask(typesById.value.get(summary.typeId), summary)
}

function categoryOf(entry: CalendarEntry): Category {
  if (entry.kind === 'external') return `source:${entry.sourceId}`
  const type = typesById.value.get(cachedSummary(entry.objectId ?? '')?.typeId ?? '')
  return taskDateRole(type, entry.field) ? 'tasks' : 'objects'
}

const dailyNotes = computed(() => {
  const map = new Map<string, Id>()
  if (showDailyNotes.value) for (const entry of entries.value) if (entry.kind === 'daily-note' && entry.objectId) map.set(entry.startDay, entry.objectId)
  return map
})

/** Kcal eaten each day with food logged, for the month (a space that tracks food). */
const dayKcal = computed(() => {
  const map = new Map<string, number>()
  if (!nutritionOn.value) return map
  for (const entry of entries.value) {
    const note = entry.kind === 'daily-note' && entry.objectId ? cachedSummary(entry.objectId) : undefined
    const eaten = note ? dayEntries(note) : []
    if (eaten.length) map.set(entry.startDay, dayTotals(eaten).kcal)
  }
  return map
})

const selected = computed(() => entries.value.filter((entry) => entry.kind !== 'daily-note' && !hidden.has(categoryOf(entry)) && !leftOut(entry)))

// Completion feedback, as in an agenda (components/AgendaView.vue): a task marked Done here saves,
// then its entry stays where it was, checked and struck, through the background reloads; only a
// fresh look (a reload, another range, view or filter) drops it. Closed tasks are left out, so
// the entry it had is kept here and merged back; a repeating task's entry stays at the occurrence
// just done. Only entries shown when the completion happens are kept.
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
    // observe only if its row is still here).
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
// A fresh look at the calendar (another view, range or filter) drops what it kept. The source is
// one string: an array would be new on every re-run and clear what it should not.
watch(
  () => [view.value, days.value[0], days.value.at(-1), showClosed.value, [...hidden].join()].join('\u0000'),
  () => {
    completion.clear()
    kept.clear()
  },
  { flush: 'sync' }
)

const entriesByDay = computed(() => {
  const map = new Map<string, CalendarEntry[]>()
  const first = days.value[0]!
  const last = days.value.at(-1)!
  const held = [...kept.values()].filter((entry) => !selected.value.some((one) => one.key === entry.key))
  for (const entry of [...selected.value, ...held]) {
    for (let day = entry.startDay < first ? first : entry.startDay; day <= entry.endDay && day <= last; day = addDays(day, 1)) {
      const list = map.get(day) ?? []
      list.push(entry)
      map.set(day, list)
    }
  }
  return map
})

function toggle(key: string) {
  if (hidden.has(key)) hidden.delete(key)
  else hidden.add(key)
}
const filterAnchor = ref<HTMLElement | null>(null)
const filterOpen = ref(false)
const hiddenCount = computed(() => hidden.size)

// Moving and resizing ------------------------------------------------------------
// Occurrences of repeating dates ask whether the change is for this one, the following or all.
const movable = (entry: CalendarEntry) => entry.kind === 'property' || entry.kind === 'object'
const resizable = (entry: CalendarEntry) => movable(entry) && !entry.allDay && entry.startDay === entry.endDay

async function drop(entry: CalendarEntry, mode: 'move' | 'resize', target: DropTarget) {
  const times = mode === 'resize' ? { start: entry.start, end: instantAt(entry.startDay, target.minutes ?? 0) } : movedTimes(entry, target)
  if (times.start === entry.start && (times.end ?? '') === (entry.end ?? '')) return
  try {
    if (!(await changeEntryTimes(entry, times))) return
  } catch (error) {
    lastError.value = (error as Error).message
  }
  await load()
}
provide(ENTRY_DRAGGING, { movable, resizable, drop: (entry, mode, target) => void drop(entry, mode, target) })

// Popovers ----------------------------------------------------------------------
type Popover =
  | { kind: 'create'; day: string; minutes?: number; anchor: HTMLElement }
  | { kind: 'details'; entry: CalendarEntry; anchor: HTMLElement }
const popover = ref<Popover | null>(null)
const pending = ref<{ day: string; minutes?: number } | null>(null)
const popoverOpen = computed({
  get: () => !!popover.value,
  set: (open) => {
    if (!open) closePopover()
  },
})

function closePopover() {
  popover.value = null
  pending.value = null
}

function createInMonth(day: string, element: HTMLElement) {
  popover.value = { kind: 'create', day, anchor: element }
}

async function createAtTime(day: string, minutes: number | undefined) {
  pending.value = { day, ...(minutes !== undefined ? { minutes } : {}) }
  await nextTick()
  const element = document.querySelector<HTMLElement>('.vasta-pending-slot')
  if (element) popover.value = { kind: 'create', day, ...(minutes !== undefined ? { minutes } : {}), anchor: element }
}

function showDetails(entry: CalendarEntry, element: HTMLElement) {
  popover.value = { kind: 'details', entry, anchor: element }
}

async function created() {
  closePopover()
  await load()
}

// The day (DayPage) ------------------------------------------------------------------
const createdToday = ref<ObjectSummary[]>([])
async function loadCreated() {
  if (view.value !== 'day' || !workspace.space) return
  const day = anchor.value
  const list = await api.query(workspace.space.id, {
    query: { typeIds: [], filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'createdAt', operator: 'is', value: { kind: 'literal', value: day } }] } },
    today: dayKey(),
    timeZone: viewerTimeZone(),
  })
  if (day !== anchor.value) return
  primeSummaries(list)
  // Daily notes and date objects are the day itself, not things made on it.
  createdToday.value = list.filter((o) => !['daily-note', 'date'].includes(typesById.value.get(o.typeId)?.system ?? ''))
}
watch([view, anchor], loadCreated, { immediate: true })

/** The day's daily note, hidden or not; one just started counts before the calendar reloads. */
const started = reactive(new Map<string, Id>())
const noteOf = (day: string) => entries.value.find((e) => e.kind === 'daily-note' && e.startDay === day)?.objectId ?? started.get(day)
const starting = ref(false)

/** Start the day's note (from the Daily note type's default template), with what was typed if anything. */
async function startNote(text?: string, day = anchor.value) {
  if (!workspace.space || starting.value) return
  starting.value = true
  try {
    const note = await api.dailyNote(workspace.space.id, day, text)
    primeFromObject(note)
    started.set(day, note.id)
    void refreshCounts()
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    starting.value = false
  }
}

// The small month beside the week and day views ---------------------------------------
const panelOpen = ref(storage.get(PANEL_KEY) !== '0')
watch(panelOpen, (open) => storage.set(PANEL_KEY, open ? '1' : '0'))
const showPanel = computed(() => view.value !== 'month' && !isPhone.value && panelOpen.value)

const miniMonth = ref(`${anchor.value.slice(0, 7)}-01`)
const miniMarks = ref(new Map<string, DayMarks>())
let miniRequest = 0

async function loadMini() {
  if (!workspace.space || !showPanel.value) return
  const id = ++miniRequest
  const range = visibleDays('month', miniMonth.value)
  try {
    const data = await api.calendar(workspace.space.id, range[0]!, range.at(-1)!, viewerTimeZone())
    if (id !== miniRequest) return
    primeSummaries(data.objects)
    const marks = new Map<string, DayMarks>()
    const mark = (day: string) => marks.get(day) ?? (marks.set(day, {}), marks.get(day)!)
    const withText = new Set(data.objects.filter((o) => o.preview.trim()).map((o) => o.id))
    const taskDays = new Set<string>()
    for (const entry of data.entries) {
      if (entry.kind === 'daily-note') {
        if (showDailyNotes.value && withText.has(entry.objectId ?? '')) mark(entry.startDay).note = true
        continue
      }
      const category = categoryOf(entry)
      if (hidden.has(category) || leftOut(entry)) continue
      const key = category === 'tasks' ? 'tasks' : category === 'objects' ? 'dated' : 'events'
      for (let day = entry.startDay < range[0]! ? range[0]! : entry.startDay; day <= entry.endDay && day <= range.at(-1)!; day = addDays(day, 1)) {
        if (key === 'tasks') {
          const taskDay = `${day}:${entry.objectId}`
          if (taskDays.has(taskDay)) continue
          taskDays.add(taskDay)
        }
        const marks = mark(day)
        marks[key] = (marks[key] ?? 0) + 1
      }
    }
    for (const [day, count] of Object.entries(data.references ?? {})) mark(day).references = count
    miniMarks.value = marks
  } catch {
    // The marks are a nicety; the calendar itself reports errors.
  }
}
watch([miniMonth, showPanel, () => hidden.size, showClosed], () => void loadMini(), { immediate: true })

// Keyboard ------------------------------------------------------------------------
function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  // defaultPrevented: the app's own shortcuts (G then T opens today's note, not today here).
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable="true"]') || popover.value) return
  const keys: Record<string, () => void> = {
    t: () => go({ date: dayKey() }),
    ArrowLeft: () => go({ date: stepAnchor(view.value, anchor.value, -1) }),
    ArrowRight: () => go({ date: stepAnchor(view.value, anchor.value, 1) }),
    m: () => go({ view: 'month' }),
    w: () => go({ view: 'week' }),
    '3': () => go({ view: 'three-days' }),
    d: () => go({ view: 'day' }),
  }
  const run = keys[event.key]
  if (!run) return
  event.preventDefault()
  run()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const sourcesOpen = ref(false)
const openDayView = (day: string) => go({ view: 'day', date: day })
const openNote = (day: string) => {
  const id = dailyNotes.value.get(day)
  if (id) void openObject(id)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 md:px-5 md:py-3">
      <!-- The day view's page carries the date itself. -->
      <h1 v-if="view !== 'day'" class="mr-2 text-xl font-bold tracking-tight first-letter:uppercase">{{ title }}</h1>
      <div class="flex items-center gap-0.5">
        <button class="rounded-md p-1.5 text-ink-soft hover:bg-hover hover:text-ink" title="Previous (←)" @click="go({ date: stepAnchor(view, anchor, -1) })">
          <AppIcon fallback="ph:caret-left" />
        </button>
        <button class="rounded-md border border-line px-2.5 py-1 text-sm hover:bg-hover" title="Today (T)" @click="go({ date: dayKey() })">Today</button>
        <button class="rounded-md p-1.5 text-ink-soft hover:bg-hover hover:text-ink" title="Next (→)" @click="go({ date: stepAnchor(view, anchor, 1) })">
          <AppIcon fallback="ph:caret-right" />
        </button>
      </div>
      <AppIcon v-if="loading" fallback="ph:circle-notch" class="animate-spin text-ink-faint" />

      <div class="ml-auto flex items-center gap-2">
        <button ref="filterAnchor" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-hover hover:text-ink" @click="filterOpen = !filterOpen">
          <AppIcon fallback="ph:eye" /> Show
          <span v-if="hiddenCount" class="rounded bg-hover px-1 text-xs">{{ hiddenCount }} hidden</span>
        </button>
        <PopoverMenu v-model:open="filterOpen" :anchor="filterAnchor" placement="bottom-end" width="15rem">
          <label v-for="item in [{ key: 'daily-notes', label: 'Daily notes', icon: 'ph:calendar-check' }, { key: 'tasks', label: 'Tasks', icon: 'ph:check-circle' }, { key: 'objects', label: 'Dated objects', icon: 'ph:cube' }]" :key="item.key" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-hover">
            <input type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" :checked="!hidden.has(item.key)" @change="toggle(item.key)" />
            <AppIcon :fallback="item.icon" class="text-ink-soft" /> {{ item.label }}
          </label>
          <label class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-hover">
            <input v-model="showClosed" type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" />
            <AppIcon fallback="ph:check-square" class="text-ink-soft" /> Done and dropped tasks
          </label>
          <template v-if="sources.length">
            <div class="mx-2.5 my-1 border-t border-line" />
            <label v-for="source in sources" :key="source.id" class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-hover">
              <input type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" :checked="!hidden.has(`source:${source.id}`)" @change="toggle(`source:${source.id}`)" />
              <span class="h-2.5 w-2.5 rounded-full" :class="swatchClasses[source.color ?? 'sky']" />
              <span class="truncate" :class="source.enabled ? '' : 'text-ink-faint line-through'">{{ source.name }}</span>
            </label>
          </template>
          <div class="mx-2.5 my-1 border-t border-line" />
          <button class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="(filterOpen = false), (sourcesOpen = true)">
            <AppIcon fallback="ph:calendar-dots" class="text-ink-soft" /> Subscribed calendars…
          </button>
        </PopoverMenu>

        <div class="flex rounded-lg bg-hover p-0.5 text-sm">
          <button
            v-for="option in CALENDAR_VIEWS"
            :key="option.id"
            class="rounded-md px-2.5 py-1"
            :class="view === option.id ? 'bg-surface font-medium shadow-sm' : 'text-ink-soft hover:text-ink'"
            :title="`${option.label} (${option.short})`"
            @click="go({ view: option.id })"
          >
            {{ isPhone ? option.phoneLabel ?? option.label : option.label }}
          </button>
        </div>
        <button
          v-if="view !== 'month' && !isPhone"
          class="grid h-8 w-8 place-items-center rounded-md hover:bg-hover hover:text-ink"
          :class="panelOpen ? 'bg-hover text-ink' : 'text-ink-soft'"
          :title="panelOpen ? 'Hide the month' : 'Show the month'"
          @click="panelOpen = !panelOpen"
        >
          <AppIcon fallback="ph:calendar-blank" />
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <div class="min-w-0 flex-1" :class="view === 'day' ? 'overflow-y-auto' : ''">
        <MonthGrid
          v-if="view === 'month'"
          :days="days"
          :anchor="anchor"
          :entries-by-day="entriesByDay"
          :daily-notes="dailyNotes"
          :day-kcal="dayKcal"
          :sources="sourcesById"
          @open-day="openDayView"
          @open-note="openNote"
          @create="createInMonth"
          @details="showDetails"
        />
        <DayPage
          v-else-if="view === 'day'"
          :key="anchor"
          :day="anchor"
          :note-id="noteOf(anchor)"
          :entries="entriesByDay.get(anchor) ?? []"
          :sources="sourcesById"
          :created="createdToday"
          :starting="starting"
          :habits="!showPanel"
          @details="showDetails"
          @create="(element) => createInMonth(anchor, element)"
          @start-note="startNote"
        />
        <TimeGrid
          v-else
          :key="view"
          :days="days"
          :entries-by-day="entriesByDay"
          :daily-notes="dailyNotes"
          :sources="sourcesById"
          :pending="pending"
          @open-day="openDayView"
          @open-note="openNote"
          @create="createAtTime"
          @details="showDetails"
        />
      </div>

      <aside v-if="showPanel" class="w-[17.5rem] shrink-0 overflow-y-auto border-l border-line px-4 py-4">
        <MiniMonth v-model:month="miniMonth" :selected="anchor" :marks="miniMarks" @pick="(day) => go({ date: day })" />
        <HabitChecklist v-if="view === 'day'" :key="anchor" :day="anchor" class="mt-6 border-t border-line pt-5" />
      </aside>
    </div>

    <PopoverMenu v-model:open="popoverOpen" :anchor="popover?.anchor" :placement="view === 'month' ? 'bottom-start' : view === 'day' ? 'bottom-end' : 'right-start'" width="19rem">
      <QuickCreate v-if="popover?.kind === 'create'" :key="`${popover.day}:${popover.minutes}`" :day="popover.day" :minutes="popover.minutes" @done="created" />
      <OccurrenceDetails v-else-if="popover?.kind === 'details' && popover.entry.objectId" :key="`o:${popover.entry.key}`" :entry="popover.entry" @done="created" />
      <EventDetails v-else-if="popover?.kind === 'details'" :key="popover.entry.key" :entry="popover.entry" :source="sourcesById.get(popover.entry.sourceId ?? '')" @done="created" />
    </PopoverMenu>

    <CalendarSources v-if="sourcesOpen" @close="sourcesOpen = false" @changed="loadSources(), load()" />
  </div>
</template>
