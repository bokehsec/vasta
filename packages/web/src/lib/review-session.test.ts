import { describe, expect, it } from 'vitest'
import type { QuickActionDef } from '@vasta/core'
import { REVIEW_KEY, currentId, isFinished, moveBy, readSession, recordOutcome, reviewActions, skipCurrent, skippedSession, startSession, summarize, undoOutcome, writeSession, type ReviewSession } from './review-session.ts'

const scope = { userId: 'u1', spaceId: 's1', typeId: 't', viewId: 'v', viewName: 'Open tasks' }
const begin = (ids: string[] = ['a', 'b', 'c']) => startSession(scope, ids)
const action = (id: string): QuickActionDef => ({ id, name: id, changes: [] })
const idsOf = (actions: QuickActionDef[]) => actions.map((a) => a.id)

function fakeStorage(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[REVIEW_KEY, initial]])
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

describe('review session', () => {
  it('starts on the first object with a copy of the ids and nothing decided', () => {
    const ids = ['a', 'b', 'c']
    const session = startSession(scope, ids)
    ids.push('d')
    ids.reverse()
    expect(session).toMatchObject({ ...scope, v: 1, ids: ['a', 'b', 'c'], index: 0, outcomes: {}, skipped: [] })
    expect(currentId(session)).toBe('a')
    expect(isFinished(session)).toBe(false)
  })

  it('moves between the first object and the end, and nowhere past them', () => {
    const session = begin()
    expect(moveBy(session, -1).index).toBe(0)
    expect(moveBy(session, 2).index).toBe(2)
    expect(moveBy(session, 10).index).toBe(3)
    expect(moveBy(moveBy(session, 10), -1).index).toBe(2)
    const end = moveBy(session, 3)
    expect(isFinished(end)).toBe(true)
    expect(currentId(end)).toBeUndefined()
    expect(isFinished(moveBy(end, -1))).toBe(false)
  })

  describe('skipping', () => {
    it('moves on and counts the object as skipped', () => {
      const skipped = skipCurrent(begin())
      expect(skipped.index).toBe(1)
      expect(skipped.skipped).toEqual(['a'])
    })

    it('counts an object once however often it is skipped, Back and Skip again included', () => {
      let session = skipCurrent(begin())
      session = skipCurrent(moveBy(session, -1))
      session = skipCurrent(moveBy(session, -1))
      expect(session.skipped).toEqual(['a'])
      expect(session.index).toBe(1)
    })

    it('does not count an object that was decided', () => {
      const decided = recordOutcome(begin(), 'a', 'Done')
      const again = skipCurrent(moveBy(decided, -1))
      expect(again.skipped).toEqual([])
      expect(again.index).toBe(1)
      expect(again.outcomes).toEqual({ a: 'Done' })
    })

    it('does nothing at the end', () => {
      const end = moveBy(begin(), 3)
      expect(skipCurrent(end)).toBe(end)
    })
  })

  describe('recording an outcome', () => {
    it('moves on when it was run from the current place', () => {
      const session = recordOutcome(begin(), 'a', 'Done')
      expect(session.outcomes).toEqual({ a: 'Done' })
      expect(session.index).toBe(1)
    })

    it('stays where it is when run from another place', () => {
      const session = recordOutcome(moveBy(begin(), 2), 'a', 'Done')
      expect(session.outcomes).toEqual({ a: 'Done' })
      expect(session.index).toBe(2)
      expect(recordOutcome(begin(), 'a', 'Done', 1).index).toBe(0)
      expect(recordOutcome(begin(), 'b', 'Done', 0).index).toBe(1)
    })

    it('does not move for an object that is not in the review', () => {
      const session = recordOutcome(begin(), 'zzz', 'Done')
      expect(session.index).toBe(0)
      expect(session.outcomes).toEqual({ zzz: 'Done' })
    })

    it('replaces an earlier outcome of the same object', () => {
      const first = recordOutcome(begin(), 'a', 'Done')
      const second = recordOutcome(moveBy(first, -1), 'a', 'Defer')
      expect(second.outcomes).toEqual({ a: 'Defer' })
      expect(summarize(second).outcomes).toEqual([{ name: 'Defer', count: 1 }])
    })

    it('takes the object off the skipped', () => {
      const skipped = skipCurrent(begin())
      expect(skipped.skipped).toEqual(['a'])
      const decided = recordOutcome(skipped, 'a', 'Done')
      expect(decided.skipped).toEqual([])
      expect(decided.index).toBe(1)
    })

    it('leaves the session it was given as it was', () => {
      const session = begin()
      recordOutcome(session, 'a', 'Done')
      expect(session).toMatchObject({ index: 0, outcomes: {} })
    })
  })

  describe('undoing an outcome', () => {
    it('takes the outcome off and keeps the place', () => {
      const decided = recordOutcome(begin(), 'a', 'Done')
      const undone = undoOutcome(decided, 'a', 'Done')
      expect(undone.outcomes).toEqual({})
      expect(undone.index).toBe(1)
    })

    it('leaves a newer outcome when the undo is of an older action', () => {
      const first = recordOutcome(begin(), 'a', 'Done')
      const second = recordOutcome(moveBy(first, -1), 'a', 'Defer')
      const undone = undoOutcome(second, 'a', 'Done')
      expect(undone).toBe(second)
      expect(undone.outcomes).toEqual({ a: 'Defer' })
    })

    it('does nothing for an object without an outcome', () => {
      const session = begin()
      expect(undoOutcome(session, 'a', 'Done')).toBe(session)
    })
  })

  describe('summarizing', () => {
    it('counts each outcome once per object, in the order first used', () => {
      let session = begin(['a', 'b', 'c', 'd'])
      session = recordOutcome(session, 'a', 'Defer')
      session = recordOutcome(session, 'b', 'Done')
      session = recordOutcome(session, 'c', 'Defer')
      session = recordOutcome(session, 'd', 'Done')
      expect(summarize(session)).toEqual({
        outcomes: [
          { name: 'Defer', count: 2 },
          { name: 'Done', count: 2 },
        ],
        skipped: 0,
      })
    })

    it('counts skipped objects that were not decided afterwards', () => {
      let session = begin(['a', 'b', 'c'])
      session = skipCurrent(session)
      session = skipCurrent(session)
      session = recordOutcome(moveBy(session, -1), 'b', 'Done')
      expect(summarize(session)).toEqual({ outcomes: [{ name: 'Done', count: 1 }], skipped: 1 })
    })

    it('does not count an outcome of an object outside the review', () => {
      const session = recordOutcome(begin(), 'zzz', 'Done')
      expect(summarize(session).outcomes).toEqual([])
    })

    it('does not inflate the counts through repeated actions and undos', () => {
      let session = begin(['a', 'b'])
      for (let i = 0; i < 3; i++) {
        session = recordOutcome(moveBy(session, -2), 'a', 'Done')
        session = undoOutcome(session, 'a', 'Done')
        session = recordOutcome(moveBy(session, -2), 'a', 'Done')
        session = recordOutcome(moveBy(session, -2), 'a', 'Defer')
        session = skipCurrent(moveBy(session, -2))
      }
      expect(summarize(session)).toEqual({ outcomes: [{ name: 'Defer', count: 1 }], skipped: 0 })
      session = undoOutcome(session, 'a', 'Defer')
      expect(summarize(session)).toEqual({ outcomes: [], skipped: 1 })
    })
  })

  describe('reviewing the skipped', () => {
    it('is a fresh review of the undecided skipped objects, in their original order', () => {
      let session = begin(['a', 'b', 'c', 'd'])
      session = skipCurrent(session)
      session = skipCurrent(session)
      session = skipCurrent(session)
      session = recordOutcome(moveBy(session, -2), 'b', 'Done')
      session = { ...session, skipped: ['d', 'c', 'a', 'b'], openedId: 'c' }
      const next = skippedSession(session)
      expect(next).toEqual({ v: 1, ...scope, ids: ['a', 'c', 'd'], index: 0, outcomes: {}, skipped: [] })
      expect(next.openedId).toBeUndefined()
    })

    it('is empty when nothing was left skipped', () => {
      expect(skippedSession(begin()).ids).toEqual([])
    })
  })

  describe('choosing the buttons', () => {
    const stock = ['done', 'defer', 'drop', 'next-step'].map(action)

    it('features Done, Defer and the next step, and puts Drop under More', () => {
      const { featured, more } = reviewActions(stock)
      expect(idsOf(featured)).toEqual(['done', 'defer', 'next-step'])
      expect(idsOf(more)).toEqual(['drop'])
    })

    it('features Done, Defer and the next step in that order whatever the order set up', () => {
      const { featured } = reviewActions(['next-step', 'drop', 'defer', 'done'].map(action))
      expect(idsOf(featured)).toEqual(['done', 'defer', 'next-step'])
    })

    it('features the first three others of a type with its own actions, never Drop', () => {
      const { featured, more } = reviewActions(['drop', 'a', 'b', 'c', 'd'].map(action))
      expect(idsOf(featured)).toEqual(['a', 'b', 'c'])
      expect(idsOf(more)).toEqual(['drop', 'd'])
    })

    it('features all there are when fewer than three, and still not Drop', () => {
      const { featured, more } = reviewActions(['a', 'b', 'drop'].map(action))
      expect(idsOf(featured)).toEqual(['a', 'b'])
      expect(idsOf(more)).toEqual(['drop'])
      expect(reviewActions(['a', 'b'].map(action))).toEqual({ featured: ['a', 'b'].map(action), more: [] })
      expect(reviewActions([])).toEqual({ featured: [], more: [] })
    })

    it('adds a type\'s own actions after the known ones', () => {
      const { featured, more } = reviewActions(['done', 'waiting', 'drop'].map(action))
      expect(idsOf(featured)).toEqual(['done', 'waiting'])
      expect(idsOf(more)).toEqual(['drop'])
    })

    it('leaves no action out, whichever the set', () => {
      const sets = [stock, ['drop', 'a', 'b', 'c', 'd'].map(action), ['a', 'b', 'drop'].map(action), ['done', 'waiting', 'drop'].map(action), ['x', 'y', 'z', 'done', 'defer', 'next-step', 'drop'].map(action), []]
      for (const set of sets) {
        const { featured, more } = reviewActions(set)
        expect(featured.length).toBeLessThanOrEqual(3)
        expect([...idsOf(featured), ...idsOf(more)].sort()).toEqual(idsOf(set).sort())
      }
    })
  })

  describe('keeping it on the device', () => {
    const stored = (over: Partial<ReviewSession> = {}) => JSON.stringify({ ...begin(), ...over })

    it('reads back what was written', () => {
      const storage = fakeStorage()
      const session = recordOutcome(begin(), 'a', 'Done')
      writeSession(session, storage)
      expect(readSession('u1', 's1', storage)).toEqual(session)
    })

    it('reads nothing without a user or a space or storage', () => {
      const storage = fakeStorage(stored())
      expect(readSession(undefined, 's1', storage)).toBeNull()
      expect(readSession('u1', undefined, storage)).toBeNull()
      expect(readSession('u1', 's1', undefined)).toBeNull()
      expect(storage.items.has(REVIEW_KEY)).toBe(true)
    })

    it('reads nothing when there is nothing stored', () => {
      expect(readSession('u1', 's1', fakeStorage())).toBeNull()
    })

    it('forgets another user\'s review', () => {
      const storage = fakeStorage(stored())
      expect(readSession('u2', 's1', storage)).toBeNull()
      expect(storage.items.has(REVIEW_KEY)).toBe(false)
    })

    it('keeps the user\'s review for another space, and offers it there only', () => {
      const storage = fakeStorage(stored())
      expect(readSession('u1', 's2', storage)).toBeNull()
      expect(storage.items.has(REVIEW_KEY)).toBe(true)
      expect(readSession('u1', 's1', storage)?.ids).toEqual(['a', 'b', 'c'])
    })

    it('reads nothing from corrupt or foreign data', () => {
      expect(readSession('u1', 's1', fakeStorage('{not json'))).toBeNull()
      expect(readSession('u1', 's1', fakeStorage(stored({ v: 2 as 1 })))).toBeNull()
      expect(readSession('u1', 's1', fakeStorage(stored({ ids: 'abc' as unknown as string[] })))).toBeNull()
      expect(readSession('u1', 's1', fakeStorage('"text"'))).toBeNull()
    })

    it('reads nothing from a session with parts missing or out of range', () => {
      const partial = JSON.stringify({ v: 1, userId: 'u1', spaceId: 's1', typeId: 't', ids: ['a'] })
      expect(readSession('u1', 's1', fakeStorage(partial))).toBeNull()
      expect(readSession('u1', 's1', fakeStorage(stored({ index: 99 })))).toBeNull()
      expect(readSession('u1', 's1', fakeStorage(stored({ outcomes: { a: 3 as unknown as string } })))).toBeNull()
    })

    it('forgets the review when written as null', () => {
      const storage = fakeStorage(stored())
      writeSession(null, storage)
      expect(storage.items.has(REVIEW_KEY)).toBe(false)
    })

    it('does not throw when the storage does', () => {
      const broken = {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('full')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      }
      expect(readSession('u1', 's1', broken)).toBeNull()
      expect(() => writeSession(begin(), broken)).not.toThrow()
      expect(() => writeSession(null, broken)).not.toThrow()
      expect(readSession('u2', 's1', { getItem: () => stored(), removeItem: broken.removeItem })).toBeNull()
    })
  })
})
