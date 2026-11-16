// Habit progress beside the Tracker. Where it shows (off, above the habits, or beside them; below
// them on a phone), which of the two charts (a trend line or a calendar of done days) and over how
// many weeks are kept on the habit type, so every device shows the same; they are picked where they
// show (the Tracker's Display menu, the Progress tab). The numbers come from core's habitReport and
// habitDayTotals, counted the same way everywhere.
import { computed, type Ref } from 'vue'
import { api } from './api.ts'
import { clone } from './clone.ts'
import { replaceType, unsavedTypes, workspace } from './state.ts'
import { addDays, habitDayTotals, habitPausedOn, habitPercent, habitProgressSettings, habitReport, habitWeekPlan, mondayOf, type HabitChart, type HabitTally, type HabitTypeSettings, type ObjectType, type ObjectSummary } from '@vasta/core'

export const CHARTS: { id: HabitChart; label: string; hint: string }[] = [
  { id: 'line', label: 'Trend line', hint: 'Share done each week' },
  { id: 'calendar', label: 'Calendar', hint: 'Every day, darker when more got done' },
]

/** A habit type's progress settings; older ones (more charts, picked separately) read as the nearest of today's two. */
export const habitProgressOf = (type: Pick<ObjectType, 'habits'> | undefined): HabitTypeSettings => habitProgressSettings(type?.habits)

// Send changes in order: an earlier response must not undo a later optimistic choice.
const progressSaves = new Map<string, Promise<void>>()

/** Saves a change to a habit type's progress (place, chart, range), for every device. */
export function saveHabitProgress(type: ObjectType, patch: Partial<HabitTypeSettings>) {
  const current = () => workspace.types.find((t) => t.id === type.id) ?? type
  const next = clone(current())
  next.habits = { ...habitProgressOf(next), ...patch }
  unsavedTypes.set(type.id, next)
  replaceType(next)
  const previous = progressSaves.get(type.id) ?? Promise.resolve()
  const save = previous.catch(() => {}).then(async () => {
    // Preserve other type edits made while this request waited its turn.
    const payload = clone(current())
    payload.habits = next.habits
    const saved = await api.saveType(payload)
    if (progressSaves.get(type.id) === save && unsavedTypes.get(type.id) === next) {
      unsavedTypes.delete(type.id)
      replaceType(saved)
    }
  })
  progressSaves.set(type.id, save)
  void save.finally(() => {
    if (progressSaves.get(type.id) === save) {
      progressSaves.delete(type.id)
      if (unsavedTypes.get(type.id) === next) unsavedTypes.delete(type.id)
    }
  }).catch(() => {})
  return save
}

/** The type's progress, shown on every device alike. */
export function useTypeHabitProgress(type: Ref<ObjectType | undefined>) {
  return computed<HabitTypeSettings>(() => habitProgressOf(type.value))
}

export const percentText = (tally: Pick<HabitTally, 'done' | 'expected'> | undefined) => {
  const value = habitPercent(tally)
  return value === undefined ? '—' : `${value}%`
}

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const dayLabel = (day: string) => short.format(new Date(`${day}T00:00:00Z`))
export const longDayLabel = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`))

/** A week of the range with its tally; this week also with what it still plans. */
export interface ProgressWeek {
  monday: string
  tally: HabitTally
  current: boolean
  plan: number
  percent: number | undefined
}
/** A day of the range: how many of its habits were done of those it asked. */
export interface ProgressDay {
  day: string
  total?: { done: number; due: number }
  future: boolean
  today: boolean
}

/** Everything the Tracker's progress and the Progress tab draw, for `habits` (done-from-food days already filled in). */
export function useHabitProgress(habits: Ref<ObjectSummary[]>, today: Ref<string>, weeks: Ref<HabitTypeSettings['weeks']>) {
  const report = computed(() => habitReport(habits.value, weeks.value, today.value))
  const byWeek = computed<ProgressWeek[]>(() =>
    report.value.weeks.map((monday, i) => {
      const tally = report.value.byWeek[i]!
      const current = i === report.value.weeks.length - 1
      const plan = current ? habits.value.reduce((sum, h) => sum + habitWeekPlan(h, monday), 0) : tally.expected
      return { monday, tally, current, plan, percent: habitPercent(tally) }
    })
  )
  const total = computed(() => report.value.total)
  /** Each week's days, Monday first. */
  const days = computed<ProgressDay[][]>(() => {
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
      .map((habit) => ({ habit, paused: habitPausedOn(habit, today.value), row: byId.get(habit.id)! }))
      .filter((r) => r.row)
      .sort((a, b) => Number(a.paused) - Number(b.paused) || (habitPercent(b.row.total) ?? -1) - (habitPercent(a.row.total) ?? -1) || a.habit.title.localeCompare(b.habit.title))
  })
  return { report, byWeek, total, days, habitRows }
}

/** A calendar cell's fill for a share done (0 to 1); undefined: nothing counted that day. */
export function heatStyle(share: number | undefined) {
  if (share === undefined) return { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--color-line-strong)' }
  return { background: `color-mix(in srgb, var(--color-chart-heat) ${Math.round(8 + share * 92)}%, var(--color-hover))` }
}
