import { describe, expect, it, vi } from 'vitest'
import type { ObjectSummary } from '@vasta/core'

// The selection reaches the server only to trash: stand in for the app's state and API.
vi.mock('./api.ts', () => ({ api: {} }))
vi.mock('./actions.ts', () => ({ restoreObjectFlow: vi.fn() }))
vi.mock('./state.ts', () => ({ forgetSummary: vi.fn(), lastError: { value: '' }, notice: { value: null }, refreshCounts: vi.fn() }))

const { clearSelection, isSelected, selectAll, selectMenuItem, rememberMenuOwner, selectedObjects, selection, startSelecting, toggleSelected } = await import('./selection.ts')

const objects = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, typeId: 't' }) as ObjectSummary)
const owner = { drawn: () => objects, all: () => objects, moved: vi.fn() }

describe('selection', () => {
  it('picks and drops a row, and a Shift range in the order drawn either way', () => {
    clearSelection()
    toggleSelected('list', 'b', owner)
    toggleSelected('list', 'd', owner, true)
    expect([...selection.ids].sort()).toEqual(['b', 'c', 'd'])
    toggleSelected('list', 'a', owner, true)
    expect([...selection.ids].sort()).toEqual(['a', 'b', 'c', 'd'])
    toggleSelected('list', 'c', owner)
    expect(isSelected('list', 'c')).toBe(false)
  })

  it('belongs to one collection at a time: picking in another starts afresh', () => {
    clearSelection()
    toggleSelected('list', 'a', owner)
    toggleSelected('other', 'b', owner)
    expect(selection.key).toBe('other')
    expect([...selection.ids]).toEqual(['b'])
    expect(isSelected('list', 'a')).toBe(false)
  })

  it('ends when the last row is dropped, unless in selection mode', () => {
    clearSelection()
    toggleSelected('list', 'a', owner)
    toggleSelected('list', 'a', owner)
    expect(selection.key).toBe('')
    startSelecting('list', 'a', owner)
    toggleSelected('list', 'a', owner)
    expect(selection.mode).toBe(true)
    expect(selection.key).toBe('list')
  })

  it('selects all of the collection and lists the picked objects as it has them', () => {
    clearSelection()
    toggleSelected('list', 'a', owner)
    selectAll()
    expect(selectedObjects().map((o) => o.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('offers "Select" in a row menu only for a row of the collection that opened it', () => {
    clearSelection()
    rememberMenuOwner('list', owner)
    expect(selectMenuItem('c').map((i) => ('label' in i ? i.label : ''))).toEqual(['Select'])
    expect(selectMenuItem('zzz')).toEqual([])
  })
})
