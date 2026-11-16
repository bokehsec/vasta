// Habits: objects of the built-in Habit type. A check-in is a prop of the habit itself,
// `done:<YYYY-MM-DD>`, so each day is its own synced field: two devices checking different days
// (or different habits) never overwrite each other. The value is checkbox true, or for a habit with
// a daily goal ("8 glasses") the amount reached that day, a number; the day is done once the
// amount reaches the goal. "Repeat on" (weekdays) decides which days count; a day off neither
// adds to nor breaks a streak. A habit with "Times a week" counts by the week instead (Monday to
// Sunday, any days): its weeks are scored, and its streaks are in weeks.
import { HABIT_DAYS_PROPERTY_ID, HABIT_PAUSED_PROPERTY_ID, HABIT_PER_WEEK_PROPERTY_ID, HABIT_REMIND_PROPERTY_ID, HABIT_TARGET_PROPERTY_ID, HABIT_UNIT_PROPERTY_ID } from './builtin-types.ts'
import type { HabitTypeSettings, Id, ObjectSummary, PropertyValue } from './model.ts'
import { addDays, mondayOf } from './time.ts'

type Habit = Pick<ObjectSummary, 'props' | 'createdAt'>

const DONE_PREFIX = 'done:'
/** A day off for the habit whatever its weekdays: set by `habitsWithFood` on days not counted, never stored. */
const OFF_PREFIX = 'off:'
export const habitOffKey = (day: string) => `${OFF_PREFIX}${day}`
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const habitDoneKey = (day: string) => `${DONE_PREFIX}${day}`
export const DONE_VALUE: PropertyValue = { kind: 'checkbox', value: true }

/** The progress charts a habit type starts with (HabitTypeSettings, Type settings › Progress). */
export const HABIT_PROGRESS_DEFAULT: HabitTypeSettings = { strip: 'days', panel: 'calendar', weeks: 4 }
/** The ranges a habit type's progress may cover, in weeks. */
export const HABIT_WEEKS_RANGES: readonly (4 | 8 | 13)[] = [4, 8, 13]

/** The daily goal of a habit that has one (a number above zero). */
export function habitTarget(habit: Habit): number | undefined {
  const value = habit.props[HABIT_TARGET_PROPERTY_ID]
  return value?.kind === 'number' && value.value > 0 ? value.value : undefined
}

export function habitUnit(habit: Habit): string {
  const value = habit.props[HABIT_UNIT_PROPERTY_ID]
  return value?.kind === 'text' ? value.value.trim() : ''
}

