import { describe, expect, it } from 'vitest'
import type { ObjectType } from '@vasta/core'
import { clearDraft, readDraft, usedTypes, withType, writeDraft, writtenText } from './capture-draft.ts'

const at = '2026-10-19T12:00:00.000Z'
const type = (id: string, name: string): ObjectType => ({ id, spaceId: 's', name, pluralName: `${name}s`, createdAt: at, updatedAt: at, views: [], properties: [] })
const types = [type('book', 'Book'), type('meeting', 'Meeting note')]

const fake = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data }
}

describe('withType', () => {
  it('puts the type before a plain text', () => expect(withType(types, 'Dune', types[0])).toBe('/Book Dune'))
  it('replaces the type already there', () => expect(withType(types, '/Book Dune', types[1])).toBe('/Meeting note Dune'))
  it('removes the type for a note', () => expect(withType(types, '/Meeting note Standup', undefined)).toBe('Standup'))
  it('works on an empty text', () => expect(withType(types, '', types[0])).toBe('/Book '))
  it('leaves a half-typed "/" alone for a note', () => expect(withType(types, '/Bo', undefined)).toBe('/Bo'))
})

describe('writtenText', () => {
  it('ignores the picked type', () => {
    expect(writtenText(types, '/Book ')).toBe('')
    expect(writtenText(types, '/Book Dune ')).toBe('Dune')
    expect(writtenText(types, 'Plain')).toBe('Plain')
  })
})

describe('draft storage', () => {
  it('keeps a draft per user and space', () => {
    const s = fake()
    writeDraft('u', 'a', 'hello', s)
    expect(readDraft('u', 'a', s)).toBe('hello')
    expect(readDraft('u', 'b', s)).toBe('')
    expect(readDraft('v', 'a', s)).toBe('')
  })
  it('clears on a blank text or clearDraft', () => {
    const s = fake()
    writeDraft('u', 'a', 'hello', s)
    writeDraft('u', 'a', '  ', s)
    expect(readDraft('u', 'a', s)).toBe('')
    writeDraft('u', 'a', 'again', s)
    clearDraft('u', 'a', s)
    expect(s.data.size).toBe(0)
  })
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(readDraft('u', 'a', broken)).toBe('')
    expect(() => writeDraft('u', 'a', 'x', broken)).not.toThrow()
  })
})

describe('usedTypes', () => {
  const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => type(id, id.toUpperCase()))
  const made = (...ids: string[]) => ids.map((typeId) => ({ typeId }))
  const ids = (list: ObjectType[]) => list.map((t) => t.id)

  it('shows the four most made types, most first, and the rest under More', () => {
    const { shown, more } = usedTypes(all, made('c', 'c', 'c', 'e', 'e', 'a', 'f', 'd', 'd', 'b'))
    expect(ids(shown)).toEqual(['c', 'd', 'e', 'a'])
    expect(ids(more)).toEqual(['b', 'f'])
  })
  it('shows only the types that were made, when fewer than four were', () => {
    const { shown, more } = usedTypes(all, made('e', 'e', 'b'))
    expect(ids(shown)).toEqual(['e', 'b'])
    expect(ids(more)).toEqual(['a', 'c', 'd', 'f'])
  })
  it('ignores objects of types it is not asked about (notes, daily notes)', () => {
    expect(ids(usedTypes(all, made('daily', 'daily', 'daily', 'b')).shown)).toEqual(['b'])
  })
  it('starts with the first four types in a space where nothing was made', () => {
    const { shown, more } = usedTypes(all, [])
    expect(ids(shown)).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(more)).toEqual(['e', 'f'])
  })
  it('keeps the picked type in sight', () => {
    const { shown, more } = usedTypes(all, made('a', 'b', 'c', 'd', 'a'), all[5])
    expect(ids(shown)).toEqual(['a', 'b', 'c', 'd', 'f'])
    expect(ids(more)).toEqual(['e'])
  })
})
