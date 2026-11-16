// Habits: objects of the built-in Habit type. A check-in is a prop of the habit itself,
// `done:<YYYY-MM-DD>`, so each day is its own synced field: two devices checking different days
// (or different habits) never overwrite each other. The value is checkbox true, or for a habit with
// a daily goal ("8 glasses") the amount reached that day, a number; the day is done once the
// amount reaches the goal. "Repeat on" (weekdays) decides which days count; a day off neither
// adds to nor breaks a streak. A habit with "Times a week" counts by the week instead (Monday to
// Sunday, any days): its weeks are scored, and its streaks are in weeks. A pause is a stretch of
// days (`pause:<first day>`, its last day as the value, empty while it lasts): those days are days
// off, like a weekday it does not repeat on. How a habit is doing comes from one place, the week
// tally (habitWeek): the report, the stats, the Tracker and the agents all add those up.
import { HABIT_SPARKY_PROPERTY_ID, HABIT_DAYS_PROPERTY_ID, HABIT_PER_WEEK_PROPERTY_ID, HABIT_REMIND_PROPERTY_ID, HABIT_TARGET_PROPERTY_ID, HABIT_UNIT_PROPERTY_ID } from './builtin-types.ts'
import type { Id, ObjectSummary, PropertyValue } from './model.ts'
import { addDays, isValidDay, mondayOf } from './time.ts'

type Habit = Pick<ObjectSummary, 'props' | 'createdAt'>

const DONE_PREFIX = 'done:'
const SPARKY_PREFIX = 'sf:'
export const habitSparkyKey = (day: string) => `${SPARKY_PREFIX}${day}`

export function habitSparkyRule(habit: Pick<Habit, 'props'>): string | undefined {
  const value = habit.props[HABIT_SPARKY_PROPERTY_ID]
  return value?.kind === 'select' ? value.value[0] : undefined
}
/** A day off for the habit whatever its weekdays: set by `habitsWithFood` on days not counted, never stored. */
const OFF_PREFIX = 'off:'
export const habitOffKey = (day: string) => `${OFF_PREFIX}${day}`
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const habitDoneKey = (day: string) => `${DONE_PREFIX}${day}`
export const DONE_VALUE: PropertyValue = { kind: 'checkbox', value: true }

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

/** The amount reached on a day: a number for goals, 1 for a plain check (the goal, once one is set later). A hand entry wins over SparkyFitness. */
export function habitValue(habit: Habit, day: string): number {
  return valueOf(habit.props[habitDoneKey(day)] ?? habit.props[habitSparkyKey(day)], habitTarget(habit))
}

/** The amount SparkyFitness gave for a day, whatever was entered by hand; undefined when it gave none. */
export function habitSyncedValue(habit: Habit, day: string): number | undefined {
  const value = habit.props[habitSparkyKey(day)]
  return value ? valueOf(value, habitTarget(habit)) : undefined
}

/** Whether a day has an entry by hand (a cleared one too), which wins over what SparkyFitness gave. */
export const habitHasHandValue = (habit: Habit, day: string) => habitDoneKey(day) in habit.props

/** What SparkyFitness gave for a day in words ("4,000 steps", "done"); '' when it gave nothing. */
export function habitSyncedText(habit: Habit, day: string): string {
  const value = habitSyncedValue(habit, day)
  if (value === undefined) return ''
  if (!habitTarget(habit)) return value > 0 ? 'done' : 'not done'
  const unit = habitUnit(habit)
  return `${amountText(value)}${unit ? ` ${unit}` : ''}`
}

/**
 * What one tap on a habit's mark for a day does: set an amount (a plain habit toggles; one with a
 * goal adds 1, and past the goal starts over), or ask for it. A habit linked to SparkyFitness
 * always asks: a tap that saved the synced value plus one would freeze it as a hand entry that wins
 * over SparkyFitness from then on.
 */
export function habitTap(habit: Habit, day: string): { amount: number } | 'ask' {
  if (habitSparkyRule(habit)) return 'ask'
  const target = habitTarget(habit)
  if (!target) return { amount: isHabitDone(habit, day) ? 0 : 1 }
  const value = habitValue(habit, day)
  return { amount: value >= target ? 0 : value + 1 }
}

function valueOf(value: PropertyValue | undefined, target: number | undefined): number {
  if (value?.kind === 'number') return Math.max(0, value.value)
  if (value?.kind === 'checkbox' && value.value) return target ?? 1
  return 0
}

/** The prop a day's amount is stored as; a linked habit keeps an explicit cleared hand value. */
export function habitDayValue(habit: Habit, amount: number): PropertyValue | undefined {
  if (amount <= 0) {
    const linked = habitSparkyRule(habit) || Object.keys(habit.props).some((key) => key.startsWith(SPARKY_PREFIX))
    if (!linked) return undefined
    return habitTarget(habit) ? { kind: 'number', value: 0 } : { kind: 'checkbox', value: false }
  }
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
  return loggedDays(habit).filter((day) => isHabitDone(habit, day))
}

