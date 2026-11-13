import { describe, expect, it } from 'vitest'
import type { DateValue } from '@vasta/core'
import { formatDateShort } from './format.ts'

const now = new Date(2026, 10, 12, 12, 0) // Thu Nov 12, 2026, local
/** A time on a local day, as the replica stores it. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
const day = (iso: string, end?: string): DateValue => ({ start: `${iso}T00:00:00.000Z`, ...(end ? { end: `${end}T00:00:00.000Z` } : {}), resolution: 'day' })
const time = (start: string, end?: string): DateValue => ({ start, ...(end ? { end } : {}), resolution: 'time' })
const short = (value: DateValue, loc = 'en-US') => formatDateShort(value, now, loc)

describe('a date on a list row', () => {
  it('drops the year from this year\'s dates and says the weekday', () => {
    expect(short(day('2026-11-17'))).toBe('Tue Nov 17')
    expect(short(day('2026-01-01'))).toBe('Thu Jan 1')
    expect(short(day('2026-12-31'))).toBe('Thu Dec 31')
  })

  it('adds the time when the value has one', () => {
    expect(short(time(at(2026, 11, 17, 9, 0)))).toBe('Tue Nov 17, 9:00 AM')
    expect(short(time(at(2026, 11, 17, 15, 30)))).toBe('Tue Nov 17, 3:30 PM')
  })

  it('keeps the usual form for other years', () => {
    expect(short(day('2025-11-17'))).toBe('Nov 17, 2025')
    expect(short(day('2027-01-02'))).toBe('Jan 2, 2027')
    expect(short(time(at(2025, 11, 17, 9, 0)))).toMatch(/^Nov 17, 2025/)
  })

  it('shows a range with its own days, and a time range of one day with the clock only', () => {
    expect(short(day('2026-11-17', '2026-11-19'))).toBe('Tue Nov 17 – Thu Nov 19')
    expect(short(time(at(2026, 11, 17, 9, 0), at(2026, 11, 17, 10, 30)))).toBe('Tue Nov 17, 9:00 AM – 10:30 AM')
    expect(short(time(at(2026, 11, 17, 22, 0), at(2026, 11, 18, 1, 0)))).toBe('Tue Nov 17, 10:00 PM – Wed Nov 18, 1:00 AM')
  })

  it('keeps the usual form for a range that leaves the year', () => {
    expect(short(day('2026-12-30', '2027-01-02'))).not.toMatch(/^Wed/)
  })

  it('follows the locale', () => {
    expect(short(day('2026-11-17'), 'pt-BR')).toMatch(/^ter\.? 17 de nov/i)
  })
})
