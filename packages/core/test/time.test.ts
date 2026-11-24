import { describe, expect, it } from 'vitest'
import { bucketDay, dayBucket, dayOfDate, moveDateToDay } from '../src/index.ts'

describe('the day of a bucket', () => {
  // Wednesday 11 Nov 2026.
  const day = (bucket: Parameters<typeof bucketDay>[0], weekStart: string, today = '2026-11-11') => bucketDay(bucket, today, weekStart)

  it('is today, tomorrow, the first day left in the week, then the start of the next weeks', () => {
    expect(day('today', '2026-11-08')).toBe('2026-11-11')
    expect(day('tomorrow', '2026-11-08')).toBe('2026-11-12')
    expect(day('this-week', '2026-11-08')).toBe('2026-11-13')
    expect(day('next-week', '2026-11-08')).toBe('2026-11-15')
    expect(day('later', '2026-11-08')).toBe('2026-11-22')
  })

  it('follows the week start', () => {
    expect(day('next-week', '2026-11-09')).toBe('2026-11-16')
    expect(day('later', '2026-11-09')).toBe('2026-11-23')
    expect(day('this-week', '2026-11-09')).toBe('2026-11-13')
  })

  it('has no this-week day when tomorrow is the week\'s last day or the next one starts', () => {
    // Saturday 14th: Sunday-start weeks end today; Monday-start weeks end on Sunday 15th.
    expect(day('this-week', '2026-11-08', '2026-11-14')).toBeUndefined()
    expect(day('this-week', '2026-11-09', '2026-11-14')).toBeUndefined()
    // Sunday 15th, Monday-start week 9-15.
    expect(day('this-week', '2026-11-09', '2026-11-15')).toBeUndefined()
    // Friday 13th, Sunday-start: Saturday is the one day left.
    expect(day('this-week', '2026-11-08', '2026-11-12')).toBe('2026-11-14')
  })

  it('has none for Earlier', () => {
    expect(day('past', '2026-11-08')).toBeUndefined()
  })
})

describe('day buckets', () => {
  it('places dates in a Sunday-start week', () => {
    const bucket = (day: string) => dayBucket(day, '2026-11-11', '2026-11-08')
    expect(bucket('2026-11-10')).toBe('past')
    expect(bucket('2026-11-11')).toBe('today')
    expect(bucket('2026-11-12')).toBe('tomorrow')
    expect(bucket('2026-11-13')).toBe('this-week')
    expect(bucket('2026-11-14')).toBe('this-week')
    expect(bucket('2026-11-15')).toBe('next-week')
    expect(bucket('2026-11-21')).toBe('next-week')
    expect(bucket('2026-11-22')).toBe('later')
  })

  it('places dates in a Monday-start week', () => {
    const bucket = (day: string) => dayBucket(day, '2026-11-11', '2026-11-09')
    expect(bucket('2026-11-15')).toBe('this-week')
    expect(bucket('2026-11-16')).toBe('next-week')
    expect(bucket('2026-11-22')).toBe('next-week')
    expect(bucket('2026-11-23')).toBe('later')
  })

  it('calls the next day tomorrow even when it starts a new week', () => {
    expect(dayBucket('2026-11-15', '2026-11-14', '2026-11-08')).toBe('tomorrow')
    expect(dayBucket('2026-11-16', '2026-11-14', '2026-11-08')).toBe('next-week')
    expect(dayBucket('2026-11-16', '2026-11-15', '2026-11-09')).toBe('tomorrow')
    expect(dayBucket('2026-11-17', '2026-11-15', '2026-11-09')).toBe('next-week')
  })

  it('keeps the week across a year boundary', () => {
    expect(dayBucket('2027-01-02', '2026-12-30', '2026-12-27')).toBe('this-week')
    expect(dayBucket('2027-01-03', '2026-12-30', '2026-12-27')).toBe('next-week')
    expect(dayBucket('2027-01-03', '2026-12-30', '2026-12-28')).toBe('this-week')
    expect(dayBucket('2027-01-04', '2026-12-30', '2026-12-28')).toBe('next-week')
  })

  it('groups the far past and future', () => {
    expect(dayBucket('1900-01-01', '2026-11-11', '2026-11-08')).toBe('past')
    expect(dayBucket('2100-01-01', '2026-11-11', '2026-11-08')).toBe('later')
  })
})

describe('which day a date is on, and moving it to another', () => {
  const TORONTO = 'America/Toronto'
  it('a day value is on its own day; a timed one on the day in the zone', () => {
    expect(dayOfDate({ start: '2026-11-03T00:00:00.000Z', resolution: 'day' }, TORONTO)).toBe('2026-11-03')
    expect(dayOfDate({ start: '2026-11-03T03:30:00.000Z', resolution: 'time' }, TORONTO)).toBe('2026-11-02')
    expect(dayOfDate({ start: '2026-11-03T03:30:00.000Z', resolution: 'time' }, 'UTC')).toBe('2026-11-03')
  })

  it('moves a day value, its end along, and keeps what else it holds', () => {
    expect(moveDateToDay({ start: '2026-11-03T00:00:00.000Z', end: '2026-11-05T00:00:00.000Z', resolution: 'day', rrule: 'FREQ=WEEKLY' }, { day: '2026-11-10' }, TORONTO)).toEqual({ start: '2026-11-10T00:00:00.000Z', end: '2026-11-12T00:00:00.000Z', resolution: 'day', rrule: 'FREQ=WEEKLY' })
  })

  it('keeps the wall-clock time across the clock change on 1 Nov (9:00 stays 9:00)', () => {
    const nine = { start: '2026-10-30T13:00:00.000Z', resolution: 'time' as const }
    expect(moveDateToDay(nine, { day: '2026-11-03' }, TORONTO).start).toBe('2026-11-03T14:00:00.000Z')
    // And back again, and over the spring change.
    expect(moveDateToDay({ start: '2026-11-03T14:00:00.000Z', resolution: 'time' }, { day: '2026-10-30' }, TORONTO).start).toBe('2026-10-30T13:00:00.000Z')
    expect(moveDateToDay({ start: '2026-03-06T14:00:00.000Z', resolution: 'time' }, { day: '2026-03-10' }, TORONTO).start).toBe('2026-03-10T13:00:00.000Z')
  })

  it('keeps a timed span\'s length, and can start at a time of day instead', () => {
    const span = { start: '2026-10-30T13:00:00.000Z', end: '2026-10-30T14:30:00.000Z', resolution: 'time' as const }
    expect(moveDateToDay(span, { day: '2026-11-03' }, TORONTO)).toEqual({ start: '2026-11-03T14:00:00.000Z', end: '2026-11-03T15:30:00.000Z', resolution: 'time' })
    expect(moveDateToDay(span, { day: '2026-11-03', minutes: 600 }, TORONTO).start).toBe('2026-11-03T15:00:00.000Z')
  })
})
