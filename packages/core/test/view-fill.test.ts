import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fillFromFilter, matchesFilter, type Filter, type FilterGroup, type ObjectSummary, type ObjectType } from '../src/index.ts'
import type { QueryContext } from '../src/query.ts'

const at = '2026-11-16T12:00:00.000Z'
const task: ObjectType = {
  id: 'task',
  spaceId: 's',
  name: 'Task',
  pluralName: 'Tasks',
  properties: [
    { id: 'status', kind: 'select', name: 'Status', multiple: false, options: [{ id: 'next', label: 'Next' }, { id: 'done', label: 'Done' }, { id: 'dropped', label: 'Dropped' }] },
    { id: 'list', kind: 'select', name: 'Area', multiple: false, options: [{ id: 'work', label: 'Work' }, { id: 'home', label: 'Home' }] },
    { id: 'sprint', kind: 'relation', name: 'Sprint', targetTypeIds: [], multiple: false },
    { id: 'project', kind: 'relation', name: 'Project', targetTypeIds: [], multiple: true },
    { id: 'assignee', kind: 'person', name: 'Assignee', multiple: true },
    { id: 'dodate', kind: 'date', name: 'Do date' },
    { id: 'due', kind: 'date', name: 'Due' },
    { id: 'blocked', kind: 'checkbox', name: 'Blocked' },
    { id: 'score', kind: 'formula', name: 'Score', expression: '1' },
  ],
  views: [],
  createdAt: at,
  updatedAt: at,
}
const ctx = (extra: Partial<QueryContext> = {}): QueryContext => ({ types: new Map([[task.id, task]]), today: '2026-11-16', timeZone: 'America/Toronto', ...extra })
const and = (...items: FilterGroup['items']): FilterGroup => ({ kind: 'group', operator: 'and', items })
const or = (...items: FilterGroup['items']): FilterGroup => ({ kind: 'group', operator: 'or', items })
const f = (field: string, operator: Filter['operator'], value?: Filter['value']): Filter => ({ kind: 'filter', field, operator, ...(value ? { value } : {}) })
const lit = (value: string | string[]): Filter['value'] => ({ kind: 'literal', value })
const open = f('status', 'not-contains', lit(['done', 'dropped']))
const day = (d: string) => ({ kind: 'date', value: { start: `${d}T00:00:00.000Z`, resolution: 'day' } })

describe('fillFromFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
  })
  afterEach(() => vi.useRealTimers())
  it('fills what a view asks for plainly', () => {
    expect(fillFromFilter(task, and(f('list', 'is', lit(['work'])), open), ctx())).toEqual({ list: { kind: 'select', value: ['work'] } })
    expect(fillFromFilter(task, and(f('status', 'is', lit(['next'])), open), ctx())).toEqual({ status: { kind: 'select', value: ['next'] } })
    expect(fillFromFilter(task, f('blocked', 'is-checked'), ctx())).toEqual({ blocked: { kind: 'checkbox', value: true } })
  })

  it('fills nothing from what a view rules out', () => {
    expect(fillFromFilter(task, and(f('list', 'is-not', lit(['work'])), open), ctx())).toEqual({})
    expect(fillFromFilter(task, and(f('sprint', 'is-empty'), open), ctx())).toEqual({})
    expect(fillFromFilter(task, f('due', 'before', { kind: 'variable', name: 'today' }), ctx())).toEqual({})
    expect(fillFromFilter(task, undefined, ctx())).toEqual({})
  })

  it('reads variables: the current sprint, me, the parent, today', () => {
    expect(fillFromFilter(task, and(f('sprint', 'contains', { kind: 'variable', name: 'current-sprint' })), ctx({ currentSprint: 'sp1' }))).toEqual({ sprint: { kind: 'relation', value: ['sp1'] } })
    expect(fillFromFilter(task, f('sprint', 'contains', { kind: 'variable', name: 'current-sprint' }), ctx())).toEqual({})
    expect(fillFromFilter(task, f('assignee', 'contains', { kind: 'variable', name: 'me' }), ctx({ me: 'u1' }))).toEqual({ assignee: { kind: 'person', value: ['u1'] } })
    const parent = { id: 'p1' } as ObjectSummary
    expect(fillFromFilter(task, f('project', 'contains', { kind: 'variable', name: 'parent' }), ctx({ parent }))).toEqual({ project: { kind: 'relation', value: ['p1'] } })
    expect(fillFromFilter(task, f('dodate', 'is', { kind: 'variable', name: 'today', offsetDays: 1 }), ctx())).toEqual({ dodate: day('2026-11-17') })
  })

  it('takes the first part of an "or" that is enough on its own', () => {
    const today = or(f('dodate', 'is', { kind: 'variable', name: 'today' }), f('due', 'before', { kind: 'variable', name: 'today' }))
    expect(fillFromFilter(task, and(today, open), ctx())).toEqual({ dodate: day('2026-11-16') })
    expect(fillFromFilter(task, or(f('due', 'before', { kind: 'variable', name: 'today' }), f('list', 'is', lit(['home']))), ctx())).toEqual({ list: { kind: 'select', value: ['home'] } })
  })

  it('tries OR choices against the enclosing AND regardless of order', () => {
    const work = f('list', 'is', lit(['work']))
    const choice = or(f('list', 'is', lit(['home'])), f('status', 'is', lit(['next'])))
    for (const filter of [and(work, choice), and(choice, work)]) {
      const props = fillFromFilter(task, filter, ctx())
      expect(props).toEqual({ list: { kind: 'select', value: ['work'] }, status: { kind: 'select', value: ['next'] } })
      expect(matchesFilter({ id: '', spaceId: 's', typeId: task.id, title: '', aliases: [], tagIds: [], collectionIds: [], props, createdAt: at, updatedAt: at, preview: '' }, filter, ctx())).toBe(true)
    }
  })

  it('tests OR choices with the timestamps the new object will have', () => {
    const filter = or(and(f('status', 'is', lit(['next'])), f('createdAt', 'before', { kind: 'variable', name: 'today' })), f('status', 'is', lit(['done'])))
    const props = fillFromFilter(task, filter, ctx())
    expect(props).toEqual({ status: { kind: 'select', value: ['done'] } })
    expect(matchesFilter({ id: '', spaceId: 's', typeId: task.id, title: '', aliases: [], tagIds: [], collectionIds: [], props, createdAt: at, updatedAt: at, preview: '' }, filter, ctx())).toBe(true)
  })

  it('ignores built-in fields and formulas; "contains" takes one, "is" all on a multiple field', () => {
    expect(fillFromFilter(task, and(f('title', 'is', lit('x')), f('score', 'is', lit('1'))), ctx())).toEqual({})
    expect(fillFromFilter(task, f('project', 'contains', lit(['a', 'b'])), ctx())).toEqual({ project: { kind: 'relation', value: ['a'] } })
    expect(fillFromFilter(task, f('project', 'is', lit(['a', 'b'])), ctx())).toEqual({ project: { kind: 'relation', value: ['a', 'b'] } })
  })

  it('the first value for a field wins', () => {
    expect(fillFromFilter(task, and(f('list', 'is', lit(['work'])), f('list', 'is', lit(['home']))), ctx())).toEqual({ list: { kind: 'select', value: ['work'] } })
  })
})
