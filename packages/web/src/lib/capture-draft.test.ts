import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectType } from '@vasta/core'
import { startPreferences, stopPreferences } from './preferences.ts'
import { clearDraft, readDraft, usedTypes, withType, writeDraft, writtenText } from './capture-draft.ts'

const at = '2026-10-19T12:00:00.000Z'
const type = (id: string, name: string): ObjectType => ({ id, spaceId: 's', name, pluralName: `${name}s`, createdAt: at, updatedAt: at, views: [], properties: [] })
const types = [type('book', 'Book'), type('meeting', 'Meeting note')]

vi.mock('./api.ts', () => ({ authApi: { updateProfile: async () => ({}) }, NetworkError: class extends Error {} }))

const fake = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null, data }
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
  beforeEach(() => {
    vi.stubGlobal('localStorage', fake())
    startPreferences({ id: 'u' })
  })
  afterEach(() => {
    stopPreferences()
    vi.unstubAllGlobals()
  })
  it('keeps a draft per space, on this device for the person logged in', () => {
    writeDraft('a', 'hello')
    expect(readDraft('a')).toBe('hello')
    expect(readDraft('b')).toBe('')
    stopPreferences()
    startPreferences({ id: 'v' })
    expect(readDraft('a')).toBe('')
  })
  it('clears on a blank text or clearDraft', () => {
    writeDraft('a', 'hello')
    writeDraft('a', '  ')
    expect(readDraft('a')).toBe('')
    writeDraft('a', 'again')
    clearDraft('a')
    expect(readDraft('a')).toBe('')
    expect([...(localStorage as unknown as ReturnType<typeof fake>).data.keys()].filter((key) => key.includes('capture-draft'))).toEqual([])
  })
  it('survives storage that throws', () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, length: 0, key: () => null })
    expect(readDraft('a')).toBe('')
    expect(() => writeDraft('a', 'x')).not.toThrow()
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
