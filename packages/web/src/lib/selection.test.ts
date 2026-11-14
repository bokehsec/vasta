import { describe, expect, it, vi } from 'vitest'
import type { ObjectSummary } from '@vasta/core'

// The selection reaches the server only to trash: stand in for the app's state and API.
vi.mock('./api.ts', () => ({ api: {} }))
vi.mock('./actions.ts', () => ({ restoreObjectFlow: vi.fn() }))
vi.mock('./state.ts', () => ({ forgetSummary: vi.fn(), lastError: { value: '' }, notice: { value: null }, refreshCounts: vi.fn() }))

const { clearSelection, dropSelected, fromTextField, isSelected, pruneSelection, selectAll, selectMenuItem, rememberMenuOwner, selectedObjects, selection, startSelecting, toggleSelected } = await import('./selection.ts')

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

  it('drops ids the collection no longer has, and ends when none are left', () => {
    clearSelection()
    let shown = objects
    const live = { ...owner, all: () => shown }
    toggleSelected('list', 'a', live)
    toggleSelected('list', 'c', live)
    shown = objects.filter((o) => o.id !== 'a')
    pruneSelection()
    expect([...selection.ids]).toEqual(['c'])
    shown = []
    pruneSelection()
    expect(selection.key).toBe('')
  })

  it('keeps selection mode on a phone when the picked rows are gone', () => {
    clearSelection()
    let shown = objects
    startSelecting('list', 'a', { ...owner, all: () => shown })
    shown = []
    pruneSelection()
    expect(selection.mode).toBe(true)
    expect(selection.ids.size).toBe(0)
  })

  it('selects all the rows drawn, leaving out closed ones when others are open', () => {
    clearSelection()
    const folded = { ...owner, drawn: () => objects.slice(0, 4), pickable: (o: ObjectSummary) => o.id !== 'b' }
    toggleSelected('list', 'e', folded)
    selectAll()
    expect([...selection.ids].sort()).toEqual(['a', 'c', 'd'])
    // Nothing open to pick: all of them, so the bar still has something.
    clearSelection()
    toggleSelected('list', 'a', { ...folded, pickable: () => false })
    selectAll()
    expect([...selection.ids].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes picked ids out one by one (the rows an action saved)', () => {
    clearSelection()
    toggleSelected('list', 'a', owner)
    toggleSelected('list', 'b', owner)
    dropSelected(['a'])
    expect([...selection.ids]).toEqual(['b'])
    dropSelected(['b'])
    expect(selection.key).toBe('')
  })

  it('leaves Escape to a text box', () => {
    const inside = (selector: string) => ({ closest: (s: string) => (s.includes(selector) ? {} : null) })
    expect(fromTextField(inside('textarea'))).toBe(true)
    expect(fromTextField(inside('select'))).toBe(true)
    expect(fromTextField(inside('[contenteditable="true"]'))).toBe(true)
    expect(fromTextField({ closest: () => null })).toBe(false)
    expect(fromTextField(null)).toBe(false)
  })
})
