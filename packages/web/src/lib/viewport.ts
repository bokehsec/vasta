// Screen size and input kind, as reactive flags. "Phone" is below Tailwind's `md` breakpoint,
// where the sidebar becomes a drawer; "touch" is a device without hover (phones, tablets).
import { computed, ref } from 'vue'

function mediaFlag(query: string) {
  const flag = ref(false)
  if (typeof window === 'undefined' || !window.matchMedia) return flag
  const list = window.matchMedia(query)
  flag.value = list.matches
  list.addEventListener('change', (event) => (flag.value = event.matches))
  return flag
}

export const isPhone = mediaFlag('(max-width: 767px)')
export const isTouch = mediaFlag('(hover: none)')

/**
 * How far the on-screen keyboard (or anything else shrinking the visual viewport from below)
 * covers the page, in px; 0 when it is down. Sheets sit above it; the phone's bottom bar hides.
 * Pinch or focus zoom (scale other than 1) also moves and shrinks the visual viewport, but is not a
 * keyboard: it reads 0, so the bar is not hidden by a zoom.
 */
export const keyboardInset = ref(0)
if (typeof window !== 'undefined' && window.visualViewport) {
  const viewport = window.visualViewport
  const update = () => (keyboardInset.value = viewport.scale !== 1 ? 0 : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)))
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
}

/**
 * The tallest a bottom sheet may be: 80% of the screen, and never more than what the keyboard
 * leaves (less a margin), so a picker's search field stays on screen. dvh follows the toolbars.
 */
export const sheetMaxHeight = computed(() => `min(80dvh, calc(100dvh - ${keyboardInset.value}px - 1rem))`)
