import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ObjectType } from '@vasta/core'

vi.mock('./api.ts', () => ({ authApi: { updateProfile: vi.fn(async () => ({})) }, NetworkError: class extends Error {} }))
import { flush, getPreference, startPreferences, stopPreferences } from './preferences.ts'
import { useHabitDisplay } from './habit-progress.ts'
import { authApi } from './api.ts'

const habits = (habitSettings?: ObjectType['habits']) => ({ id: 'habit', habits: habitSettings })

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
  })
  startPreferences({ id: 'a' })
})
afterEach(() => {
  stopPreferences()
  vi.unstubAllGlobals()
})

it('shows the type\'s settings until the person picks, then their own, without touching the type', async () => {
  const type = habits({ place: 'beside', chart: 'line', weeks: 8 })
  const { settings, save } = useHabitDisplay(() => type)
  expect(settings.value).toEqual({ place: 'beside', chart: 'line', weeks: 8 })
  save({ weeks: 13 })
  expect(settings.value).toEqual({ place: 'beside', chart: 'line', weeks: 13 })
  save({ chart: 'calendar' })
  expect(settings.value).toEqual({ place: 'beside', chart: 'calendar', weeks: 13 })
  expect(type.habits).toEqual({ place: 'beside', chart: 'line', weeks: 8 })
  // Kept as the account's preference only for the parts picked, so a changed starting value still flows through the rest.
  expect(getPreference('account', 'type/habit/habits')).toEqual({ weeks: 13, chart: 'calendar' })
  await flush()
  expect(authApi.updateProfile).toHaveBeenCalledWith({ preferences: { 'type/habit/habits': { weeks: 13, chart: 'calendar' } } })
})

it('is each person\'s own: another account sees the type\'s settings', async () => {
  const type = habits()
  const display = useHabitDisplay(() => type)
  display.save({ place: 'off' })
  expect(display.settings.value.place).toBe('off')
  await flush()
  stopPreferences()
  startPreferences({ id: 'b' })
  expect(display.settings.value.place).toBe('above')
})

it('reads settings from before there were two charts as the nearest of today\'s', () => {
  const display = useHabitDisplay(() => habits({ strip: 'days', place: 'above' } as unknown as ObjectType['habits']))
  expect(display.settings.value.chart).toBe('calendar')
})
