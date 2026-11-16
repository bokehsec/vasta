import { describe, expect, it } from 'vitest'
import { habitDays, habitDayValue, habitProgress, habitSince, habitStats, habitValue, isHabitDone } from '../src/habits.ts'
import { habitFoodRule, withFood } from '../src/nutrition.ts'
import type { PropertyValue } from '../src/model.ts'

const day = '2026-11-16'
const habit = (props: Record<string, PropertyValue>) => ({ createdAt: `${day}T12:00:00Z`, props })
describe('SparkyFitness habit values', () => {
  it('keeps SparkyFitness habits checkable when a food rule is also selected', () => {
    const h = habit({ sparkyfitness: { kind: 'select', value: ['water'] }, food: { kind: 'select', value: ['logged'] } })
    expect(habitFoodRule(h)).toBeUndefined()
    expect(withFood(h, [])).toBe(h)
  })
  it('falls back to fetched values across days, stats and the start date', () => {
    const h = habit({ 'sf:2026-11-15': { kind: 'checkbox', value: true } })
    expect(habitDays(h)).toEqual(['2026-11-15'])
    expect(habitSince(h)).toBe('2026-11-15')
    expect(habitStats(h, day).total).toBe(1)
  })
  it('keeps hand amounts and partial progress ahead of fetched amounts', () => {
    const h = habit({ target: { kind: 'number', value: 8 }, [`sf:${day}`]: { kind: 'number', value: 8 }, [`done:${day}`]: { kind: 'number', value: 3 } })
    expect(habitValue(h, day)).toBe(3)
    expect(habitProgress(h, day)).toBe(3 / 8)
    expect(isHabitDone(h, day)).toBe(false)
  })
  it.each([{ kind: 'number', value: 0 }, { kind: 'checkbox', value: false }] as PropertyValue[])('keeps explicit cleared hand values', (cleared) => {
    const h = habit({ [`sf:${day}`]: { kind: 'checkbox', value: true }, [`done:${day}`]: cleared })
    expect(habitValue(h, day)).toBe(0)
    expect(habitDays(h)).toEqual([])
  })
  it('clears linked habits explicitly, including after unlinking', () => {
    expect(habitDayValue(habit({ sparkyfitness: { kind: 'select', value: ['steps'] }, target: { kind: 'number', value: 8000 } }), 0)).toEqual({ kind: 'number', value: 0 })
    expect(habitDayValue(habit({ [`sf:${day}`]: { kind: 'checkbox', value: true } }), 0)).toEqual({ kind: 'checkbox', value: false })
    expect(habitDayValue(habit({}), 0)).toBeUndefined()
  })
})
