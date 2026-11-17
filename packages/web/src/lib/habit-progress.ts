// Habit progress beside the Tracker. Where it shows (off, above the habits, or beside them; below
// them on a phone), which of the two charts (a trend line or a calendar of done days) and over how
// many weeks are each person's own (an account preference, lib/preferences.ts), the habit type's
// `habits` being only what shows until they pick; they are picked where they show (the Tracker's
// Display menu, the Progress tab). The numbers come from core's habitReport and habitDayTotals,
// counted the same way everywhere.
import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { preference } from './preferences.ts'
import { addDays, habitDayTotals, habitPausedOn, habitPercent, habitProgressSettings, habitReport, habitWeekPlan, mondayOf, type HabitChart, type HabitTally, type HabitTypeSettings, type ObjectType, type ObjectSummary } from '@vasta/core'

export const CHARTS: { id: HabitChart; label: string; hint: string }[] = [
  { id: 'line', label: 'Trend line', hint: 'Share done each week' },
  { id: 'calendar', label: 'Calendar', hint: 'Every day, darker when more got done' },
]

/**
 * How this person sees a habit type's progress: their own picks over the type's starting values
 * (older stored settings read as the nearest of today's two charts). `save` keeps a pick for them
 * only, on every device.
 */
export function useHabitDisplay(type: MaybeRefOrGetter<Pick<ObjectType, 'id' | 'habits'> | undefined>) {
  const own = preference<Partial<HabitTypeSettings> | undefined>(() => {
    const t = toValue(type)
    return t ? `type/${t.id}/habits` : undefined
  }, undefined, { scope: 'account' })
  const settings = computed<HabitTypeSettings>(() => habitProgressSettings({ ...toValue(type)?.habits, ...own.value }))
  const save = (patch: Partial<HabitTypeSettings>) => {
    own.value = { ...own.value, ...patch }
  }
  return { settings, save }
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