/** Every day with something logged, done or not (partial amounts too). */
function loggedDays(habit: Habit): string[] {
  const days = new Set(Object.keys(habit.props)
    .filter((key) => key.startsWith(DONE_PREFIX) || key.startsWith(SPARKY_PREFIX))
    .map((key) => key.slice(key.indexOf(':') + 1)))
  return [...days].filter((day) => habitValue(habit, day) > 0).sort()
}

/** Weekday ids ("mon"…) it repeats on; empty means every day. */
export function habitWeekdays(habit: Habit): string[] {
  const value = habit.props[HABIT_DAYS_PROPERTY_ID]
  return value?.kind === 'select' ? value.value : []
}

/** A stretch of days a habit is paused: `to` is the last of them; without one it lasts until resumed. */
export interface HabitPause {
  from: string
  to?: string
}

const PAUSE_PREFIX = 'pause:'
export const habitPauseKey = (from: string) => `${PAUSE_PREFIX}${from}`

/** The habit's pauses, earliest first. */
export function habitPauses(habit: Habit): HabitPause[] {
  const pauses: HabitPause[] = []
  for (const [key, value] of Object.entries(habit.props)) {
    if (!key.startsWith(PAUSE_PREFIX) || value?.kind !== 'text') continue
    const from = key.slice(PAUSE_PREFIX.length)
    const to = value.value.trim()
    if (isValidDay(from)) pauses.push({ from, ...(isValidDay(to) ? { to } : {}) })
  }
  return pauses.sort((a, b) => a.from.localeCompare(b.from))
}

/** Whether a day is inside a pause. */
export const habitPausedOn = (habit: Habit, day: string) => habitPauses(habit).some((p) => day >= p.from && (!p.to || day <= p.to))

/** The props that replace pause `old` (none: a new one) with `next` (none: removes it); undefined clears a prop. */
export function habitPauseChange(old: HabitPause | undefined, next: HabitPause | undefined): Record<string, PropertyValue | undefined> {
  return {
    ...(old ? { [habitPauseKey(old.from)]: undefined } : {}),
    ...(next ? { [habitPauseKey(next.from)]: { kind: 'text', value: next.to ?? '' } } : {}),
  }
}

/** Pause from `today` until resumed; nothing to change when `today` is paused already. */
export function pauseHabit(habit: Habit, today: string): Record<string, PropertyValue | undefined> {
  return habitPausedOn(habit, today) ? {} : habitPauseChange(undefined, { from: today })
}

/** Resume on `today`: a pause under way ends yesterday (one that began today never was). */
export function resumeHabit(habit: Habit, today: string): Record<string, PropertyValue | undefined> {
  const changes = habitPauses(habit)
    .filter((p) => p.from <= today && (!p.to || p.to >= today))
    .map((p) => habitPauseChange(p, p.from < today ? { from: p.from, to: addDays(today, -1) } : undefined))
  return Object.assign({}, ...changes)
}

/** Times a week, for a habit counted by the week (1 to 7); undefined for a daily habit. */
export function habitWeeklyTarget(habit: Habit): number | undefined {
  const value = habit.props[HABIT_PER_WEEK_PROPERTY_ID]
  if (value?.kind !== 'number' || !(value.value >= 1)) return undefined
  return Math.min(7, Math.floor(value.value))
}

