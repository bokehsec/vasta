import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSession, type ReviewSession } from './review-session.ts'

vi.mock('./api.ts', () => {
  class NetworkError extends Error {}
  return { authApi: { updateProfile: vi.fn().mockResolvedValue({}) }, NetworkError, api: {} }
})

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    data,
  }
}

/** Fresh copies of the modules over `storage`, as a page load would see them. */
async function load(storage = fakeStorage()) {
  vi.resetModules()
  vi.stubGlobal('localStorage', storage)
  const preferences = await import('./preferences.ts')
  const sessions = await import('./review-storage.ts')
  return { ...preferences, ...sessions, storage }
}

afterEach(() => vi.unstubAllGlobals())

const begin = (typeId: string, spaceId = 's1'): ReviewSession => startSession({ spaceId, typeId, viewId: 'v', viewName: 'Open tasks', kind: 'review', scope: 'view', scopeLabel: 'Open tasks' }, ['a', 'b'])

describe('a paused review is kept per type', () => {
  it('keeps one for each type, so a review of another type never replaces it', async () => {
    const { startPreferences, readSession, writeSession } = await load()
    startPreferences({ id: 'u1' })
    writeSession(begin('tasks'))
    writeSession(begin('books'))
    expect(readSession('s1', 'tasks')?.typeId).toBe('tasks')
    expect(readSession('s1', 'books')?.typeId).toBe('books')
    // Forgetting one leaves the other.
    writeSession(null, 'tasks')
    expect(readSession('s1', 'tasks')).toBeNull()
    expect(readSession('s1', 'books')).not.toBeNull()
  })

  it('is this person\'s alone and is offered only in its own space', async () => {
    const { startPreferences, stopPreferences, readSession, writeSession } = await load()
    startPreferences({ id: 'u1' })
    writeSession(begin('tasks'))
    expect(readSession('s2', 'tasks')).toBeNull()
    expect(readSession(undefined, 'tasks')).toBeNull()
    stopPreferences()
    startPreferences({ id: 'u2' })
    expect(readSession('s1', 'tasks')).toBeNull()
    stopPreferences()
    startPreferences({ id: 'u1' })
    expect(readSession('s1', 'tasks')?.ids).toEqual(['a', 'b'])
  })

  it('is on this device only, in the device preferences', async () => {
    const { startPreferences, writeSession, storage } = await load()
    startPreferences({ id: 'u1' })
    writeSession(begin('tasks'))
    expect(JSON.parse(storage.data.get('vasta.device.u1.type/tasks/review')!)).toMatchObject({ v: 1, typeId: 'tasks', ids: ['a', 'b'] })
  })

  it('reads nothing from a stored session of an older shape', async () => {
    const old = { ...begin('tasks'), userId: 'u1' } as Record<string, unknown>
    delete old.kind
    const { startPreferences, readSession } = await load(fakeStorage({ 'vasta.device.u1.type/tasks/review': JSON.stringify(old) }))
    startPreferences({ id: 'u1' })
    expect(readSession('s1', 'tasks')).toBeNull()
  })

  it('takes over the one session the device kept before, for its own type and person', async () => {
    const legacy = JSON.stringify({ ...begin('tasks'), userId: 'u1' })
    const { startPreferences, readSession, storage } = await load(fakeStorage({ 'vasta.review': legacy }))
    startPreferences({ id: 'u2' })
    // Another person's stays where it is for them.
    expect(readSession('s1', 'tasks')).toBeNull()
    expect(storage.data.has('vasta.review')).toBe(true)
    startPreferences({ id: 'u1' })
    expect(readSession('s1', 'tasks')?.ids).toEqual(['a', 'b'])
    expect(storage.data.has('vasta.review')).toBe(false)
  })
})