/** The reminder time, "HH:MM", read loosely ("8", "8h", "8:5", "08h30"); undefined without one. */
export function habitRemindAt(habit: Habit): string | undefined {
  const value = habit.props[HABIT_REMIND_PROPERTY_ID]
  const match = value?.kind === 'text' ? /^\s*(\d{1,2})(?:\s*[:hH.]\s*(\d{1,2})?)?\s*$/.exec(value.value) : null
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  if (hours > 23 || minutes > 59) return undefined
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** The amount reached on a day: a number for goals, 1 for a plain check (the goal, once one is set later). */
export function habitValue(habit: Habit, day: string): number {
  return valueOf(habit.props[habitDoneKey(day)], habitTarget(habit))
}

function valueOf(value: PropertyValue | undefined, target: number | undefined): number {
  if (value?.kind === 'number') return Math.max(0, value.value)
  if (value?.kind === 'checkbox' && value.value) return target ?? 1
  return 0
}

/** The prop a day's amount is stored as; undefined clears the day. */
export function habitDayValue(habit: Habit, amount: number): PropertyValue | undefined {
  if (amount <= 0) return undefined
  return habitTarget(habit) ? { kind: 'number', value: amount } : DONE_VALUE
}

export function isHabitDone(habit: Habit, day: string): boolean {
  const target = habitTarget(habit)
  const value = habitValue(habit, day)
  return target ? value >= target : value > 0
}

/** How far along a day is, 0 to 1 (a plain habit is 0 or 1). */
export function habitProgress(habit: Habit, day: string): number {
  const target = habitTarget(habit)
  const value = habitValue(habit, day)
  return target ? Math.min(1, value / target) : value > 0 ? 1 : 0
}

/** Every day the habit was done (the goal reached), oldest first. */
export function habitDays(habit: Habit): string[] {
  const target = habitTarget(habit)
  return Object.entries(habit.props)
    .filter(([key, value]) => key.startsWith(DONE_PREFIX) && (target ? valueOf(value, target) >= target : valueOf(value, target) > 0))
    .map(([key]) => key.slice(DONE_PREFIX.length))
    .sort()
}

/** Every day with something logged, done or not (partial amounts too). */
function loggedDays(habit: Habit): string[] {
  return Object.keys(habit.props)
    .filter((key) => key.startsWith(DONE_PREFIX) && valueOf(habit.props[key], undefined) > 0)
    .map((key) => key.slice(DONE_PREFIX.length))
    .sort()
}

/** Weekday ids ("mon"…) it repeats on; empty means every day. */
export function habitWeekdays(habit: Habit): string[] {
  const value = habit.props[HABIT_DAYS_PROPERTY_ID]
  return value?.kind === 'select' ? value.value : []
}

export function isHabitPaused(habit: Habit): boolean {
  const value = habit.props[HABIT_PAUSED_PROPERTY_ID]
  return value?.kind === 'checkbox' && value.value
}

/** Times a week, for a habit counted by the week (1 to 7); undefined for a daily habit. */
export function habitWeeklyTarget(habit: Habit): number | undefined {
  const value = habit.props[HABIT_PER_WEEK_PROPERTY_ID]
  if (value?.kind !== 'number' || !(value.value >= 1)) return undefined
  return Math.min(7, Math.floor(value.value))
}

/** Whether a day can count for the habit: one of its weekdays (any day for a weekly habit), not a day off. */
export function isHabitScheduled(habit: Habit, day: string): boolean {
  if (habit.props[habitOffKey(day)]) return false
  if (habitWeeklyTarget(habit)) return true
  const days = habitWeekdays(habit)
  return !days.length || days.includes(WEEKDAYS[new Date(`${day}T00:00:00.000Z`).getUTCDay()]!)
}

/** Whether the habit still asks for something on a day: a daily habit's scheduled day; a weekly one until its week is full (or done that day). */
export function isHabitDue(habit: Habit, day: string): boolean {
  if (!isHabitScheduled(habit, day)) return false
  const weekly = habitWeeklyTarget(habit)
  if (!weekly || isHabitDone(habit, day)) return true
  const monday = mondayOf(day)
  let done = 0
  for (let d = monday; d <= addDays(monday, 6); d = addDays(d, 1)) if (isHabitDone(habit, d)) done++
  return done < weekly
}

/** The first day a habit counts from: the earlier of the day it was made and its first check-in. */
export function habitSince(habit: Habit, createdDay = habit.createdAt.slice(0, 10)): string {
  const first = loggedDays(habit)[0]
  return first && first < createdDay ? first : createdDay
}

/** Completions done and expected (and the amount logged, for goals) over a stretch of days. */
export interface HabitTally {
  expected: number
  done: number
  amount: number
}

const emptyTally = (): HabitTally => ({ expected: 0, done: 0, amount: 0 })

/**
 * One Monday–Sunday week of a habit, up to `today`. Daily habit: each scheduled day expects one,
 * except today until it is done. Weekly habit (N a week): done counts at most N, and a week
 * expects only what can no longer be made up; the first part-week (began after Monday) never
 * counts against it. Nothing before `since`.
 */
export function habitWeek(habit: Habit, monday: string, today: string, since: string): HabitTally {
  const tally = emptyTally()
  const weekly = habitWeeklyTarget(habit)
  const sunday = addDays(monday, 6)
  if (!weekly) {
    for (let day = monday; day <= sunday && day <= today; day = addDays(day, 1)) {
      if (day < since || !isHabitScheduled(habit, day)) continue
      const done = isHabitDone(habit, day)
      if (done) tally.done++
      if (done || day < today) tally.expected++
      tally.amount += habitValue(habit, day)
    }
    return tally
  }
  if (sunday < since || monday > today) return tally
  let done = 0
  let left = 0
  for (let day = monday; day <= sunday; day = addDays(day, 1)) {
    if (day < since || !isHabitScheduled(habit, day)) continue
    if (day > today) left++
    else if (isHabitDone(habit, day)) done++
    else if (day === today) left++
    if (day <= today) tally.amount += habitValue(habit, day)
  }
  tally.done = Math.min(done, weekly)
  tally.expected = since > monday ? tally.done : tally.done + Math.max(0, weekly - tally.done - left)
  return tally
}

const addTally = (sum: HabitTally, add: HabitTally) => {
  sum.expected += add.expected
  sum.done += add.done
  sum.amount += add.amount
}

export interface HabitStats {
  /** Done in a row up to today (today not done yet does not break it): scheduled days, or weeks for a weekly habit. */
  current: number
  best: number
  /** What `current` and `best` count. */
  streakUnit: 'day' | 'week'
  total: number
  /** Done / expected over the last 30 days (a weekly habit: this week and the four before); today counts once done. */
  rate30: number
  /** This week (Monday to Sunday): done and scheduled (a weekly habit: days done and its times a week). */
  weekDone: number
  weekScheduled: number
  /** Goals: the average amount per scheduled day over the last 30 days. */
  average30: number
  /** The first day it counts from: the earlier of its creation and its first check-in. */
  since: string
  /** Times a week, for a weekly habit. */
  weekly?: number
}

/** `createdDay` is the day the habit was made, in the viewer's calendar. */
export function habitStats(habit: Habit, today: string, createdDay = habit.createdAt.slice(0, 10)): HabitStats {
  const done = new Set(habitDays(habit))
  const since = habitSince(habit, createdDay)
  const scheduled = (day: string) => isHabitScheduled(habit, day)
  const weekly = habitWeeklyTarget(habit)
  const monday = mondayOf(today)

  let current = 0
  let best = 0
  if (weekly) {
    // Weeks with N done in a row; the week under way does not break it, and neither does a first
    // part-week that fell short.
    let run = 0
    for (let week = mondayOf(since); week <= monday; week = addDays(week, 7)) {
      const count = habitWeek(habit, week, today, since).done
      if (count >= weekly) best = Math.max(best, ++run)
      else if (week !== monday && !(since > week)) run = 0
    }
    current = run
  } else {
    for (let day = today; day >= since; day = addDays(day, -1)) {
      if (!scheduled(day)) continue
      if (done.has(day)) current++
      else if (day !== today) break
    }
    let run = 0
    for (let day = since; day <= today; day = addDays(day, 1)) {
      if (!scheduled(day)) continue
      if (done.has(day)) best = Math.max(best, ++run)
      else if (day !== today) run = 0
    }
  }

  let windowDone = 0
  let windowScheduled = 0
  let windowAmount = 0
  for (let day = addDays(today, -29); day <= today; day = addDays(day, 1)) {
    if (day < since || !scheduled(day)) continue
    if (done.has(day)) windowDone++
    if (done.has(day) || day !== today) windowScheduled++
    windowAmount += habitValue(habit, day)
  }
  let rate30 = windowScheduled ? windowDone / windowScheduled : 0
  if (weekly) {
    const weeks = emptyTally()
    for (let i = 4; i >= 0; i--) addTally(weeks, habitWeek(habit, addDays(monday, -7 * i), today, since))
    rate30 = weeks.expected ? weeks.done / weeks.expected : 0
  }

  let weekDone = 0
  let weekScheduled = 0
  for (let day = monday; day <= addDays(monday, 6); day = addDays(day, 1)) {
    if (!scheduled(day)) continue
    weekScheduled++
    if (done.has(day)) weekDone++
  }

  return {
    current,
    best,
    streakUnit: weekly ? 'week' : 'day',
    total: done.size,
    rate30,
    weekDone,
    weekScheduled: weekly ?? weekScheduled,
    average30: windowScheduled ? windowAmount / windowScheduled : 0,
    since,
    ...(weekly ? { weekly } : {}),
  }
}

/** One day across habits: how many were done and how many counted that day. */
export interface HabitDayTotal {
  day: string
  done: number
  due: number
}

/**
 * Per day from `from` to `to` (up to `today`), across habits not paused: a daily habit counts on
 * its scheduled days since it began (today only once done); a weekly habit only on days it was
 * done, since it asks for no day in particular. The share done is `done / due`.
 */
export function habitDayTotals(habits: Habit[], from: string, to: string, today: string): HabitDayTotal[] {
  const active = habits.filter((h) => !isHabitPaused(h)).map((habit) => ({ habit, since: habitSince(habit), weekly: habitWeeklyTarget(habit) }))
  const totals: HabitDayTotal[] = []
  for (let day = from; day <= to && day <= today; day = addDays(day, 1)) {
    const total = { day, done: 0, due: 0 }
    for (const { habit, since, weekly } of active) {
      if (day < since) continue
      const done = isHabitDone(habit, day)
      if (done) total.done++
      if (done || (!weekly && isHabitScheduled(habit, day) && day !== today)) total.due++
    }
    totals.push(total)
  }
  return totals
}

/** What a habit plans for a whole Monday–Sunday week (all its days, as if the week were over). */
export function habitWeekPlan(habit: Habit, monday: string): number {
  return habitWeek(habit, monday, addDays(monday, 7), habitSince(habit)).expected
}

export interface HabitReport {
  /** Mondays, oldest first; the last is the current week. */
  weeks: string[]
  /** All habits not paused, over the whole range. */
  total: HabitTally
  /** Per week, in the order of `weeks`; paused habits left out. */
  byWeek: HabitTally[]
  habits: { id: Id; total: HabitTally; byWeek: HabitTally[]; paused: boolean }[]
}

/** Progress of `habits` over the `weekCount` weeks ending with the one `today` is in. */
export function habitReport(habits: (Habit & { id: Id })[], weekCount: number, today: string): HabitReport {
  const current = mondayOf(today)
  const weeks = Array.from({ length: Math.max(1, weekCount) }, (_, i) => addDays(current, -7 * (Math.max(1, weekCount) - 1 - i)))
  const total = emptyTally()
  const byWeek = weeks.map(emptyTally)
  const rows = habits.map((habit) => {
    const since = habitSince(habit)
    const paused = isHabitPaused(habit)
    const row = { id: habit.id, total: emptyTally(), byWeek: weeks.map((week) => habitWeek(habit, week, today, since)), paused }
    row.byWeek.forEach((tally, i) => {
      addTally(row.total, tally)
      if (!paused) addTally(byWeek[i]!, tally)
    })
    if (!paused) addTally(total, row.total)
    return row
  })
  return { weeks, total, byWeek, habits: rows }
}

const amountText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/** "3/8 glasses" for a day of a habit with a daily goal; '' for a plain one. */
export function habitAmountText(habit: Habit, day: string): string {
  const target = habitTarget(habit)
  if (!target) return ''
  const unit = habitUnit(habit)
  return `${amountText(habitValue(habit, day))}/${amountText(target)}${unit ? ` ${unit}` : ''}`
}
