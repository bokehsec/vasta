import { describe, expect, it } from 'vitest'
import { createBuiltinTypes, builtinTypeId, type CalendarEntry, type FilterGroup, type ObjectSummary, type QueryContext } from '@vasta/core'
import { agendaDays, agendaLength, isPast, nowIndex, placeEntries, selectEntries, tidyAgenda } from './agenda.ts'

const at = '2026-11-12T12:00:00.000Z'
const task = builtinTypeId('s', 'task')
const page = builtinTypeId('s', 'page')
const summary = (id: string, typeId: string, title: string): ObjectSummary => ({ id, typeId, spaceId: 's', title, updatedAt: at, createdAt: at, tagIds: [], collectionIds: [], props: {}, preview: '' }) as unknown as ObjectSummary
const objects = new Map([['t1', summary('t1', task, 'Pay rent')], ['t2', summary('t2', task, 'Call Ana')], ['p1', summary('p1', page, 'Trip')]])
const context: QueryContext = { types: new Map(createBuiltinTypes('s', at).map((t) => [t.id, t])), today: '2026-11-12', timeZone: 'UTC' }

let n = 0
const entry = (patch: Partial<CalendarEntry>): CalendarEntry => ({ key: `e${++n}`, kind: 'property', field: 'due', start: '2026-11-12T00:00:00.000Z', allDay: true, startDay: '2026-11-12', endDay: '2026-11-12', ...patch })
const timed = (objectId: string, day: string, time: string, patch: Partial<CalendarEntry> = {}) =>
  entry({ objectId, allDay: false, start: `${day}T${time}:00.000Z`, startDay: day, endDay: day, ...patch })
const select = (entries: CalendarEntry[], over: Partial<Parameters<typeof selectEntries>[1]> = {}) =>
  selectEntries(entries, { settings: undefined, typeIds: [], filter: undefined, object: (id) => objects.get(id), context, ...over })

describe('the days of an agenda', () => {
  it('starts today and defaults to three days', () => {
    expect(agendaDays('2026-11-12', undefined)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14'])
    expect(agendaDays('2026-11-30', { days: 2 })).toEqual(['2026-11-30', '2026-12-01'])
  })

  it('keeps the length from 1 to 14 days', () => {
    expect(agendaLength({ days: 0 })).toBe(1)
    expect(agendaLength({ days: 99 })).toBe(14)
    expect(agendaLength({ days: 2.7 })).toBe(2)
    expect(agendaLength({ days: Number.NaN })).toBe(3)
    expect(agendaLength({})).toBe(3)
  })

  it('saves only what differs from the defaults', () => {
    expect(tidyAgenda({ days: 3, field: '', calendars: false })).toBeUndefined()
    expect(tidyAgenda({ calendars: [] })).toEqual({ calendars: [] })
    expect(tidyAgenda({ field: 'due', days: 5, calendars: ['c1'] })).toEqual({ field: 'due', days: 5, calendars: ['c1'] })
    expect(tidyAgenda({ calendars: true })).toEqual({ calendars: true })
  })
})

describe('which entries the agenda shows', () => {
  const rent = entry({ objectId: 't1' })
  const trip = entry({ objectId: 'p1', field: 'date', kind: 'object' })
  const note = entry({ objectId: 'p1', kind: 'daily-note', field: undefined })
  const meeting = entry({ kind: 'external', sourceId: 'c1', title: 'Standup', field: undefined })
  const dentist = entry({ kind: 'external', sourceId: 'c2', title: 'Dentist', field: undefined })

  it('never shows daily notes, and no calendars unless asked', () => {
    expect(select([rent, trip, note, meeting])).toEqual([rent, trip])
    expect(select([rent, meeting], { settings: { calendars: false } })).toEqual([rent])
  })

  it('shows all calendars, or the chosen ones', () => {
    expect(select([rent, meeting, dentist], { settings: { calendars: true } })).toEqual([rent, meeting, dentist])
    expect(select([meeting, dentist], { settings: { calendars: ['c2'] } })).toEqual([dentist])
  })

  it('keeps the objects of the query’s types; none chosen means all', () => {
    expect(select([rent, trip], { typeIds: [task] })).toEqual([rent])
    expect(select([rent, trip], { typeIds: [] })).toEqual([rent, trip])
  })

  it('applies the query’s filter to each object, not to a limited result list', () => {
    const filter: FilterGroup = { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'title', operator: 'contains', value: { kind: 'literal', value: 'rent' } }] }
    const other = entry({ objectId: 't2' })
    expect(select([rent, other, trip], { filter })).toEqual([rent])
  })

  it('keeps the chosen date field only', () => {
    const start = entry({ objectId: 't1', field: 'start' })
    expect(select([rent, start], { settings: { field: 'due' } })).toEqual([rent])
    expect(select([rent, trip], { settings: { field: 'date' } })).toEqual([trip])
    expect(select([rent, start])).toEqual([rent, start])
  })

  it('drops entries of objects it does not know', () => {
    expect(select([entry({ objectId: 'gone' })])).toEqual([])
  })
})

