// The Back rule. On a phone Back (the browser's button, the edge swipe, the Home Screen app's
// gesture) must close what is open over the page, not change the page under it. Two kinds of
// overlay, each with one way of being closed by Back:
//   - Overlays kept in the address (?popup=, ?pane=, ?settings=) are part of history: Back pops
//     that entry, which closes them (lib/open.ts closes by going back, or replaces when the entry
//     before is another page). They never register here.
//   - Transient layers (sheets and menus, dialogs, the side drawer, Review, Capture, the quick
//     card, Search, a full-screen board) are not in the address. Each says here while it is open
//     with closesOnBack(); router.ts asks on Back and cancels the navigation when one closed, so
//     the history and the page stay where they were.
// A new overlay is one of the two: put it in the address if a link or a reload should bring it
// back, else register it. On a desktop Back is plain history, and App.vue closes the transient
// layers when the page changes.
import { onScopeDispose, watch, type WatchSource } from 'vue'

/** What is open, the last opened on top: each closes its own (or steps back inside itself). */
const layers: (() => void)[] = []

const remove = (layer: () => void) => {
  const at = layers.indexOf(layer)
  if (at >= 0) layers.splice(at, 1)
}

/** While `open` holds, Back calls `close` instead of leaving the page. Call it in a component's setup. */
export function closesOnBack(open: WatchSource<boolean>, close: () => void) {
  const layer = () => close()
  watch(
    open,
    (value) => {
      remove(layer)
      if (value) layers.push(layer)
    },
    { immediate: true }
  )
  onScopeDispose(() => remove(layer))
}

/**
 * Close the top layer for a Back. True when one was open: the navigation is then cancelled. A layer
 * that cannot close yet (an answer being saved) stays, and keeps the page too.
 */
export function closeTopLayer(): boolean {
  const layer = layers.at(-1)
  if (!layer) return false
  layer()
  return true
}
