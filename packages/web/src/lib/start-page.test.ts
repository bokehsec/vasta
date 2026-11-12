import { describe, expect, it } from 'vitest'
import type { Space } from '@vasta/core'
import { startPage } from './start-page.ts'

const space = (extra: Partial<Space> = {}, items: string[] = ['tasks-type', 'note-1']): Pick<Space, 'id' | 'sidebar' | 'opensOn'> => ({
  id: 's',
  sidebar: [{ id: 'pinned', name: 'Pinned', items }],
  ...extra,
})
const isType = (id: string) => id.endsWith('-type')
const page = (extra: { id?: string; spaceId?: string; deletedAt?: string } = {}) => ({ id: 'plan', spaceId: 's', ...extra })

describe('the page a space opens on', () => {
  it('opens the first sidebar item when nothing is chosen, a type by its page and an object by its own', () => {
    expect(startPage(space(), undefined, isType)).toEqual({ kind: 'type', id: 'tasks-type' })
    expect(startPage(space({}, ['note-1']), undefined, isType)).toEqual({ kind: 'object', id: 'note-1' })
  })

  it('shows the welcome when there is nothing to open', () => {
    expect(startPage(space({}, []), undefined, isType)).toEqual({ kind: 'welcome' })
    expect(startPage({ id: 's', sidebar: [] }, undefined, isType)).toEqual({ kind: 'welcome' })
  })

  it('opens Today, whatever is pinned', () => {
    expect(startPage(space({ opensOn: { kind: 'today' } }), undefined, isType)).toEqual({ kind: 'today' })
    expect(startPage(space({ opensOn: { kind: 'today' } }, []), undefined, isType)).toEqual({ kind: 'today' })
  })

  it('opens the chosen page', () => {
    expect(startPage(space({ opensOn: { kind: 'object', id: 'plan' } }), page(), isType)).toEqual({ kind: 'object', id: 'plan' })
  })

  it('falls back to the first sidebar item when the page is gone, in the trash or not in this space', () => {
    const chosen = space({ opensOn: { kind: 'object', id: 'plan' } })
    const first = { kind: 'type', id: 'tasks-type' }
    expect(startPage(chosen, undefined, isType)).toEqual(first)
    expect(startPage(chosen, page({ deletedAt: '2026-11-01T00:00:00.000Z' }), isType)).toEqual(first)
    expect(startPage(chosen, page({ spaceId: 'other' }), isType)).toEqual(first)
    expect(startPage(chosen, page({ id: 'another' }), isType)).toEqual(first)
  })

  it('falls back to the welcome when the page is gone and nothing is pinned', () => {
    expect(startPage(space({ opensOn: { kind: 'object', id: 'plan' } }, []), undefined, isType)).toEqual({ kind: 'welcome' })
  })
})
