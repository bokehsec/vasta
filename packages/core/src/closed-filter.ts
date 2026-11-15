// Closed objects (a task's Done, Dropped: status options meaning done) are left out of views by a
// filter of their own, "Status is not Done, Dropped", that a type's new views and new queries of it
// start with: it shows in the view's filters like any other, and removing it lists them again. A
// board in status columns (its Done column) and a filter that asks for a closed status (a view of
// what is done) go without it.
import type { Filter, FilterGroup, Id, ObjectType, QueryDef, ViewDef } from './model.ts'
import { statusProperty } from './metrics.ts'

/** The ids of a type's status options meaning done. */
export function closedStatusIds(type: ObjectType | undefined): Id[] {
  return statusProperty(type)?.options.filter((o) => o.status === 'done').map((o) => o.id) ?? []
}

const literalIds = (filter: Filter): Id[] => (filter.value?.kind === 'literal' && Array.isArray(filter.value.value) ? filter.value.value : [])
const leavesOut = (item: Filter | FilterGroup, field: string): item is Filter => item.kind === 'filter' && item.field === field && item.operator === 'not-contains'

/** Whether a filter leaves out every closed status of the type, as the default one does. */
export function hidesClosed(type: ObjectType | undefined, filter: FilterGroup | undefined): boolean {
  const def = statusProperty(type)
  const closed = closedStatusIds(type)
  if (!def || !closed.length || !filter || filter.operator !== 'and') return false
  const left = filter.items.filter((item) => leavesOut(item, def.id)).flatMap(literalIds)
  return closed.every((id) => left.includes(id))
}

/**
 * The filter with the type's closed statuses left out: added to a "Status is not" it has (a Backlog
 * that leaves out only Done loses Dropped too), else as a filter of its own.
 */
export function withClosedHidden(type: ObjectType | undefined, filter: FilterGroup | undefined): FilterGroup | undefined {
  const def = statusProperty(type)
  const closed = closedStatusIds(type)
  if (!def || !closed.length || hidesClosed(type, filter)) return filter
  const own: Filter = { kind: 'filter', field: def.id, operator: 'not-contains', value: { kind: 'literal', value: closed } }
  if (!filter) return { kind: 'group', operator: 'and', items: [own] }
  if (filter.operator === 'or') return { kind: 'group', operator: 'and', items: [filter, own] }
  const at = filter.items.findIndex((item) => leavesOut(item, def.id))
  if (at < 0) return { ...filter, items: [...filter.items, own] }
  const existing = filter.items[at] as Filter
  const ids = [...literalIds(existing), ...closed.filter((id) => !literalIds(existing).includes(id))]
  return { ...filter, items: filter.items.map((item, i) => (i === at ? { ...existing, value: { kind: 'literal', value: ids } } : item)) }
}

/** The filter with the type's closed statuses no longer left out; undefined when nothing is left of it. */
export function withClosedShown(type: ObjectType | undefined, filter: FilterGroup | undefined): FilterGroup | undefined {
  const def = statusProperty(type)
  const closed = closedStatusIds(type)
  if (!def || !filter || filter.operator !== 'and') return filter
  const items = filter.items.flatMap((item): (Filter | FilterGroup)[] => {
    if (!leavesOut(item, def.id)) return [item]
    const ids = literalIds(item).filter((id) => !closed.includes(id))
    return ids.length ? [{ ...item, value: { kind: 'literal', value: ids } }] : []
  })
  return items.length ? { ...filter, items } : undefined
}

function asksFor(filter: Filter | FilterGroup | undefined, field: string, ids: Id[]): boolean {
  if (!filter) return false
  if (filter.kind === 'group') return filter.items.some((item) => asksFor(item, field, ids))
  return filter.field === field && (filter.operator === 'is' || filter.operator === 'contains') && literalIds(filter).some((id) => ids.includes(id))
}

/** Whether a board's columns are the type's statuses: its groupBy, else its first select (as a board shows it). */
function statusColumns(type: ObjectType | undefined, view: Pick<ViewDef, 'layout' | 'groupBy'>, field: string): boolean {
  if (view.layout !== 'kanban') return false
  return (view.groupBy?.[0]?.field ?? type?.properties.find((p) => p.kind === 'select')?.id) === field
}

/**
 * The filter a new view of a type starts with (or an older view gets once, ensureBuiltinTypes):
 * its own with closed objects left out, unless it is a board in status columns or asks for a
 * closed status.
 */
export function defaultViewFilter(type: ObjectType | undefined, view: Pick<ViewDef, 'layout' | 'groupBy' | 'filter'>): FilterGroup | undefined {
  const def = statusProperty(type)
  const closed = closedStatusIds(type)
  if (!def || !closed.length || statusColumns(type, view, def.id) || asksFor(view.filter, def.id, closed)) return view.filter
  return withClosedHidden(type, view.filter)
}

/**
 * A query's filter once it finds objects of these types: closed ones are left out of each type
 * with a status whose status field the filter does not mention yet (a query set up to show them, or
 * one whose default filter was removed, is left alone). Types share the "status" field, so their
 * closed options go in one filter.
 */
export function defaultQueryFilter(types: ObjectType[], query: Pick<QueryDef, 'layout' | 'groupBy' | 'filter'>): FilterGroup | undefined {
  let filter = query.filter
  for (const type of types) {
    const def = statusProperty(type)
    if (!def || !closedStatusIds(type).length || mentions(query.filter, def.id) || statusColumns(type, { layout: query.layout ?? 'list', groupBy: query.groupBy }, def.id)) continue
    filter = withClosedHidden(type, filter)
  }
  return filter
}

function mentions(filter: Filter | FilterGroup | undefined, field: string): boolean {
  if (!filter) return false
  return filter.kind === 'group' ? filter.items.some((item) => mentions(item, field)) : filter.field === field
}
