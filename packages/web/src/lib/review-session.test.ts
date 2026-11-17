import { describe, expect, it } from 'vitest'
import { currentId, isFinished, moveBy, recordOutcome, sessionKey, skipCurrent, skippedSession, startSession, summarize, undoOutcome, validSession, workflowTitle, type ReviewSession } from './review-session.ts'

const scope = { spaceId: 's1', typeId: 't', viewId: 'v', viewName: 'Open tasks', kind: 'review' as const, scope: 'view' as const, scopeLabel: 'Open tasks' }
const begin = (ids: string[] = ['a', 'b', 'c']) => startSession(scope, ids)

describe('review session', () => {
  it('keeps the frozen scope when revisiting skipped work', () => {
    const workflow = { ...scope, kind: 'tasks' as const, scope: 'space' as const, scopeLabel: 'All tasks in Main', newCount: 1 }
    const session = skipCurrent(startSession(workflow, ['a', 'b']))
    expect(skippedSession(session)).toMatchObject({ ...workflow, ids: ['a'], index: 0, newCount: 1 })
    expect(workflowTitle(session)).toBe('Review tasks')
    expect(workflowTitle(begin())).toBe('Review this view')
  })

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

    it('stays on the object when told not to advance (a next step), the outcome recorded', () => {
      const session = recordOutcome(begin(), 'a', 'Next step', 0, false)
      expect(session.outcomes).toEqual({ a: 'Next step' })
      expect(session.index).toBe(0)
      expect(skipCurrent(session).skipped).toEqual([])
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

    it('counts how many of the skipped were new, in a Review tasks session', () => {
      let session = startSession({ ...scope, kind: 'tasks', newCount: 2 }, ['n1', 'n2', 'c1', 'c2'])
      session = skipCurrent(session)
      session = recordOutcome(session, 'n2', 'Next')
      session = skipCurrent(skipCurrent(session))
      const next = skippedSession(session)
      expect(next.ids).toEqual(['n1', 'c1', 'c2'])
      expect(next.newCount).toBe(1)
      expect(next.kind).toBe('tasks')
    })

    it('is empty when nothing was left skipped', () => {
      expect(skippedSession(begin()).ids).toEqual([])
    })
  })

  describe('reading a stored session', () => {
    const stored = (over: Partial<ReviewSession> = {}) => ({ ...begin(), ...over })

    it('is where the type keeps it', () => {
      expect(sessionKey('t1')).toBe('type/t1/review')
    })

    it('reads back what was written, with a decision and a scroll position', () => {
      const session = { ...recordOutcome(begin(), 'a', 'Done'), cards: { b: { scrollTop: 250 } } }
      expect(validSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
    })

    it('reads nothing from corrupt or foreign data', () => {
      expect(validSession(null)).toBeNull()
      expect(validSession('text')).toBeNull()
      expect(validSession(stored({ v: 2 as 1 }))).toBeNull()
      expect(validSession(stored({ ids: 'abc' as unknown as string[] }))).toBeNull()
      expect(validSession(stored({ cards: { b: { scrollTop: -1 } } }))).toBeNull()
    })

    it('reads nothing from a session with parts missing or out of range', () => {
      expect(validSession({ v: 1, spaceId: 's1', typeId: 't', ids: ['a'] })).toBeNull()
      expect(validSession(stored({ index: 99 }))).toBeNull()
      expect(validSession(stored({ outcomes: { a: 3 as unknown as string } }))).toBeNull()
      expect(validSession(stored({ newCount: 9 }))).toBeNull()
    })

    it('reads nothing from a session of an older shape: no kind or scope, or the retired Triage', () => {
      const { kind: _kind, ...noKind } = stored()
      expect(validSession(noKind)).toBeNull()
      const { scope: _scope, scopeLabel: _label, ...noScope } = stored()
      expect(validSession(noScope)).toBeNull()
      expect(validSession(stored({ kind: 'triage' as 'tasks' }))).toBeNull()
    })

    it('lets go of what older builds also saved', () => {
      const old = { ...stored(), userId: 'u1', fieldIds: ['status'], cards: { a: { scrollTop: 3, notesOpen: true } } }
      expect(validSession(old)).toEqual({ ...stored(), cards: { a: { scrollTop: 3 } } })
    })
  })
})
