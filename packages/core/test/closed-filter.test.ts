import { describe, expect, it } from 'vitest'
import { builtinTypeId, createBuiltinTypes } from '../src/builtin-types.ts'
import { defaultQueryFilter, defaultViewFilter, hidesClosed, withClosedHidden, withClosedShown } from '../src/closed-filter.ts'
import type { Filter, FilterGroup, ObjectType, PropertyDef } from '../src/model.ts'
import { ensureBuiltinTypes } from '../src/operations.ts'
import { NodeStore } from '../src/store-node.ts'

const AT = '2026-11-15T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const page = types.find((t) => t.system === 'page')!

/** The built-in task with a "Dropped", as a space set up for triage has. */
function withDropped(type: ObjectType): ObjectType {
  const properties: PropertyDef[] = type.properties.map((p) =>
    p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'dropped', label: 'Dropped', status: 'done' }] } : p
  )
  return { ...type, properties }
}
const task = withDropped(types.find((t) => t.system === 'task')!)

const status = (operator: Filter['operator'], ids: string[]): Filter => ({ kind: 'filter', field: 'status', operator, value: { kind: 'literal', value: ids } })
const and = (...items: (Filter | FilterGroup)[]): FilterGroup => ({ kind: 'group', operator: 'and', items })
const hidden = status('not-contains', ['done', 'dropped'])
const mine: Filter = { kind: 'filter', field: 'assignee', operator: 'contains', value: { kind: 'variable', name: 'me' } }

describe('the filter leaving closed objects out', () => {
  it('is what a new view of a type with a status starts with', () => {
    expect(defaultViewFilter(task, { layout: 'list' })).toEqual(and(hidden))
    expect(hidesClosed(task, and(hidden))).toBe(true)
    expect(defaultViewFilter(page, { layout: 'list' })).toBeUndefined()
  })

  it('is on the built-in Task type’s first view', () => {
    expect(types.find((t) => t.system === 'task')!.views[0]!.filter).toEqual(and(status('not-contains', ['done'])))
    expect(page.views[0]!.filter).toBeUndefined()
  })

  it('is not added to a board in status columns or a view asking for a closed status', () => {
    expect(defaultViewFilter(task, { layout: 'kanban' })).toBeUndefined()
    expect(defaultViewFilter(task, { layout: 'kanban', groupBy: [{ field: 'status' }] })).toBeUndefined()
    expect(defaultViewFilter(task, { layout: 'kanban', groupBy: [{ field: 'priority' }] })).toEqual(and(hidden))
    expect(defaultViewFilter(task, { layout: 'list', filter: and(status('is', ['done'])) })).toEqual(and(status('is', ['done'])))
  })

  it('extends a "not Done" (a Backlog) and goes next to the other conditions', () => {
    expect(withClosedHidden(task, and(mine, status('not-contains', ['done'])))).toEqual(and(mine, hidden))
    expect(withClosedHidden(task, and(mine))).toEqual(and(mine, hidden))
    const either: FilterGroup = { kind: 'group', operator: 'or', items: [mine] }
    expect(withClosedHidden(task, either)).toEqual(and(either, hidden))
  })

  it('comes off with the switch, leaving the rest', () => {
    expect(withClosedShown(task, and(mine, hidden))).toEqual(and(mine))
    expect(withClosedShown(task, and(hidden))).toBeUndefined()
    expect(withClosedShown(task, and(status('not-contains', ['done', 'dropped', 'todo'])))).toEqual(and(status('not-contains', ['todo'])))
    expect(hidesClosed(task, and(status('not-contains', ['done'])))).toBe(false)
  })

  it('is what a query starts with once it finds a type with a status, unless its filters mention the status', () => {
    expect(defaultQueryFilter([task], { layout: 'list' })).toEqual(and(hidden))
    expect(defaultQueryFilter([task, page], { filter: and(mine) })).toEqual(and(mine, hidden))
    expect(defaultQueryFilter([task], { filter: and(status('contains', ['todo'])) })).toEqual(and(status('contains', ['todo'])))
    expect(defaultQueryFilter([page], {})).toBeUndefined()
  })
})

describe('views and queries from before the filter', () => {
  it('get it once, so they list what they did', () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: AT })
    for (const type of createBuiltinTypes('s', AT)) {
      if (type.system === 'task') {
        Object.assign(type, withDropped(type))
        type.views = [
          { id: 'all', name: 'All', layout: 'list' },
          { id: 'shown', name: 'Everything', layout: 'list', showClosed: true },
          { id: 'board', name: 'Board', layout: 'kanban', groupBy: [{ field: 'status' }] },
          { id: 'backlog', name: 'Backlog', layout: 'list', filter: and(status('not-contains', ['done'])) },
          { id: 'done', name: 'Done', layout: 'list', filter: and(status('is', ['done'])) },
        ]
      }
      store.putType(type)
    }
    const object = { spaceId: 's', typeId: builtinTypeId('s', 'query'), aliases: [], tagIds: [], collectionIds: [], props: {}, content: {}, createdAt: AT, updatedAt: AT }
    store.putObject({ ...object, id: 'q1', title: 'Tasks', query: { typeIds: [builtinTypeId('s', 'task')], filter: and(mine) } })
    store.putObject({ ...object, id: 'q2', title: 'Anything', query: { typeIds: [] } })
    store.putObject({ ...object, id: 'q3', title: 'Pages', query: { typeIds: [builtinTypeId('s', 'page')] } })

    ensureBuiltinTypes(store, AT)
    const views = store.getType(builtinTypeId('s', 'task'))!.views
    expect(views.map((v) => [v.id, v.filter, v.showClosed])).toEqual([
      ['all', and(hidden), undefined],
      ['shown', undefined, undefined],
      ['board', undefined, undefined],
      ['backlog', and(hidden), undefined],
      ['done', and(status('is', ['done'])), undefined],
    ])
    expect(store.getObject('q1')!.query!.filter).toEqual(and(mine, hidden))
    expect(store.getObject('q2')!.query!.filter).toBeUndefined()
    expect(store.getObject('q3')!.query!.filter).toBeUndefined()

    // Once: a filter removed afterwards stays removed.
    const type = store.getType(builtinTypeId('s', 'task'))!
    store.putType({ ...type, views: type.views.map((v) => (v.id === 'all' ? { id: 'all', name: 'All', layout: 'list' } : v)) })
    ensureBuiltinTypes(store, AT)
    expect(store.getType(builtinTypeId('s', 'task'))!.views[0]!.filter).toBeUndefined()
  })
})