describe('placing entries on days', () => {
  const days = ['2026-11-12', '2026-11-13', '2026-11-14']

  it('puts all-day entries first apart from the timed ones, which go in time order', () => {
    const late = timed('t1', '2026-11-12', '18:30')
    const early = timed('t2', '2026-11-12', '07:00')
    const whole = entry({ objectId: 'p1' })
    const [today] = placeEntries([late, whole, early], days)
    expect(today!.allDay).toEqual([whole])
    expect(today!.timed).toEqual([early, late])
  })

  it('shows a multi-day entry on each day it covers within the range', () => {
    const trip = entry({ objectId: 'p1', startDay: '2026-11-10', endDay: '2026-11-13' })
    const placed = placeEntries([trip], days)
    expect(placed.map((d) => d.allDay.length)).toEqual([1, 1, 0])
  })

  it('leaves out entries outside the range, and leaves empty days empty', () => {
    const placed = placeEntries([entry({ objectId: 't1', startDay: '2026-11-20', endDay: '2026-11-20' }), entry({ objectId: 't1', startDay: '2026-11-01', endDay: '2026-11-11' })], days)
    expect(placed.every((d) => !d.allDay.length && !d.timed.length)).toBe(true)
    expect(placed.map((d) => d.day)).toEqual(days)
  })

  it('shows a timed entry that runs past midnight on both days, first on the second', () => {
    const night = timed('t1', '2026-11-12', '22:00', { end: '2026-11-13T01:00:00.000Z', endDay: '2026-11-13' })
    const morning = timed('t2', '2026-11-13', '08:00')
    const placed = placeEntries([morning, night], days)
    expect(placed[0]!.timed).toEqual([night])
    expect(placed[1]!.timed).toEqual([night, morning])
  })
})

describe('the line for now', () => {
  const a = timed('t1', '2026-11-12', '08:00', { end: '2026-11-12T09:00:00.000Z' })
  const b = timed('t2', '2026-11-12', '12:00')
  const c = timed('t1', '2026-11-12', '17:00')
  const now = (time: string) => Date.parse(`2026-11-12T${time}:00.000Z`)

  it('fades what is over: by its end, or by its start without one', () => {
    expect(isPast(a, now('09:01'))).toBe(true)
    expect(isPast(a, now('08:30'))).toBe(false)
    expect(isPast(b, now('12:01'))).toBe(true)
    expect(isPast(b, now('11:59'))).toBe(false)
  })

  it('goes before the first entry that begins after now', () => {
    expect(nowIndex([a, b, c], now('07:00'))).toBe(0)
    expect(nowIndex([a, b, c], now('08:30'))).toBe(1)
    expect(nowIndex([a, b, c], now('13:00'))).toBe(2)
    expect(nowIndex([a, b, c], now('20:00'))).toBe(3)
    expect(nowIndex([], now('20:00'))).toBe(0)
  })
})
