// Many objects at once: one selection in the app at a time, held by the list or table that made it
// (its key). Desktop: a box at the start of a row (on hover, always while anything is selected),
// Shift-click for the range between, in the order drawn. Phone: "Select" in a row's long-press menu
// starts selection mode, where a tap picks a row. The bulk bar (BulkBar, App.vue) acts on it.
// Escape, leaving the page, or the collection going away clears it.
import { computed, reactive } from 'vue'
import type { Id, ObjectRecord, ObjectSummary } from '@vasta/core'
import { api } from './api.ts'
import type { MenuItem } from './overlays.ts'
import { restoreObjectFlow } from './actions.ts'
import { forgetSummary, lastError, notice, refreshCounts } from './state.ts'

export interface SelectionOwner {
  /** The collection's rows in the order drawn (for ranges), and all its objects (Select all). */
  drawn: () => ObjectSummary[]
  all: () => ObjectSummary[]
  /** Hears an object saved from the bar, as the collection's own saves do. */
  moved: (object: ObjectRecord) => void
  /** Hears objects moved to the trash (or back), so the collection can drop or keep them. */
  trashed?: (ids: Id[]) => void
}

export const selection = reactive({
  key: '' as string,
  ids: new Set<Id>(),
  /** Phone: taps pick rows instead of opening them. */
  mode: false,
  /** The last row picked, where a Shift-click's range starts. */
  anchor: '' as Id,
})
let owner: SelectionOwner | undefined

export const selecting = computed(() => selection.ids.size > 0 || selection.mode)
export const isSelecting = (key: string) => selection.key === key && selecting.value
export const isSelected = (key: string, id: Id) => selection.key === key && selection.ids.has(id)

export function clearSelection() {
  selection.key = ''
  selection.ids = new Set()
  selection.mode = false
  selection.anchor = ''
  owner = undefined
}

function own(key: string, by: SelectionOwner) {
  if (selection.key !== key) {
    clearSelection()
    selection.key = key
  }
  owner = by
}

/** Picks or drops one row; with `range`, every row drawn between the last one picked and this one. */
export function toggleSelected(key: string, id: Id, by: SelectionOwner, range = false) {
  own(key, by)
  const ids = new Set(selection.ids)
  if (range && selection.anchor) {
    const order = by.drawn().map((o) => o.id)
    const a = order.indexOf(selection.anchor)
    const b = order.indexOf(id)
    if (a >= 0 && b >= 0) for (const between of order.slice(Math.min(a, b), Math.max(a, b) + 1)) ids.add(between)
    else ids.add(id)
  } else if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  selection.ids = ids
  selection.anchor = id
  if (!ids.size && !selection.mode) clearSelection()
}

/** Phone: selection mode from a row's menu, with that row picked. */
export function startSelecting(key: string, id: Id, by: SelectionOwner) {
  own(key, by)
  selection.mode = true
  selection.ids = new Set([id])
  selection.anchor = id
}

// The collection whose row menu opened last, so the menu's "Select" knows where it belongs.
let menuOwner: { key: string; by: SelectionOwner } | undefined
export function rememberMenuOwner(key: string, by: SelectionOwner) {
  menuOwner = { key, by }
}
/** "Select" for a row's menu (a long press on a phone): selection mode with that row picked. */
export function selectMenuItem(id: Id): MenuItem[] {
  const from = menuOwner
  // Only for a row of that collection (a board card's menu has no row to pick).
  if (!from || !from.by.all().some((o) => o.id === id)) return []
  return [{ label: 'Select', icon: 'ph:check-square', run: () => startSelecting(from.key, id, from.by) }]
}

export function selectAll() {
  if (!owner) return
  selection.ids = new Set(owner.all().map((o) => o.id))
}

/** The objects picked, as the owner has them now (gone ones left out). */
export function selectedObjects(): ObjectSummary[] {
  return owner ? owner.all().filter((o) => selection.ids.has(o.id)) : []
}
export const selectionOwner = () => owner

/** Moves the picked objects to the trash, with one Undo that brings them all back. */
export async function trashSelected() {
  const objects = selectedObjects()
  const by = owner
  if (!objects.length) return
  const gone: Id[] = []
  for (const object of objects) {
    try {
      await api.deleteObject(object.id)
      forgetSummary(object.id)
      gone.push(object.id)
    } catch (error) {
      lastError.value = (error as Error).message
    }
  }
  void refreshCounts()
  by?.trashed?.(gone)
  clearSelection()
  notice.value = {
    message: `Moved ${gone.length === 1 ? '1 object' : `${gone.length} objects`} to the trash`,
    action: {
      label: 'Undo',
      run: async () => {
        for (const id of gone) await restoreObjectFlow(id).catch((error: Error) => (lastError.value = error.message))
      },
    },
  }
}

// Escape clears it (unless something above it, a menu or a dialog, takes the key first).
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selecting.value && !event.defaultPrevented) clearSelection()
  })
}
