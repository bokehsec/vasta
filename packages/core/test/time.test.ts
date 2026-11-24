import { describe, expect, it } from 'vitest'
import { bucketDay, dayBucket } from '../src/index.ts'

describe('the day of a bucket', () => {
  // Wednesday 11 Nov 2026; weeks start on Sunday the 8th or Monday the 9th.
  const day = (bucket: Parameters<typeof bucketDay>[0], weekStart: string, today = '2026-11-11', weekend?: number[]) => bucketDay(bucket, today, weekStart, weekend)

  it('is today, tomorrow, the first day left in the week, then the first working day of the next weeks', () => {
    expect(day('today', '2026-11-08')).toBe('2026-11-11')
    expect(day('tomorrow', '2026-11-08')).toBe('2026-11-12')
    expect(day('this-week', '2026-11-08')).toBe('2026-11-13')
    expect(day('next-week', '2026-11-08')).toBe('2026-11-16')
    expect(day('later', '2026-11-08')).toBe('2026-11-23')
  })

  it('follows the week start', () => {
    expect(day('next-week', '2026-11-09')).toBe('2026-11-16')
    expect(day('later', '2026-11-09')).toBe('2026-11-23')
    expect(day('this-week', '2026-11-09')).toBe('2026-11-13')
  })

  it('skips the locale\'s weekend, whichever days it is', () => {
    // Friday and Saturday off, Sunday-start weeks: Sunday is a working day.
    expect(day('next-week', '2026-11-08', '2026-11-11', [5, 6])).toBe('2026-11-15')
    // Friday and Saturday off, Monday-start weeks.
    expect(day('later', '2026-11-09', '2026-11-11', [5, 6])).toBe('2026-11-23')
    // Everything off: the start of the week.
    expect(day('next-week', '2026-11-08', '2026-11-11', [0, 1, 2, 3, 4, 5, 6])).toBe('2026-11-15')
  })

  it('has no this-week day when the week runs out', () => {
    // Saturday 14th: Sunday-start weeks end today; Monday-start weeks end on Sunday 15th.
    expect(day('this-week', '2026-11-08', '2026-11-14')).toBeUndefined()
    expect(day('this-week', '2026-11-09', '2026-11-14')).toBeUndefined()
    // Friday 13th, Sunday-start: the day after tomorrow is already next week.
    expect(day('this-week', '2026-11-08', '2026-11-13')).toBeUndefined()
    // Thursday 12th, Sunday-start: Saturday is the one day left.
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
