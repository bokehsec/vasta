import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinTypes, type DateValue, type ObjectSummary, type ObjectType } from '@vasta/core'
import { api } from './api.ts'
import { addDays } from '@vasta/core'
import { startOfWeek } from './calendar.ts'
import { acceptsGroup, dropDay, groupObjects, groupOptions, movableField, moveToGroup, NO_VALUE, placeInGroup } from './query.ts'
import { typesById, workspace } from './state.ts'

vi.mock('./api.ts', () => ({ api: { object: vi.fn(), saveObject: vi.fn() } }))
vi.mock('./actions.ts', () => ({ dayKey: () => '2026-11-11' }))
vi.mock('./overlays.ts', () => ({ choiceDialog: vi.fn() }))
vi.mock('./people.ts', () => ({ meId: { value: '' }, personName: (id: string) => id, sharedSpace: { value: false } }))
vi.mock('./sprints.ts', () => ({ current: { value: undefined } }))
vi.mock('./state.ts', () => ({ workspace: { types: [] }, typesById: { value: new Map() }, primeFromObject: vi.fn(), summaryOf: vi.fn() }))

const at = '2026-11-11T12:00:00.000Z'
const task = createBuiltinTypes('s', at).find((t) => t.system === 'task')!
const types = [task]
const keys = ['past', 'today', 'tomorrow', 'this-week', 'next-week', 'later', NO_VALUE]
const labels = ['Earlier', 'Today', 'Tomorrow', 'This week', 'Next week', 'Later', 'No date']
function obj(id: string, due?: DateValue): ObjectSummary {
  return { id, spaceId: 's', typeId: task.id, title: id, aliases: [], tagIds: [], collectionIds: [], props: due ? { due: { kind: 'date', value: due } } : {}, createdAt: at, updatedAt: at, preview: '' }
}
const day = (date: string): DateValue => ({ start: `${date}T00:00:00.000Z`, resolution: 'day' })

beforeEach(() => {
  vi.clearAllMocks()
  workspace.types = types
  typesById.value.clear()
  for (const type of types) typesById.value.set(type.id, type)
  const options = Intl.DateTimeFormat().resolvedOptions()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...options, timeZone: 'America/Toronto' })
})
afterEach(() => vi.restoreAllMocks())

describe('group by a date', () => {
  it('orders buckets by time, with No date last, regardless of object order', () => {
    const objects = [obj('none'), obj('later', day('2026-12-01')), obj('tomorrow', day('2026-11-12')), obj('past', day('2026-11-10')), obj('next', day('2026-11-17')), obj('week', day('2026-11-13')), obj('today', day('2026-11-11'))]
    const groups = groupObjects(objects, 'due', types)
    expect(groups.map((g) => g.key)).toEqual(keys)
    expect(groups.map((g) => g.label)).toEqual(['Overdue', ...labels.slice(1)])
    expect(groups.map((g) => g.items[0]?.id)).toEqual(['past', 'today', 'tomorrow', 'week', 'next', 'later', 'none'])
    expect(groups.filter((g) => g.color).map((g) => [g.key, g.color])).toEqual([['past', 'red'], ['today', 'sky']])
  })

  it('drops empty buckets unless keepEmpty, including an empty No date', () => {
    const objects = [obj('today', day('2026-11-11'))]
    expect(groupObjects(objects, 'due', types).map((g) => g.key)).toEqual(['today'])
    expect(groupObjects(objects, 'due', types, true).map((g) => g.key)).toEqual(keys)
    expect(groupObjects([], 'due', types)).toEqual([])
    expect(groupObjects([], 'due', types, true).map((g) => g.label)).toEqual(labels)
  })

  it('uses the viewer’s day for a timed value at 23:30, not its UTC day', () => {
    const object = obj('late', { start: '2026-11-12T04:30:00.000Z', resolution: 'time' })
    expect(groupObjects([object], 'due', types)[0]?.key).toBe('today')
  })

  it('does not shift a day-resolution date into the previous local day', () => {
    expect(groupObjects([obj('today', day('2026-11-11'))], 'due', types)[0]?.key).toBe('today')
  })

  it('groups ranges by their start, for days and times', () => {
    const objects = [obj('days', { ...day('2026-11-11'), end: '2026-11-17T00:00:00.000Z' }), obj('times', { start: '2026-11-12T04:30:00.000Z', end: '2026-11-12T08:00:00.000Z', resolution: 'time' })]
    expect(groupObjects(objects, 'due', types).map((g) => [g.key, g.items.length])).toEqual([['today', 2]])
  })

  it('calls a completed task’s past due date Earlier, without a warning color', () => {
    const object = obj('done', day('2026-11-10'))
    object.props.status = { kind: 'select', value: ['done'] }
    expect(groupObjects([object], 'due', types)[0]).toMatchObject({ label: 'Earlier' })
    expect(groupObjects([object], 'due', types)[0]?.color).toBeUndefined()
  })

  it('finds a date field even when another type defines the same id first', () => {
    const other: ObjectType = { ...task, id: 'other', properties: [{ id: 'due', name: 'Due', kind: 'text' }] }
    expect(groupObjects([obj('today', day('2026-11-11'))], 'due', [other, task])[0]?.key).toBe('today')
    expect(acceptsGroup('due', groupObjects([], 'due', [other, task], true)[1]!, [other, task])).toBe(true)
  })

  it('offers date properties, but not recorded dates or formulas', () => {
    workspace.types = [{ ...task, properties: [...task.properties, { id: 'calculated', name: 'Calculated', kind: 'formula', expression: '{due}' }] }]
    typesById.value.set(task.id, workspace.types[0]!)
    const fields = groupOptions([task.id]).map((f) => f.field)
    expect(fields).toContain('due')
    for (const field of ['createdAt', 'updatedAt', 'date', 'calculated']) expect(fields).not.toContain(field)
  })
})

