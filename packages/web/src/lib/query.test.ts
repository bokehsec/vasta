import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinTypes, type DateValue, type ObjectSummary, type ObjectType } from '@vasta/core'
import { api } from './api.ts'
import { acceptsGroup, groupObjects, groupOptions, movableField, moveToGroup, NO_VALUE, placeInGroup } from './query.ts'
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
    expect(groups.map((g) => g.label)).toEqual(labels)
    expect(groups.map((g) => g.items[0]?.id)).toEqual(['past', 'today', 'tomorrow', 'week', 'next', 'later', 'none'])
    expect(groups.filter((g) => g.color).map((g) => [g.key, g.color])).toEqual([['today', 'sky']])
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
    expect(acceptsGroup('due', { key: 'today', label: '', items: [] }, [other, task])).toBe(true)
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
  it('allows selects and dates, but not recorded values', () => {
    expect(movableField('due')).toBe(true)
    expect(movableField('status')).toBe(true)
    expect(movableField('createdBy')).toBe(false)
  })

  // Wednesday 11 Nov 2026, weeks start on Sunday, Saturday and Sunday off.
  const place = (object: ObjectSummary, key: string) => {
    const groups = groupObjects([], 'due', types, true)
    return placeInGroup(object, 'due', groups.find((g) => g.key === key)!, groups)
  }
  const dueOf = (object: ObjectSummary) => (object.props.due as { value: DateValue } | undefined)?.value

  it('gives a card the day of a date group, a day value when it had none', () => {
    for (const [key, date] of [['today', '2026-11-11'], ['tomorrow', '2026-11-12'], ['this-week', '2026-11-13'], ['next-week', '2026-11-16'], ['later', '2026-11-23']] as const) {
      const object = obj('card')
      expect(place(object, key)).toBe(true)
      expect(dueOf(object)).toEqual({ start: `${date}T00:00:00.000Z`, resolution: 'day' })
    }
  })

  it('clears the date for No date', () => {
    const object = obj('card', day('2026-11-11'))
    expect(place(object, NO_VALUE)).toBe(true)
    expect(object.props.due).toBeUndefined()
  })

  it("keeps the time of day, a range's length and a repeat", () => {
    const object = obj('card', { start: '2026-11-10T14:30:00.000Z', end: '2026-11-10T16:00:00.000Z', resolution: 'time', rrule: 'FREQ=WEEKLY' })
    expect(place(object, 'tomorrow')).toBe(true)
    expect(dueOf(object)).toEqual({ start: '2026-11-12T14:30:00.000Z', end: '2026-11-12T16:00:00.000Z', resolution: 'time', rrule: 'FREQ=WEEKLY' })
    const days = obj('days', { ...day('2026-11-10'), end: '2026-11-12T00:00:00.000Z' })
    expect(place(days, 'today')).toBe(true)
    expect(dueOf(days)).toEqual({ start: '2026-11-11T00:00:00.000Z', end: '2026-11-13T00:00:00.000Z', resolution: 'day' })
  })

  it('refuses Earlier, and does not touch the card', () => {
    const object = obj('today', day('2026-11-11'))
    const before = structuredClone(object)
    expect(place(object, 'past')).toBe(false)
    expect(object).toEqual(before)
    const groups = groupObjects([], 'due', types, true)
    expect(acceptsGroup('due', groups[0]!, types)).toBe(false)
    expect(acceptsGroup('due', groups[1]!, types)).toBe(true)
    expect(acceptsGroup('due', groups[6]!, types)).toBe(true)
  })

  it('never puts a bucket key into a date it cannot find, even without types in the workspace', () => {
    const object = obj('today', day('2026-11-11'))
    const before = structuredClone(object)
    typesById.value.clear()
    expect(place(object, 'tomorrow')).toBe(false)
    expect(object).toEqual(before)
  })

  it('saves a date move', async () => {
    const object = { ...obj('today', day('2026-11-11')), content: {} }
    vi.mocked(api.object).mockResolvedValue(object)
    vi.mocked(api.saveObject).mockImplementation(async (o) => o as never)
    const groups = groupObjects([], 'due', types, true)
    await moveToGroup('today', 'due', groups[2]!, groups)
    expect(api.saveObject).toHaveBeenCalledOnce()
    expect(dueOf(object)?.start).toBe('2026-11-12T00:00:00.000Z')
  })

  it('still places an object in a select group', () => {
    const object = obj('task')
    const groups = groupObjects([], 'status', types, true)
    const group = groups.find((g) => g.key === 'done')!
    expect(placeInGroup(object, 'status', group, groups)).toBe(true)
    expect(object.props.status).toEqual({ kind: 'select', value: ['done'] })
  })

  it('does not block a select because an unrelated type uses the same id for a date', () => {
    const other: ObjectType = { ...task, id: 'other', properties: [{ id: 'status', name: 'Status', kind: 'date' }] }
    workspace.types = [other, task]
    typesById.value.set(other.id, other)
    const object = obj('task')
    const groups = groupObjects([], 'status', [task], true)
    expect(placeInGroup(object, 'status', groups.find((g) => g.key === 'done')!, groups)).toBe(true)
    expect(object.props.status).toEqual({ kind: 'select', value: ['done'] })
  })
})