/** Whether a day can count for the habit: one of its weekdays (any day for a weekly habit), not a day off or paused. */
export function isHabitScheduled(habit: Habit, day: string): boolean {
  if (habit.props[habitOffKey(day)] || habitPausedOn(habit, day)) return false
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

/**
 * What a day is for a habit: done; partway to its goal; missed (asked, gone by, not done); off (a
 * weekday it does not repeat on, a day off, before it began, a weekly habit's days once its week
 * is full or over); not needed yet (today and what is to come, and any day of a weekly habit's
 * week under way); or paused. Whatever was logged shows as done or partial, on any day.
 * The one place the Tracker (phone and desktop), the habit's calendar and Today get this from.
 */
export type HabitDayState = 'done' | 'partial' | 'missed' | 'off' | 'later' | 'paused'

export function habitDayState(habit: Habit, day: string, today: string, since = habitSince(habit)): HabitDayState {
  if (isHabitDone(habit, day)) return 'done'
  if (habitProgress(habit, day) > 0) return 'partial'
  if (habitPausedOn(habit, day)) return 'paused'
  if (day < since || !isHabitDue(habit, day)) return 'off'
  if (habitWeeklyTarget(habit)) return addDays(mondayOf(day), 6) >= today ? 'later' : 'off'
  return day >= today ? 'later' : 'missed'
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

/** Done over expected as a whole percent; undefined when nothing was asked. */
export const habitPercent = (tally: Pick<HabitTally, 'done' | 'expected'> | undefined) => (tally?.expected ? Math.round((tally.done / tally.expected) * 100) : undefined)

/** What a weekly habit asks of a week: its times a week, or fewer when the week has too few days (paused, days off, not yet begun) to do them. */
function weekGoal(habit: Habit, monday: string, since: string, weekly: number): number {
  let available = 0
  for (let day = monday; day <= addDays(monday, 6); day = addDays(day, 1)) if (day >= since && isHabitScheduled(habit, day)) available++
  return Math.min(weekly, available)
}

/**
 * One Monday–Sunday week of a habit, up to `today`. Daily habit: each scheduled day expects one,
 * except today until it is done. Weekly habit (N a week): done counts at most N, and a week
 * expects only what can no longer be made up; the first part-week (began after Monday) never
 * counts against it. Paused days and days off expect nothing. Nothing before `since`.
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
  const goal = weekGoal(habit, monday, since, weekly)
  let done = 0
  let left = 0
  for (let day = monday; day <= sunday; day = addDays(day, 1)) {
    if (day < since || !isHabitScheduled(habit, day)) continue
    if (day > today) left++
    else if (isHabitDone(habit, day)) done++
    else if (day === today) left++
    if (day <= today) tally.amount += habitValue(habit, day)
  }
  tally.done = Math.min(done, goal)
  tally.expected = since > monday ? tally.done : tally.done + Math.max(0, goal - tally.done - left)
  return tally
}

const addTally = (sum: HabitTally, add: HabitTally) => {
  sum.expected += add.expected
  sum.done += add.done
  sum.amount += add.amount
}

/** The Mondays of the `weekCount` weeks ending with the one `today` is in, oldest first. */
function reportWeeks(weekCount: number, today: string): string[] {
  const count = Math.max(1, weekCount)
  return Array.from({ length: count }, (_, i) => addDays(mondayOf(today), -7 * (count - 1 - i)))
}

export interface HabitStats {
  /** Done in a row up to today (today not done yet does not break it): scheduled days, or weeks for a weekly habit. */
  current: number
  best: number
  /** What `current` and `best` count. */
  streakUnit: 'day' | 'week'
  total: number
  /** This week so far, done of what it asks: a weekly habit its times a week; a daily one the days expected up to now (today once done). Paused days are not asked. */
  thisWeek: { done: number; of: number }
  /** The last four weeks, this one included, as the Tracker and the Progress view count them (habitReport). */
  last4Weeks: HabitTally
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
    // Weeks that reached their times a week in a row; the week under way does not break it, nor
    // does a first part-week that fell short or a week with no day to do it on (paused).
    let run = 0
    for (let week = mondayOf(since); week <= monday; week = addDays(week, 7)) {
      const goal = weekGoal(habit, week, since, weekly)
      if (!goal) continue
      if (habitWeek(habit, week, today, since).done >= goal) best = Math.max(best, ++run)
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

  let windowScheduled = 0
  let windowAmount = 0
  for (let day = addDays(today, -29); day <= today; day = addDays(day, 1)) {
    if (day < since || !scheduled(day)) continue
    if (done.has(day) || day !== today) windowScheduled++
    windowAmount += habitValue(habit, day)
  }

  const week = habitWeek(habit, monday, today, since)
  const last4Weeks = emptyTally()
  for (const start of reportWeeks(4, today)) addTally(last4Weeks, habitWeek(habit, start, today, since))

  return {
    current,
    best,
    streakUnit: weekly ? 'week' : 'day',
    total: done.size,
    thisWeek: { done: week.done, of: weekly ? weekGoal(habit, monday, since, weekly) : week.expected },
    last4Weeks,
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
 * Per day from `from` to `to` (up to `today`), across habits: a daily habit counts on its
 * scheduled days since it began (not on paused days, and today only once done); a weekly habit
 * only on days it was done, since it asks for no day in particular. The share done is `done / due`.
 */
export function habitDayTotals(habits: Habit[], from: string, to: string, today: string): HabitDayTotal[] {
  const active = habits.map((habit) => ({ habit, since: habitSince(habit), weekly: habitWeeklyTarget(habit) }))
  const totals: HabitDayTotal[] = []
  for (let day = from; day <= to && day <= today; day = addDays(day, 1)) {
    const total = { day, done: 0, due: 0 }
    for (const { habit, since, weekly } of active) {
      if (day < since || habitPausedOn(habit, day)) continue
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
  /** All habits, over the whole range. */
  total: HabitTally
  /** Per week, in the order of `weeks`. */
  byWeek: HabitTally[]
  /** `paused`: paused today. */
  habits: { id: Id; total: HabitTally; byWeek: HabitTally[]; paused: boolean }[]
}

/** Progress of `habits` over the `weekCount` weeks ending with the one `today` is in. */
export function habitReport(habits: (Habit & { id: Id })[], weekCount: number, today: string): HabitReport {
  const weeks = reportWeeks(weekCount, today)
  const total = emptyTally()
  const byWeek = weeks.map(emptyTally)
  const rows = habits.map((habit) => {
    const since = habitSince(habit)
    const row = { id: habit.id, total: emptyTally(), byWeek: weeks.map((week) => habitWeek(habit, week, today, since)), paused: habitPausedOn(habit, today) }
    row.byWeek.forEach((tally, i) => {
      addTally(row.total, tally)
      addTally(byWeek[i]!, tally)
    })
    addTally(total, row.total)
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
