import { describe, expect, it, vi } from 'vitest'
import { builtinTypeId, createBuiltinTypes, type ObjectSummary, type ObjectType } from '@vasta/core'
import { listFields, listSettings, rowFields } from './columns.ts'

// The field menus read the workspace's types, which need the app's state: stand in for them.
const types: ObjectType[] = []
vi.mock('./query.ts', () => ({
  fieldOptions: (typeIds: string[]) => [
    ...['title', 'tags', 'type', 'collections', 'createdAt', 'updatedAt', 'createdBy', 'date'].map((field) => ({ field, label: field, kind: 'text', icon: '' })),
    ...types.filter((t) => typeIds.includes(t.id)).flatMap((t) => t.properties.map((def) => ({ field: def.id, label: def.name, kind: 'text', icon: '', def }))),
  ],
}))
vi.mock('./properties.ts', () => ({ formulaValue: () => ({ kind: 'empty' }) }))

const at = '2026-10-19T12:00:00.000Z'
const task = createBuiltinTypes('s', at).find((t) => t.id === builtinTypeId('s', 'task')) as ObjectType
const book: ObjectType = {
  id: 'book', spaceId: 's', name: 'Book', pluralName: 'Books', createdAt: at, updatedAt: at, views: [],
  properties: [
    { id: 'pages', kind: 'number', name: 'Pages' },
    { id: 'read', kind: 'checkbox', name: 'Read' },
    { id: 'notes', kind: 'text', name: 'Notes' },
  ],
}
const summary = (patch: Partial<ObjectSummary>): ObjectSummary =>
  ({ id: 'o', typeId: 'book', spaceId: 's', title: 'A', tagIds: [], collectionIds: [], props: {}, aliases: [], createdAt: at, updatedAt: at, ...patch }) as ObjectSummary

types.push(task, book)

describe('fields on list rows', () => {
  it('ticks what the default row shows while nothing is chosen, never the title', () => {
    const fields = listFields(undefined, ['book'])
    expect(fields.filter((f) => f.on).map((f) => f.field)).toEqual(['tags', 'updatedAt'])
    expect(fields.some((f) => f.field === 'title')).toBe(false)
    expect(fields.some((f) => f.field === 'pages' && !f.on)).toBe(true)
  })

  it('keeps the chosen fields first, in their order, and drops ones the types do not have', () => {
    const fields = listFields({ fields: ['pages', 'gone', 'tags'] }, ['book'])
    expect(fields.filter((f) => f.on).map((f) => f.field)).toEqual(['pages', 'tags'])
    expect(listFields({ fields: [] }, ['book']).some((f) => f.on)).toBe(false)
  })

  it('saves the ticked fields in order, and whether titles wrap', () => {
    const fields = listFields({ fields: ['pages'] }, ['book'])
    expect(listSettings(fields, undefined)).toEqual({ fields: ['pages'] })
    expect(listSettings(fields.map((f) => (f.field === 'tags' ? { ...f, on: true } : f)), true)).toEqual({ fields: ['pages', 'tags'], wrap: true })
  })

  it('shows only the fields an object has a value for', () => {
    const fields = listFields({ fields: ['pages', 'read', 'notes', 'tags', 'date'] }, ['book'])
    const names = (o: ObjectSummary) => rowFields(o, book, fields).map((f) => f.field)
    expect(names(summary({}))).toEqual([])
    expect(names(summary({ props: { pages: { kind: 'number', value: 0 }, read: { kind: 'checkbox', value: true }, notes: { kind: 'text', value: '' } }, tagIds: ['t'] }))).toEqual(['pages', 'read', 'tags'])
    expect(names(summary({ props: { read: { kind: 'checkbox', value: false } }, date: { start: at, resolution: 'day' } }))).toEqual(['date'])
  })

  it('skips properties the object’s own type does not have', () => {
    const fields = listFields({ fields: ['pages'] }, ['book', task.id])
    expect(rowFields(summary({ typeId: task.id, props: { pages: { kind: 'number', value: 3 } } }), task, fields)).toEqual([])
  })
})
