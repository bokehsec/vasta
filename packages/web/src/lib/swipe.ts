// How a finger's sideways swipe ends, for swiped rows (SwipeRow) and process mode's card. As on
// iOS a swipe is judged by where the finger lifted and how fast it was going: a short flick counts
// as much as a long drag, so a deliberate swipe does not spring back.

/** Pixels a finger moves before its touch is a swipe or a scroll. */
export const DECIDE = 10
/** Pixels a slow swipe moves to open a row (about a tenth of a phone), or to close an open one. */
export const OPEN = 40
/** Speed (px/ms, 400pt/s) from which a lift is a flick in its direction. */
export const FLICK = 0.4
/** A row's right swipe runs its action past this share of the row's width… */
export const RUN = 0.35
/** …or flicked past this share. */
const RUN_FLICK = 0.15
/** Process mode's card: dragged past this share of the screen, or flicked past OPEN. */
const CARD = 0.25
/** Only the moves this many ms before the lift count toward its speed. */
const WINDOW = 100

/** A finger's recent sideways positions, for its speed when it lifts. */
export function tracker() {
  let samples: { x: number; t: number }[] = []
  return {
    reset() {
      samples = []
    },
    add(x: number, t = performance.now()) {
      samples.push({ x, t })
      while (samples.length > 2 && t - samples[0]!.t > WINDOW) samples.shift()
    },
    /** px/ms when the finger lifts at `t`; 0 when it paused before lifting. */
    velocity(t = performance.now()) {
      const first = samples[0]
      const last = samples.at(-1)
      if (!first || !last || first === last || t - last.t > WINDOW) return 0
      return (last.x - first.x) / Math.max(last.t - first.t, 1)
    },
  }
}

const flickOf = (velocity: number) => (Math.abs(velocity) >= FLICK ? Math.sign(velocity) : 0)

/**
 * Where a swiped row goes when the finger lifts at `offset` (px, + right), having started at `base`
 * (0 closed, else where it was open, on the same side): its right action runs, or it opens on the
 * side it is on, or it closes.
 */
export function rowRelease(offset: number, base: number, velocity: number, width: number): 'run' | 'open' | 'close' {
  const side = Math.sign(offset)
  if (!side) return 'close'
  const flick = flickOf(velocity)
  if (side > 0 && (offset >= width * RUN || (flick > 0 && offset >= width * RUN_FLICK))) return 'run'
  if (flick) return flick === side ? 'open' : 'close'
  const opened = base === 0 ? Math.abs(offset) >= OPEN : Math.abs(offset) > Math.abs(base) - OPEN
  return opened ? 'open' : 'close'
}

/** Process mode's card let go at `dx`: 1 swiped right, -1 left, 0 springs back. */
export function cardRelease(dx: number, velocity: number, width: number): -1 | 0 | 1 {
  const side = Math.sign(dx) as -1 | 0 | 1
  if (Math.abs(dx) >= width * CARD) return side
  return flickOf(velocity) === side && Math.abs(dx) >= OPEN ? side : 0
}
