import { describe, expect, it } from 'vitest'
import type { ObjectType } from '@vasta/core'
import { clearDraft, readDraft, withType, writeDraft, writtenText } from './capture-draft.ts'

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
