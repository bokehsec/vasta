import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { keepsScroll } from './scroll-memory.ts'

type Route = { path: string; fullPath: string }
const route = (fullPath: string): Route => ({ path: fullPath.split('?')[0]!, fullPath })

/** A router with the parts keepsScroll reads: the history entry (position, current) and the guards. */
function fakeRouter(start: string) {
  const state = { position: 0, current: start }
  const before: ((to: Route) => void)[] = []
  const after: ((to: Route, from: Route, failure?: unknown) => void)[] = []
  let at = route(start)
  const router = {
    options: { history: { state } },
    get currentRoute() {
      return { value: at }
    },
    beforeEach: (fn: (to: Route) => void) => (before.push(fn), () => before.splice(before.indexOf(fn), 1)),
    afterEach: (fn: (to: Route, from: Route, failure?: unknown) => void) => (after.push(fn), () => after.splice(after.indexOf(fn), 1)),
  }
  /** A link or push: the history does not hold the target yet. */
  const push = (to: string) => navigate(to, state.position + 1, false)
  /** Back or Forward: the history already holds the entry being gone to. */
  const traverse = (to: string, position: number) => navigate(to, position, true)
  function navigate(to: string, position: number, traversing: boolean) {
    const target = route(to)
    if (traversing) state.current = to
    for (const fn of before) fn(target)
    const from = at
    at = target
    state.position = position
    state.current = to
    for (const fn of after) fn(target, from)
  }
  return { router: router as unknown as Router, push, traverse, listeners: before.length + after.length, guards: { before, after } }
}

/** A page element whose scroll is held at `limit` (how tall its content is so far). */
function fakeMain(limit = 5000) {
  const handlers = new Map<string, () => void>()
  let top = 0
  const element = {
    limit,
    get scrollTop() {
      return top
    },
    set scrollTop(value: number) {
      top = Math.min(value, element.limit)
    },
    addEventListener: (name: string, fn: () => void) => handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
  }
  return { element: element as unknown as HTMLElement, handlers, raw: element }
}

/** Lets the restore loop (animation frames) run. */
const frames = async (count = 3) => {
  for (let i = 0; i < count; i++) await vi.advanceTimersByTimeAsync(20)
}

describe('keepsScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens a new page at its top', async () => {
    const { router, push } = fakeRouter('/t/tasks')
    const main = fakeMain()
    keepsScroll(router, () => main.element)
    main.raw.scrollTop = 800
    push('/o/one')
    await frames()
    expect(main.raw.scrollTop).toBe(0)
  })

  it('brings Back to where the page was left, once the page is tall enough', async () => {
    const { router, push, traverse } = fakeRouter('/t/tasks')
    const main = fakeMain()
    keepsScroll(router, () => main.element)
    main.raw.scrollTop = 800
    push('/o/one')
    await frames()
    main.raw.scrollTop = 40
    traverse('/t/tasks', 0)
    await frames()
    expect(main.raw.scrollTop).toBe(800)
  })

  it('keeps each entry of the same page apart', async () => {
    const { router, push, traverse } = fakeRouter('/t/tasks')
    const main = fakeMain()
    keepsScroll(router, () => main.element)
    main.raw.scrollTop = 100
    push('/o/one')
    await frames()
    push('/t/tasks')
    await frames()
    expect(main.raw.scrollTop).toBe(0)
    main.raw.scrollTop = 600
    push('/o/two')
    await frames()
    traverse('/t/tasks', 2)
    await frames()
    expect(main.raw.scrollTop).toBe(600)
    traverse('/o/one', 1)
    await frames()
    traverse('/t/tasks', 0)
    await frames()
    expect(main.raw.scrollTop).toBe(100)
  })

  it('leaves the scroll alone when a page only changes its own query', async () => {
    const { router, push } = fakeRouter('/calendar?view=month&date=2026-11-01')
    const main = fakeMain()
    keepsScroll(router, () => main.element)
    main.raw.scrollTop = 300
    push('/calendar?view=month&date=2026-12-01')
    await frames()
    expect(main.raw.scrollTop).toBe(300)
  })

  it('a finger or the wheel takes over from a restore', async () => {
    const { router, push, traverse } = fakeRouter('/t/tasks')
    const main = fakeMain()
    keepsScroll(router, () => main.element)
    main.raw.scrollTop = 800
    push('/o/one')
    await frames()
    // The page is still short when Back arrives: the restore waits for it to grow, until touched.
    main.raw.limit = 100
    traverse('/t/tasks', 0)
    await frames()
    expect(main.raw.scrollTop).toBe(100)
    main.handlers.get('touchstart')?.()
    main.raw.limit = 5000
    await frames(5)
    expect(main.raw.scrollTop).toBe(100)
  })

  it('stops listening when told to', () => {
    const { router, guards } = fakeRouter('/')
    const stop = keepsScroll(router, () => null)
    expect(guards.before.length + guards.after.length).toBe(2)
    stop()
    expect(guards.before.length + guards.after.length).toBe(0)
  })

  it('does nothing without a page element', async () => {
    const { router, push, traverse } = fakeRouter('/')
    keepsScroll(router, () => null)
    push('/t/tasks')
    traverse('/', 0)
    await frames()
  })
})
