// Habit progress beside the Tracker. Where it shows (off, above the habits, or beside them; below
// them on a phone), which charts and over how many weeks are kept on the habit type (Type settings ›
// Progress), so every device shows the same. The numbers come from core's habitReport and
// habitDayTotals, counted the same way as the Progress tab.
import { computed, type Ref } from 'vue'
import { addDays, HABIT_PROGRESS_DEFAULT, HABIT_WEEKS_RANGES, habitDayTotals, habitReport, habitWeekPlan, isHabitPaused, mondayOf, type HabitPanelChart, type HabitProgressPlace, type HabitStripChart, type HabitTypeSettings, type HabitTally, type ObjectType, type ObjectSummary } from '@vasta/core'

export type ProgressPlace = HabitProgressPlace
export type StripChart = HabitStripChart
export type PanelChart = HabitPanelChart

export const PROGRESS_PLACES: readonly ProgressPlace[] = ['off', 'above', 'beside']
export const STRIP_CHARTS: { id: StripChart; label: string; hint: string }[] = [
  { id: 'weeks', label: 'Week columns', hint: 'Share done each week' },
  { id: 'line', label: 'Trend line', hint: 'Share done each week, as one line' },
  { id: 'days', label: 'Day heat strip', hint: 'Every day, darker when more got done' },
  { id: 'meters', label: 'Week meters', hint: 'A bar per week' },
  { id: 'habits', label: 'Habit chips', hint: 'Each habit over the range' },
]
export const PANEL_CHARTS: { id: PanelChart; label: string; hint: string }[] = [
  { id: 'weeks', label: 'Columns and ranking', hint: 'Each week, then habits best first' },
  { id: 'line', label: 'Trend and done of expected', hint: 'A line, then each habit’s count' },
  { id: 'calendar', label: 'Calendar and habit weeks', hint: 'Days as a calendar, then each habit' },
  { id: 'counts', label: 'Done and missed', hint: 'Counts each week, not percents' },
]

// Before all of it moved into Type settings, each device kept its own picks here (the place under
// PLACE_KEY, the whole layout under OLD_LAYOUT_KEY). A device keeps seeing what it had picked for
// any part the type doesn't set yet.
const PLACE_KEY = 'vasta.habit-progress.place'
const OLD_LAYOUT_KEY = 'vasta.habit-progress.layout'

function readSaved(key: string): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
    return saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Fills each part of `saved` that isn't a known value from `fallback`. */
function settle(saved: Partial<Record<keyof HabitTypeSettings, unknown>>, fallback: HabitTypeSettings): HabitTypeSettings {
  return {
    place: PROGRESS_PLACES.find((p) => p === saved.place) ?? fallback.place,
    strip: STRIP_CHARTS.find((c) => c.id === saved.strip)?.id ?? fallback.strip,
    panel: PANEL_CHARTS.find((c) => c.id === saved.panel)?.id ?? fallback.panel,
    weeks: HABIT_WEEKS_RANGES.find((w) => w === saved.weeks) ?? fallback.weeks,
  }
}

/** What this device had picked before progress moved into Type settings, so it keeps seeing that. */
export function deviceHabitProgress(): HabitTypeSettings {
  const layout = readSaved(OLD_LAYOUT_KEY)
  const place = readSaved(PLACE_KEY).place ?? layout.place
  return settle({ ...layout, place }, HABIT_PROGRESS_DEFAULT)
}

/** A habit type's progress settings, any part it doesn't set filled from this device's old picks. */
export function habitProgressOf(type: Pick<ObjectType, 'habits'> | undefined): HabitTypeSettings {
  return settle(type?.habits ?? {}, deviceHabitProgress())
}

/** The type's progress (Type settings › Progress), shown on every device alike. */
export function useTypeHabitProgress(type: Ref<ObjectType | undefined>) {
  return computed<HabitTypeSettings>(() => habitProgressOf(type.value))
}

export const percentOf = (tally: Pick<HabitTally, 'done' | 'expected'> | undefined) => (tally?.expected ? Math.round((tally.done / tally.expected) * 100) : undefined)
export const percentText = (tally: Pick<HabitTally, 'done' | 'expected'> | undefined) => {
  const value = percentOf(tally)
  return value === undefined ? '—' : `${value}%`
}

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const dayLabel = (day: string) => short.format(new Date(`${day}T00:00:00Z`))
export const longDayLabel = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`))

/** Everything the strips and panels draw, for `habits` (done-from-food days already filled in). */
export function useHabitProgress(habits: Ref<ObjectSummary[]>, today: Ref<string>, weeks: Ref<HabitTypeSettings['weeks']>) {
  const report = computed(() => habitReport(habits.value, weeks.value, today.value))
  /** Each week with its tally; this week also with what it still plans (for "still possible"). */
  const byWeek = computed(() => {
    const active = habits.value.filter((h) => !isHabitPaused(h))
    return report.value.weeks.map((monday, i) => {
      const tally = report.value.byWeek[i]!
      const current = i === report.value.weeks.length - 1
      const plan = current ? active.reduce((sum, h) => sum + habitWeekPlan(h, monday), 0) : tally.expected
      return { monday, tally, current, plan, percent: percentOf(tally) }
    })
  })
  /** Finished weeks only (this one is still under way), the total over the range. */
  const total = computed(() => report.value.total)
  const days = computed(() => {
    const from = report.value.weeks[0]!
    const totals = new Map(habitDayTotals(habits.value, from, addDays(mondayOf(today.value), 6), today.value).map((t) => [t.day, t]))
    return report.value.weeks.map((monday) =>
      Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i)
        return { day, total: totals.get(day), future: day > today.value, today: day === today.value }
      })
    )
  })
  const habitRows = computed(() => {
    const byId = new Map(report.value.habits.map((r) => [r.id, r]))
    return habits.value
      .map((habit) => ({ habit, paused: isHabitPaused(habit), row: byId.get(habit.id)! }))
      .filter((r) => r.row)
      .sort((a, b) => Number(a.paused) - Number(b.paused) || (percentOf(b.row.total) ?? -1) - (percentOf(a.row.total) ?? -1) || a.habit.title.localeCompare(b.habit.title))
  })
  return { report, byWeek, total, days, habitRows }
}

/** A heat cell's fill for a share done (0 to 1); undefined: nothing counted that day. */
export function heatStyle(share: number | undefined) {
  if (share === undefined) return { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--color-line-strong)' }
  return { background: `color-mix(in srgb, var(--color-chart-heat) ${Math.round(8 + share * 92)}%, var(--color-hover))` }
}
