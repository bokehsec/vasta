// Home presets use the space's own task meanings, so a renamed field or status still works.
// Building them is independent of the editor and of creating their personal Query objects.
import { closedStatusIds, isNutritionOn, statusProperty, taskDatesOf, type Doc, type DocNode, type Filter, type FilterGroup, type ObjectType, type QueryDef, type Space } from '@vasta/core'

export type WidgetKind = 'habits' | 'food' | 'capture'
export interface WidgetPreset {
  id: string
  name: string
  icon: string
  query?: QueryDef
  kind?: WidgetKind
  pick?: 'query' | 'embed'
}
export interface WidgetContext {
  types: ObjectType[]
  space: Pick<Space, 'nutrition'>
  hasHabits: boolean
  homeTagId?: string
}
const group = (items: FilterGroup['items'], operator: FilterGroup['operator'] = 'and'): FilterGroup => ({ kind: 'group', operator, items })
const literal = (field: string, operator: Filter['operator'], value: string[]): Filter => ({ kind: 'filter', field, operator, value: { kind: 'literal', value } })
const before = (field: string, offsetDays: number): Filter => ({ kind: 'filter', field, operator: 'before', value: { kind: 'variable', name: 'today', offsetDays } })

export function widgetPresets(context: WidgetContext): WidgetPreset[] {
  const tasks = context.types.filter((t) => t.system === 'task')
  // Separate type branches keep one task type's status ids from excluding another type's work.
  const taskFilter = (types: ObjectType[], extra: (t: ObjectType) => FilterGroup['items'] = () => []): FilterGroup => group(types.map((t) => {
    const status = statusProperty(t)
    const closed = closedStatusIds(t)
    return group([literal('type', 'is', [t.id]), ...(status && closed.length ? [literal(status.id, 'not-contains', closed)] : []), ...extra(t)])
  }), 'or')
  const dated = (role: 'deadline' | 'plan', days: number): QueryDef | undefined => {
    const types = tasks.filter((t) => taskDatesOf(t)[role])
    if (!types.length) return
    const fields = [...new Set(types.map((t) => taskDatesOf(t)[role]!.id))]
    return { typeIds: types.map((t) => t.id), filter: taskFilter(types, (t) => [before(taskDatesOf(t)[role]!.id, days)]), sort: fields.map((field) => ({ field, direction: 'asc' })), layout: 'list', list: { fields, wrap: true } }
  }
  const presets: WidgetPreset[] = []
  const deadlines = tasks.map((t) => taskDatesOf(t).deadline?.id).filter((id): id is string => !!id)
  if (tasks.length && deadlines.length) presets.push({ id: 'agenda', name: 'Agenda', icon: 'ph:calendar-dots', query: { typeIds: tasks.map((t) => t.id), filter: taskFilter(tasks), layout: 'agenda', agenda: { field: deadlines[0], days: 3, calendars: true } } })
  const due = dated('deadline', 3)
  if (due) presets.push({ id: 'due', name: 'Due soon', icon: 'ph:calendar-warning', query: due })
  const plan = dated('plan', 15)
  if (plan) presets.push({ id: 'planned', name: 'Planned', icon: 'ph:calendar-check', query: plan })
  const waiting = tasks.filter((t) => statusProperty(t)?.options.some((o) => /^waiting(?: on)?$/i.test(o.label.trim())))
  if (waiting.length) presets.push({ id: 'waiting', name: 'Waiting on', icon: 'ph:hourglass', query: { typeIds: waiting.map((t) => t.id), filter: taskFilter(waiting, (t) => [literal(statusProperty(t)!.id, 'is', statusProperty(t)!.options.filter((o) => /^waiting(?: on)?$/i.test(o.label.trim())).map((o) => o.id))]), sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'list', list: { fields: [], wrap: true } } })
  presets.push(
    { id: 'pinned', name: 'Pinned', icon: 'ph:push-pin', query: { typeIds: [], filter: group([literal('tags', 'contains', context.homeTagId ? [context.homeTagId] : [])]), sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'grid' } },
    { id: 'recent', name: 'Recently changed', icon: 'ph:clock-counter-clockwise', query: { typeIds: [], sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'list', list: { fields: [], wrap: true } } },
    { id: 'saved', name: 'Saved query…', icon: 'ph:funnel', pick: 'query' },
    { id: 'embed', name: 'Page or block…', icon: 'ph:cards', pick: 'embed' },
  )
  if (context.hasHabits) presets.push({ id: 'habits', name: 'Habits today', icon: 'ph:target', kind: 'habits' })
  if (isNutritionOn(context.space)) presets.push({ id: 'food', name: 'Food today', icon: 'ph:fork-knife', kind: 'food' })
  presets.push({ id: 'capture', name: 'Quick capture', icon: 'ph:lightning', kind: 'capture' })
  return presets
}

export function widgetBlocks(name: string, block: DocNode): DocNode[] {
  return [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: name }] }, block]
}

/** Existing columns are unwrapped in reading order; a new pair starts with all text at left. */
export function homeColumns(doc: Doc, columns: boolean): Doc {
  const unwrap = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => n.type === 'columns' ? (n.content ?? []).flatMap((c) => unwrap(c.content ?? [])) : [n])
  const content = unwrap(doc.content)
  return { ...doc, content: columns ? [{ type: 'columns', content: [{ type: 'column', content: content.length ? content : [{ type: 'paragraph' }] }, { type: 'column', content: [{ type: 'paragraph' }] }] }] : content.length ? content : [{ type: 'paragraph' }] }
}
