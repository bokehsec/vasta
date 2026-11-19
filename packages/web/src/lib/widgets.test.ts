// Presets carry only built-in meanings; no fields specific to one person's space.
import { describe, expect, it } from 'vitest'
import { type Doc, type ObjectType } from '@vasta/core'
import { homeColumns, widgetBlocks, widgetPresets } from './widgets.ts'

const task = { id: 'task:s', system: 'task', properties: [
  { id: 'state', kind: 'select', options: [{ id: 'finished', label: 'Complete', status: 'done' }, { id: 'cancelled', label: 'Dropped', status: 'done' }, { id: 'pending', label: 'Waiting', status: 'todo' }] },
  { id: 'deadline', kind: 'date', role: 'deadline' }, { id: 'do', kind: 'date', role: 'plan' },
] } as ObjectType
const context = { types: [task], space: { nutrition: { enabled: true, meals: [] } }, hasHabits: true, homeTagId: 'home-tag' }
const presets = () => widgetPresets(context)
const query = (id: string) => presets().find((p) => p.id === id)!.query!
const closed = { kind: 'filter', field: 'state', operator: 'not-contains', value: { kind: 'literal', value: ['finished', 'cancelled'] } }
const type = { kind: 'filter', field: 'type', operator: 'is', value: { kind: 'literal', value: ['task:s'] } }
const filter = (...extra: unknown[]) => ({ kind: 'group', operator: 'or', items: [{ kind: 'group', operator: 'and', items: [type, closed, ...extra] }] })

describe('Home widget presets', () => {
  it('builds Agenda from task deadline and open statuses', () => {
    expect(query('agenda')).toEqual({ typeIds: ['task:s'], filter: filter(), layout: 'agenda', agenda: { field: 'deadline', days: 3, calendars: true } })
  })
  it.each([['due', 'deadline', 3], ['planned', 'do', 15]] as const)('builds %s with relative dates and rows', (id, field, days) => {
    expect(query(id)).toEqual({ typeIds: ['task:s'], filter: filter({ kind: 'filter', field, operator: 'before', value: { kind: 'variable', name: 'today', offsetDays: days } }), sort: [{ field, direction: 'asc' }], layout: 'list', list: { fields: [field], wrap: true } })
  })
  it('builds Waiting with the actual option id', () => {
    expect(query('waiting')).toEqual({ typeIds: ['task:s'], filter: filter({ kind: 'filter', field: 'state', operator: 'is', value: { kind: 'literal', value: ['pending'] } }), sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'list', list: { fields: [], wrap: true } })
  })
  it('builds Pinned from the resolved home tag', () => {
    expect(query('pinned')).toEqual({ typeIds: [], filter: { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'tags', operator: 'contains', value: { kind: 'literal', value: ['home-tag'] } }] }, sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'grid' })
  })
  it('builds Recently changed across all types', () => {
    expect(query('recent')).toEqual({ typeIds: [], sort: [{ field: 'updatedAt', direction: 'desc' }], layout: 'list', list: { fields: [], wrap: true } })
  })
  it('offers live tools only when the space has their data', () => {
    expect(presets().filter((p) => p.kind).map((p) => p.kind)).toEqual(['habits', 'food', 'capture'])
    const bareTask = { ...task, properties: task.properties.filter((p) => p.kind !== 'select') }
    const bare = widgetPresets({ types: [bareTask], space: {}, hasHabits: false })
    expect(bare.some((p) => ['waiting', 'habits', 'food'].includes(p.id))).toBe(false)
    expect(bare.some((p) => p.id === 'capture')).toBe(true)
    expect(widgetPresets({ types: [], space: {}, hasHabits: false }).some((p) => ['agenda', 'due', 'planned'].includes(p.id))).toBe(false)
  })
  it('keeps different task type meanings in separate branches', () => {
    const other = { ...task, id: 'other', properties: task.properties.map((p) => p.kind === 'select' ? { ...p, id: 'other-status', options: [{ id: 'closed', label: 'Done', status: 'done' as const }] } : p) }
    const agenda = widgetPresets({ ...context, types: [task, other] }).find((p) => p.id === 'agenda')!.query!
    expect(agenda.typeIds).toEqual(['task:s', 'other'])
    expect(agenda.filter!.items).toHaveLength(2)
    expect(JSON.stringify(agenda.filter!.items[1])).toContain('other-status')
  })
  it('inserts a heading above a live block', () => {
    expect(widgetBlocks('Quick capture', { type: 'widget', attrs: { kind: 'capture' } })).toEqual([{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Quick capture' }] }, { type: 'widget', attrs: { kind: 'capture' } }])
  })
})

describe('Home columns', () => {
  const doc: Doc = { type: 'doc', content: widgetBlocks('Capture', { type: 'widget', attrs: { kind: 'capture' } }) }
  it('puts existing blocks left, with a usable empty column on the right', () => {
    const two = homeColumns(doc, true)
    expect(two.content[0]!.content![0]!.content).toEqual(doc.content)
    expect(two.content[0]!.content![1]!.content).toEqual([{ type: 'paragraph' }])
    expect(doc.content[0]!.type).toBe('heading')
  })
  it('unwraps left then right and keeps blocks outside columns', () => {
    const two = homeColumns(doc, true)
    two.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'After' }] })
    expect(homeColumns(two, false).content).toEqual([...doc.content, { type: 'paragraph' }, two.content[1]])
  })
})
