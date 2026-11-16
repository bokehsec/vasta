import { describe, expect, it } from 'vitest'
import { NodeStore } from '../src/store-node.ts'
import { builtinTypeId, createBuiltinTypes, ensureBuiltinTypes } from '../src/index.ts'
import { DONE_VALUE, HABIT_PROGRESS_DEFAULT, habitDayState, habitDoneKey, habitPauseKey, habitPauses, habitPausedOn, habitProgress, habitProgressSettings, habitRemindAt, habitDayTotals, habitReport, habitStats, habitTap, habitWeekPlan, habitValue, habitWeek, habitWeeklyTarget, isHabitDone, isHabitDue, isHabitProgressSettings, isHabitScheduled, pauseHabit, resumeHabit, type PropertyValue } from '../src/index.ts'

const habit = (days: string[], props: Record<string, PropertyValue> = {}) => ({
  createdAt: '2026-10-01T12:00:00.000Z',
  props: { ...props, ...Object.fromEntries(days.map((d) => [habitDoneKey(d), DONE_VALUE])) },
})

describe('habit stats', () => {
  it('counts the current and best streaks; today not done yet does not break one', () => {
    const h = habit(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-08', '2026-10-09'])
    expect(habitStats(h, '2026-10-10')).toMatchObject({ current: 2, best: 3, total: 5 })
    expect(habitStats(h, '2026-10-11').current).toBe(0)
  })

  it('skips the days it does not repeat on', () => {
    // Mondays, Wednesdays and Fridays: Mon 5, Wed 7, Fri 9 in a row.
    const days: PropertyValue = { kind: 'select', value: ['mon', 'wed', 'fri'] }
    const h = habit(['2026-10-05', '2026-10-07', '2026-10-09'], { days })
    expect(isHabitScheduled(h, '2026-10-06')).toBe(false)
    expect(habitStats(h, '2026-10-11')).toMatchObject({ current: 3, best: 3 })
  })

  it('rates the last four weeks as the report does, from when the habit began', () => {
    const h = habit(['2026-10-01', '2026-10-02', '2026-10-04'])
    // 1–4 October scheduled, today (the 5th) not done yet: 3 of 4.
    const { last4Weeks } = habitStats(h, '2026-10-05')
    expect([last4Weeks.done, last4Weeks.expected]).toEqual([3, 4])
    expect(last4Weeks).toEqual(habitReport([{ id: 'h', ...h }], 4, '2026-10-05').habits[0]!.total)
  })

  it('counts this week so far, not the days still to come', () => {
    // Monday 5 October done, Tuesday missed, Wednesday (today) not yet.
    expect(habitStats(habit(['2026-10-05']), '2026-10-07').thisWeek).toEqual({ done: 1, of: 2 })
  })
})

describe('habits with a daily goal', () => {
  const target: PropertyValue = { kind: 'number', value: 8 }
  const amount = (value: number): PropertyValue => ({ kind: 'number', value })
  const h = {
    createdAt: '2026-10-01T12:00:00.000Z',
    props: { target, [habitDoneKey('2026-10-01')]: amount(8), [habitDoneKey('2026-10-02')]: amount(5), [habitDoneKey('2026-10-03')]: amount(9), [habitDoneKey('2026-10-04')]: DONE_VALUE },
  }

  it('is done on a day once the amount reaches the goal', () => {
    expect(isHabitDone(h, '2026-10-01')).toBe(true)
    expect(isHabitDone(h, '2026-10-02')).toBe(false)
    expect(habitProgress(h, '2026-10-02')).toBe(5 / 8)
    // A plain check from before the goal was set counts as reaching it.
    expect(habitValue(h, '2026-10-04')).toBe(8)
    expect(habitStats(h, '2026-10-04')).toMatchObject({ current: 2, best: 2, total: 3 })
    expect(habitStats(h, '2026-10-04').average30).toBe(30 / 4)
  })

  it('reads reminder times loosely', () => {
    const at = (value: string) => habitRemindAt({ createdAt: '', props: { remind: { kind: 'text', value } } })
    expect([at('8'), at('8h'), at('08:30'), at('7h05'), at('25:00'), at('soon')]).toEqual(['08:00', '08:00', '08:30', '07:05', undefined, undefined])
  })
})

describe('habit type migration', () => {
  it('gives an older Habit type the goal, unit and reminder once', () => {
    const at = '2026-10-20T12:00:00.000Z'
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) {
      // The Habit type as it shipped first.
      if (type.system === 'habit') type.properties = type.properties.filter((p) => ['days', 'paused', 'body'].includes(p.id))
      store.putType(type)
    }
    ensureBuiltinTypes(store, at)
    const names = () => store.getType(builtinTypeId('s', 'habit'))!.properties.map((p) => p.name)
    expect(names()).toEqual(['Repeat on', 'Times a week', 'Daily goal', 'Unit', 'Remind at', 'Notes'])
    // Deleted by the user: it stays deleted.
    const type = store.getType(builtinTypeId('s', 'habit'))!
    store.putType({ ...type, properties: type.properties.filter((p) => p.id !== 'unit') })
    ensureBuiltinTypes(store, at)
    expect(names()).not.toContain('Unit')
  })

  it('keeps a Times a week field a space already made by hand', () => {
    const at = '2026-11-15T12:00:00.000Z'
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) {
      if (type.system === 'habit') type.properties = type.properties.map((p) => (p.id === 'perweek' ? { ...p, name: 'Per week' } : p))
      store.putType(type)
    }
    ensureBuiltinTypes(store, at)
    const props = store.getType(builtinTypeId('s', 'habit'))!.properties
    expect(props.filter((p) => p.id === 'perweek').map((p) => p.name)).toEqual(['Per week'])
  })
})

