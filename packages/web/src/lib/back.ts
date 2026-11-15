// On a phone, Back (the browser's button, the edge swipe, the Home Screen app's gesture) closes
// what is open over the page (a sheet, a full-screen dialog, Triage, the side menu) instead of
// leaving the page under it. Each of them says here while it is open; router.ts asks on Back and
// cancels the navigation when something closed, so the history and the page stay where they were.
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
