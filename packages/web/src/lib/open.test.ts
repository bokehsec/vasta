import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// The router and the app's state stand in: only what open.ts reads of them.
const currentRoute = ref<{ path: string; params: Record<string, string>; query: Record<string, string>; hash: string; fullPath: string }>({ path: '/t/tasks', params: { id: 'tasks' }, query: {}, hash: '', fullPath: '/t/tasks' })
const historyState = { back: null as string | null, current: '/t/tasks' }
const router = {
  currentRoute,
  options: { history: { state: historyState } },
  resolve: (to: { query?: Record<string, string>; path?: string }) => ({ fullPath: `${to.path ?? currentRoute.value.path}${to.query && Object.keys(to.query).length ? `?${new URLSearchParams(to.query)}` : ''}` }),
  push: vi.fn(async () => undefined),
  replace: vi.fn(async () => undefined),
  back: vi.fn(),
}
vi.mock('../router.ts', () => ({ router, closingOverlay: { pane: false, popup: false } }))
vi.mock('./state.ts', () => ({ lastError: { value: '' }, notice: { value: null }, summaryOf: (id: string) => (id === 'note' ? { typeId: 'page' } : id === 'task' ? { typeId: 'tasks' } : id === 'book' ? { typeId: 'books' } : undefined), typesById: { value: new Map([['page', { id: 'page' }], ['tasks', { id: 'tasks' }], ['books', { id: 'books', openIn: 'page' }], ['wiki', { id: 'wiki', openIn: 'pane' }]]) } }))
vi.mock('./viewport.ts', () => ({ isPhone: { value: false } }))

const { closePane, closePopup, expandPane, expandPopup, objectRoute, resolvePlace } = await import('./open.ts')

const at = (path: string, query: Record<string, string> = {}, id = '') => {
  const fullPath = `${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
  currentRoute.value = { path, params: id ? { id } : {}, query, hash: '', fullPath }
  historyState.current = fullPath
}

describe('resolvePlace', () => {
  it('opens a page by default and a popup where asked', () => {
    expect(resolvePlace('x', undefined, false, undefined)).toBe('page')
    expect(resolvePlace('x', 'popup', false, undefined)).toBe('popup')
    expect(resolvePlace('x', 'popup', true, undefined)).toBe('popup')
  })
  it('gives a phone no pane: it opens the page', () => {
    expect(resolvePlace('x', 'pane', false, undefined)).toBe('pane')
    expect(resolvePlace('x', 'pane', true, undefined)).toBe('page')
  })
  it('stays on the page of the object that is already open', () => {
    expect(resolvePlace('x', 'popup', false, 'x')).toBe('page')
    expect(resolvePlace('x', 'pane', false, 'x')).toBe('page')
    expect(resolvePlace('y', 'popup', false, 'x')).toBe('popup')
  })
  it("'type' is the window on a phone unless the type says otherwise, and the page on a desktop", () => {
    expect(resolvePlace('x', 'type', true, undefined, 'popup')).toBe('popup')
    expect(resolvePlace('x', 'type', true, undefined, 'page')).toBe('page')
    // A type that opens in the side pane has no pane on a phone.
    expect(resolvePlace('x', 'type', true, undefined, 'pane')).toBe('page')
    expect(resolvePlace('x', 'type', false, undefined, 'popup')).toBe('page')
    expect(resolvePlace('x', 'type', true, 'x', 'popup')).toBe('page')
  })
  it("reads the type's own Open in setting, a window by default", () => {
    expect(resolvePlace('task', 'type', true, undefined)).toBe('popup')
    expect(resolvePlace('book', 'type', true, undefined)).toBe('page')
    expect(resolvePlace('unknown', 'type', true, undefined)).toBe('popup')
  })
})

describe('closing the window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    historyState.back = null
  })

  it('goes back when the entry before is the same page without the window', async () => {
    at('/t/tasks', { popup: 'a' })
    historyState.back = '/t/tasks'
    await closePopup()
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('replaces the entry when the window was the first thing opened (nothing to go back to)', async () => {
    at('/t/tasks', { popup: 'a' })
    historyState.back = null
    await closePopup()
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('replaces the entry when the one before is another page', async () => {
    at('/t/tasks', { popup: 'a' })
    historyState.back = '/calendar'
    await closePopup()
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledTimes(1)
  })

  it('keeps the rest of the address when it replaces', async () => {
    at('/t/tasks', { view: 'v1', popup: 'a' })
    await closePopup()
    expect(router.replace).toHaveBeenCalledWith({ query: { view: 'v1' }, hash: '' })
  })

  it('always replaces when asked (the window gives way to the page it is on)', async () => {
    at('/t/tasks', { popup: 'a' })
    historyState.back = '/t/tasks'
    await closePopup(true)
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a window', async () => {
    at('/t/tasks')
    await closePopup()
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('the pane closes the same way', async () => {
    at('/t/tasks', { pane: 'a' })
    historyState.back = '/t/tasks'
    await closePane()
    expect(router.back).toHaveBeenCalledTimes(1)
  })
})

describe('Open full page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes the place of the window in history, so one Back returns to the list', () => {
    at('/t/tasks', { popup: 'a', popupBlock: 'b1' })
    void expandPopup()
    expect(router.replace).toHaveBeenCalledWith(objectRoute('a', { block: 'b1' }))
    expect(router.push).not.toHaveBeenCalled()
  })

  it('and the pane', () => {
    at('/t/tasks', { pane: 'a' })
    void expandPane()
    expect(router.replace).toHaveBeenCalledWith(objectRoute('a'))
    expect(router.push).not.toHaveBeenCalled()
  })
})