describe('habits counted by the week', () => {
  const perweek = (value: number): PropertyValue => ({ kind: 'number', value })
  // Weeks of 2026: Mon 5 Oct, Mon 12 Oct, Mon 19 Oct. Made on Thu 1 Oct, so the week of 28 Sep is its first part-week.
  const weekly = (days: string[], n = 3, extra: Record<string, PropertyValue> = {}) => habit(days, { perweek: perweek(n), ...extra })
  const week = (h: ReturnType<typeof habit>, today: string, monday = '2026-10-05') => {
    const { done, expected } = habitWeek(h, monday, today, '2026-10-01')
    return { done, expected }
  }

  it('scores a finished week: misses count, extras are capped', () => {
    expect(week(weekly(['2026-10-05', '2026-10-07']), '2026-10-12')).toEqual({ done: 2, expected: 3 })
    expect(week(weekly(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']), '2026-10-12')).toEqual({ done: 3, expected: 3 })
  })

  it('expects only what can no longer be made up in the week under way', () => {
    // Wednesday, none done: five days left for three.
    expect(week(weekly([]), '2026-10-07')).toEqual({ done: 0, expected: 0 })
    // Saturday, one done, today not yet: two days left for two.
    expect(week(weekly(['2026-10-06']), '2026-10-10')).toEqual({ done: 1, expected: 1 })
    // Sunday, one done, today not yet: one more is possible, one is lost.
    expect(week(weekly(['2026-10-06']), '2026-10-11')).toEqual({ done: 1, expected: 2 })
  })

  it('never counts a first part-week against it', () => {
    const h = weekly(['2026-10-02'])
    const { done, expected } = habitWeek(h, '2026-09-28', '2026-10-12', '2026-10-01')
    expect({ done, expected }).toEqual({ done: 1, expected: 1 })
  })

  it('treats more than 7 as 7 and ignores less than 1', () => {
    expect(habitWeeklyTarget(weekly([], 12))).toBe(7)
    expect(habitWeeklyTarget(weekly([], 0))).toBeUndefined()
    expect(habitWeeklyTarget(habit([]))).toBeUndefined()
  })

  it('counts streaks in weeks; the week under way does not break one', () => {
    // Weeks of 5 and 12 Oct full, 19 Oct has one so far (Wednesday the 21st).
    const h = weekly(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19'])
    expect(habitStats(h, '2026-10-21')).toMatchObject({ current: 2, best: 2, streakUnit: 'week', thisWeek: { done: 1, of: 3 }, weekly: 3 })
    // The next Monday: the week of the 19th fell short.
    expect(habitStats(h, '2026-10-26')).toMatchObject({ current: 0, best: 2 })
  })

  it('is due until its week is full, on any weekday', () => {
    const h = weekly(['2026-10-05', '2026-10-06'], 2, { days: { kind: 'select', value: ['mon'] } })
    expect(isHabitScheduled(h, '2026-10-07')).toBe(true)
    expect(isHabitDue(h, '2026-10-07')).toBe(false)
    expect(isHabitDue(h, '2026-10-06')).toBe(true)
    expect(isHabitDue(h, '2026-10-12')).toBe(true)
  })

  it('counts a day only when its daily goal is reached', () => {
    const h = weekly([], 2, { target: perweek(8), [habitDoneKey('2026-10-05')]: perweek(8), [habitDoneKey('2026-10-06')]: perweek(3) })
    expect(week(h, '2026-10-12')).toEqual({ done: 1, expected: 2 })
  })

  it('leaves a daily habit\'s stats as they were', () => {
    const h = habit(['2026-10-01', '2026-10-02', '2026-10-04'])
    expect(habitStats(h, '2026-10-05')).toMatchObject({ streakUnit: 'day', current: 1, best: 2 })
    expect(habitStats(h, '2026-10-05').weekly).toBeUndefined()
  })
})

describe('habit report', () => {
  it('adds up daily and weekly habits by week; days paused count as days off', () => {
    const daily = { id: 'd', ...habit(['2026-10-05', '2026-10-06', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']) }
    const weekly = { id: 'w', ...habit(['2026-10-05', '2026-10-12', '2026-10-13', '2026-10-14'], { perweek: { kind: 'number', value: 3 } }) }
    const paused = { id: 'p', ...habit([], { [habitPauseKey('2026-10-01')]: { kind: 'text', value: '' } }) }
    // Tuesday 20 October, today not done yet.
    const report = habitReport([daily, weekly, paused], 3, '2026-10-20')
    expect(report.weeks).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    const counts = (t: { done: number; expected: number }) => [t.done, t.expected]
    // Daily: 2/7, 7/7, 1/1 (Monday done, today not yet). Weekly: 1/3, 3/3, 0/0 (six days left).
    expect(report.habits[0]!.byWeek.map(counts)).toEqual([[2, 7], [7, 7], [1, 1]])
    expect(report.habits[1]!.byWeek.map(counts)).toEqual([[1, 3], [3, 3], [0, 0]])
    expect(report.byWeek.map(counts)).toEqual([[3, 10], [10, 10], [1, 1]])
    expect(counts(report.total)).toEqual([14, 21])
    expect(report.habits[2]!.paused).toBe(true)
    expect(report.habits[2]!.total).toEqual({ done: 0, expected: 0, amount: 0 })
  })
})

describe('habit day totals and week plans', () => {
  it('counts daily habits on their days and weekly ones only when done', () => {
    const daily = habit(['2026-10-05'])
    const weekly = habit(['2026-10-06'], { perweek: { kind: 'number', value: 3 } })
    const paused = habit(['2026-10-05'], { [habitPauseKey('2026-10-05')]: { kind: 'text', value: '' } })
    const totals = habitDayTotals([daily, weekly, paused], '2026-10-05', '2026-10-08', '2026-10-07')
    expect(totals.map((t) => [t.day, t.done, t.due])).toEqual([
      ['2026-10-05', 1, 1],
      ['2026-10-06', 1, 2],
      // Today, not done yet: not counted.
      ['2026-10-07', 0, 0],
    ])
  })

  it('plans a whole week: scheduled days, or times a week', () => {
    expect(habitWeekPlan(habit([]), '2026-10-05')).toBe(7)
    expect(habitWeekPlan(habit([], { days: { kind: 'select', value: ['mon', 'fri'] } }), '2026-10-05')).toBe(2)
    expect(habitWeekPlan(habit([], { perweek: { kind: 'number', value: 3 } }), '2026-10-05')).toBe(3)
  })
})

describe('habit pauses', () => {
  const pause = (from: string, to = ''): Record<string, PropertyValue> => ({ [habitPauseKey(from)]: { kind: 'text', value: to } })

  it('reads periods, open while no last day is set', () => {
    const h = habit([], { ...pause('2026-10-05', '2026-10-07'), ...pause('2026-10-20') })
    expect(habitPauses(h)).toEqual([{ from: '2026-10-05', to: '2026-10-07' }, { from: '2026-10-20' }])
    expect([habitPausedOn(h, '2026-10-04'), habitPausedOn(h, '2026-10-06'), habitPausedOn(h, '2026-10-08'), habitPausedOn(h, '2026-12-01')]).toEqual([false, true, false, true])
  })

  it('makes paused days days off: not expected, no streak broken, no week missed', () => {
    // Done Mon–Wed and Sunday, paused Thu–Sat: the streak survives the pause.
    const h = habit(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-11'], pause('2026-10-08', '2026-10-10'))
    expect(isHabitScheduled(h, '2026-10-09')).toBe(false)
    expect(habitStats(h, '2026-10-11')).toMatchObject({ current: 4, best: 4 })
    expect(habitWeek(h, '2026-10-05', '2026-10-11', '2026-10-01')).toMatchObject({ done: 4, expected: 4 })
  })

  it('does not ask a weekly habit for what a paused week cannot hold', () => {
    const h = habit([], { perweek: { kind: 'number', value: 3 }, ...pause('2026-10-12', '2026-10-18') })
    expect(habitWeek(h, '2026-10-12', '2026-10-25', '2026-10-01')).toMatchObject({ done: 0, expected: 0 })
  })

  it('pauses from today and resumes the day after the last paused one', () => {
    let h = habit([])
    h = { ...h, props: { ...h.props, ...(pauseHabit(h, '2026-10-10') as Record<string, PropertyValue>) } }
    expect(habitPauses(h)).toEqual([{ from: '2026-10-10' }])
    expect(pauseHabit(h, '2026-10-12')).toEqual({})
    expect(resumeHabit(h, '2026-10-14')).toEqual({ [habitPauseKey('2026-10-10')]: { kind: 'text', value: '2026-10-13' } })
    // One that began today never was.
    expect(resumeHabit(h, '2026-10-10')).toEqual({ [habitPauseKey('2026-10-10')]: undefined })
  })
})

describe('habit day state', () => {
  const today = '2026-10-14'
  const state = (h: ReturnType<typeof habit>, day: string) => habitDayState(h, day, today)

  it('says done, partial, missed, off, not needed yet and paused', () => {
    const h = habit(['2026-10-07'], {
      target: { kind: 'number', value: 8 },
      [habitDoneKey('2026-10-08')]: { kind: 'number', value: 3 },
      days: { kind: 'select', value: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      [habitPauseKey('2026-10-12')]: { kind: 'text', value: '2026-10-12' },
      [habitDoneKey('2026-10-07')]: { kind: 'number', value: 8 },
    })
    expect(state(h, '2026-10-07')).toBe('done')
    expect(state(h, '2026-10-08')).toBe('partial')
    expect(state(h, '2026-10-09')).toBe('missed')
    expect(state(h, '2026-10-10')).toBe('off')
    expect(state(h, '2026-10-12')).toBe('paused')
    expect(state(h, today)).toBe('later')
    expect(state(h, '2026-10-16')).toBe('later')
    expect(state(h, '2026-09-20')).toBe('off')
  })

  it('never calls a day of a "3 a week" habit missed', () => {
    const h = habit([], { perweek: { kind: 'number', value: 3 } })
    expect(state(h, '2026-10-12')).toBe('later')
    expect(state(h, '2026-10-05')).toBe('off')
    const full = habit(['2026-10-12', '2026-10-13', '2026-10-14'], { perweek: { kind: 'number', value: 3 } })
    expect(state(full, '2026-10-15')).toBe('off')
  })
})

describe('what a tap does', () => {
  const day = '2026-10-14'
  const linked: Record<string, PropertyValue> = { sparkyfitness: { kind: 'select', value: ['steps'] }, target: { kind: 'number', value: 8000 }, [`sf:${day}`]: { kind: 'number', value: 4200 } }

  it('toggles a plain habit and steps a goal one', () => {
    expect(habitTap(habit([]), day)).toEqual({ amount: 1 })
    expect(habitTap(habit([day]), day)).toEqual({ amount: 0 })
    const goal = habit([], { target: { kind: 'number', value: 3 }, [habitDoneKey(day)]: { kind: 'number', value: 2 } })
    expect(habitTap(goal, day)).toEqual({ amount: 3 })
    expect(habitTap({ ...goal, props: { ...goal.props, [habitDoneKey(day)]: { kind: 'number', value: 3 } } }, day)).toEqual({ amount: 0 })
  })

  it('always asks on a habit linked to SparkyFitness, so a tap never freezes its value', () => {
    expect(habitTap(habit([], linked), day)).toBe('ask')
    expect(habitTap(habit([day], linked), day)).toBe('ask')
  })
})

describe('progress settings', () => {
  it('reads old chart ids as the nearest of the two, and fills what is missing', () => {
    expect(habitProgressSettings(undefined)).toEqual(HABIT_PROGRESS_DEFAULT)
    expect(habitProgressSettings({ place: 'above', strip: 'days', panel: 'counts', report: 'weeks', weeks: 8 })).toEqual({ place: 'above', chart: 'calendar', weeks: 8 })
    expect(habitProgressSettings({ place: 'beside', strip: 'days', panel: 'counts', weeks: 13 })).toEqual({ place: 'beside', chart: 'line', weeks: 13 })
    expect(habitProgressSettings({ place: 'off', report: 'calendar' })).toEqual({ place: 'off', chart: 'calendar', weeks: 4 })
    expect(habitProgressSettings({ chart: 'line', strip: 'days' }).chart).toBe('line')
    expect(habitProgressSettings({ chart: 'bars', weeks: 5, place: 'x' })).toEqual(HABIT_PROGRESS_DEFAULT)
  })

  it('accepts what is stored today and what was stored before', () => {
    expect(isHabitProgressSettings({ place: 'above', chart: 'line', weeks: 4 })).toBe(true)
    expect(isHabitProgressSettings({ place: 'above', strip: 'meters', panel: 'counts', report: 'weeks', weeks: 13 })).toBe(true)
    expect(isHabitProgressSettings({ chart: 'meters' })).toBe(false)
    expect(isHabitProgressSettings({ other: 1 })).toBe(false)
  })
})

describe('pause migration', () => {
  it('turns the Paused checkbox into a pause from that day, once', () => {
    const at = '2026-11-16T12:00:00.000Z'
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) {
      if (type.system === 'habit') type.properties = [{ id: 'paused', kind: 'checkbox', name: 'Paused' }, ...type.properties]
      store.putType(type)
    }
    const type = store.getType(builtinTypeId('s', 'habit'))!
    const make = (id: string, paused: boolean) => store.putObject({ id, spaceId: 's', typeId: type.id, title: id, aliases: [], tagIds: [], collectionIds: [], props: { paused: { kind: 'checkbox', value: paused } }, content: {}, createdAt: at, updatedAt: at })
    make('p', true)
    make('q', false)
    ensureBuiltinTypes(store, at)
    expect(store.getObject('p')!.props).toEqual({ 'pause:2026-11-16': { kind: 'text', value: '' } })
    expect(store.getObject('q')!.props).toEqual({})
    expect(store.getType(type.id)!.properties.some((p) => p.id === 'paused')).toBe(false)
  })
})
