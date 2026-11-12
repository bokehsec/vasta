import { describe, expect, it } from 'vitest'
import { dayBucket } from '../src/index.ts'

describe('day buckets', () => {
  // Wednesday 2026-11-11, in a week that starts on Sunday the 8th.
  const bucket = (day: string) => dayBucket(day, '2026-11-11', '2026-11-08')

  it('places a day from today’s point of view', () => {
    expect(bucket('2026-11-10')).toBe('past')
    expect(bucket('2025-01-01')).toBe('past')
    expect(bucket('2026-11-11')).toBe('today')
    expect(bucket('2026-11-12')).toBe('tomorrow')
    expect(bucket('2026-11-13')).toBe('this-week')
    expect(bucket('2026-11-14')).toBe('this-week')
    expect(bucket('2026-11-15')).toBe('next-week')
    expect(bucket('2026-11-21')).toBe('next-week')
    expect(bucket('2026-11-22')).toBe('later')
  })

  it('calls the first day of next week tomorrow on the last day of this one', () => {
    expect(dayBucket('2026-11-15', '2026-11-14', '2026-11-08')).toBe('tomorrow')
    expect(dayBucket('2026-11-16', '2026-11-14', '2026-11-08')).toBe('next-week')
  })
})