describe('moving between groups', () => {
  const dateGroups = () => groupObjects([], 'due', types, true)
  const groupOf = (key: string) => dateGroups().find((g) => g.key === key)!
  const week = startOfWeek('2026-11-11')

  it('allows selects and dates, but not what is recorded', () => {
    expect(movableField('due')).toBe(true)
    expect(movableField('status')).toBe(true)
    for (const field of ['type', 'createdBy', 'updatedBy', '']) expect(movableField(field)).toBe(false)
  })

  it('finds the day of a date group, none for Earlier and clearing for No date', () => {
    expect(dropDay('today')).toBe('2026-11-11')
    expect(dropDay('tomorrow')).toBe('2026-11-12')
    // The first working day of that week (the test locale's weekend is Saturday and Sunday).
    const working = (from: string) => [0, 1, 2].map((n) => addDays(from, n)).find((d) => ![0, 6].includes(new Date(`${d}T00:00:00.000Z`).getUTCDay()))
    expect(dropDay('next-week')).toBe(working(addDays(week, 7)))
    expect(dropDay('later')).toBe(working(addDays(week, 14)))
    expect(dropDay('past')).toBeUndefined()
    expect(dropDay(NO_VALUE)).toBeNull()
    expect(dropDay('some-select-option')).toBeUndefined()
  })

  it('has no day in This week once the week has run out (a Saturday, whichever day the week starts; Sunday-start weeks are in core)', () => {
    expect(dropDay('this-week', '2026-11-14')).toBeUndefined()
    expect(dropDay('this-week', '2026-11-11')).toBe('2026-11-13')
  })

  it('accepts a date group only when it has a day, a select group always', () => {
    expect(acceptsGroup('due', groupOf('today'), types)).toBe(true)
    expect(acceptsGroup('due', groupOf(NO_VALUE), types)).toBe(true)
    expect(acceptsGroup('due', groupOf('past'), types)).toBe(false)
    expect(acceptsGroup('status', groupObjects([], 'status', types, true)[0]!, types)).toBe(true)
    expect(acceptsGroup('type', groupOf('today'), types)).toBe(false)
  })

  it('gives a card without a date the group’s day, at day resolution', () => {
    const object = obj('none')
    expect(placeInGroup(object, 'due', groupOf('tomorrow'), dateGroups())).toBe(true)
    expect(object.props.due).toEqual({ kind: 'date', value: day('2026-11-12') })
  })

  it('moves a day date, shifting a range’s end along and keeping a repeat', () => {
    const object = obj('range', { ...day('2026-11-09'), end: '2026-11-10T00:00:00.000Z', rrule: 'FREQ=WEEKLY' })
    expect(placeInGroup(object, 'due', groupOf('today'), dateGroups())).toBe(true)
    expect(object.props.due).toEqual({ kind: 'date', value: { ...day('2026-11-11'), end: '2026-11-12T00:00:00.000Z', rrule: 'FREQ=WEEKLY' } })
  })

  it('keeps the local time of a timed date and its length', () => {
    // 9:00 to 10:30 in Toronto on Nov 9.
    const object = obj('timed', { start: '2026-11-09T14:00:00.000Z', end: '2026-11-09T15:30:00.000Z', resolution: 'time' })
    expect(placeInGroup(object, 'due', groupOf('tomorrow'), dateGroups())).toBe(true)
    expect(object.props.due).toEqual({ kind: 'date', value: { start: '2026-11-12T14:00:00.000Z', end: '2026-11-12T15:30:00.000Z', resolution: 'time' } })
  })

  it('clears the date for No date', () => {
    const object = obj('dated', day('2026-11-11'))
    expect(placeInGroup(object, 'due', groupOf(NO_VALUE), dateGroups())).toBe(true)
    expect(object.props.due).toBeUndefined()
  })

  it('refuses Earlier and changes nothing', async () => {
    const object = { ...obj('today', day('2026-11-11')), content: {} }
    const before = structuredClone(object)
    expect(placeInGroup(object, 'due', groupOf('past'), dateGroups())).toBe(false)
    expect(object).toEqual(before)
    vi.mocked(api.object).mockResolvedValue(object)
    expect(await moveToGroup('today', 'due', groupOf('past'), dateGroups())).toBeUndefined()
    expect(api.saveObject).not.toHaveBeenCalled()
  })

  it('still places an object in a select group', () => {
    const object = obj('task')
    const groups = groupObjects([], 'status', types, true)
    const group = groups.find((g) => g.key === 'done')!
    expect(placeInGroup(object, 'status', group, groups)).toBe(true)
    expect(object.props.status).toEqual({ kind: 'select', value: ['done'] })
  })

  it('does not take a select for a date because an unrelated type uses the same id for one', () => {
    const other: ObjectType = { ...task, id: 'other', properties: [{ id: 'status', name: 'Status', kind: 'date' }] }
    workspace.types = [other, task]
    typesById.value.set(other.id, other)
    const object = obj('task')
    const groups = groupObjects([], 'status', [task], true)
    expect(placeInGroup(object, 'status', groups.find((g) => g.key === 'done')!, groups)).toBe(true)
    expect(object.props.status).toEqual({ kind: 'select', value: ['done'] })
  })
})
