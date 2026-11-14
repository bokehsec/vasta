// A review (ProcessMode): a view's open objects one at a time, in an order fixed when it starts.
// The session is ids and places only, never the objects' text: the review shows each object as it
// is now, so a change made elsewhere (its page, an Undo) is what it shows. It lives on this device
// (localStorage, one at a time), so closing the review, opening an object and coming back, or a
// reload, all return to the same object; it belongs to one user and space and is never offered to
// another. Each object counts once in the end's totals: its last outcome, taken off again by Undo.
import type { Id, QuickActionDef } from '@vasta/core'

export interface ReviewSession {
  v: 1
  userId: Id
  spaceId: Id
  typeId: Id
  viewId: string
  /** The view's name when it started, to say what is being reviewed. */
  viewName: string
  /** The objects, in the view's order when it started. */
  ids: Id[]
  /** The place: ids.length once past the last one (the end). */
  index: number
  /** The action name each object was last decided with (Done, Defer…). */
  outcomes: Record<Id, string>
  /** Objects moved past without a decision. */
  skipped: Id[]
  /** An object opened from the review: coming back to the list from it reopens the review there. */
  openedId?: Id
}

export const REVIEW_KEY = 'vasta.review'

export function startSession(scope: Pick<ReviewSession, 'userId' | 'spaceId' | 'typeId' | 'viewId' | 'viewName'>, ids: readonly Id[]): ReviewSession {
  return { v: 1, ...scope, ids: [...ids], index: 0, outcomes: {}, skipped: [] }
}

export const isFinished = (session: ReviewSession) => session.index >= session.ids.length
export const currentId = (session: ReviewSession): Id | undefined => session.ids[session.index]

/** Moves by `delta`, between the first object and the end; nothing is recorded. */
export function moveBy(session: ReviewSession, delta: number): ReviewSession {
  return { ...session, index: Math.max(0, Math.min(session.ids.length, session.index + delta)) }
}

/** Skips the current object: counted as skipped unless it was decided, once however often. */
export function skipCurrent(session: ReviewSession): ReviewSession {
  const id = currentId(session)
  if (!id) return session
  const skipped = session.outcomes[id] || session.skipped.includes(id) ? session.skipped : [...session.skipped, id]
  return moveBy({ ...session, skipped }, 1)
}

/** An action saved on `id` (the place it was run from, `at`): its outcome replaces any earlier one, and the review moves past it. */
export function recordOutcome(session: ReviewSession, id: Id, name: string, at = session.ids.indexOf(id)): ReviewSession {
  const next = { ...session, outcomes: { ...session.outcomes, [id]: name }, skipped: session.skipped.filter((s) => s !== id) }
  return at >= 0 && session.index === at ? moveBy(next, 1) : next
}

/**
 * Undo of an action on `id`: its outcome goes, if it is still that action's. The place stays; an
 * object already passed is left undecided, so it counts as skipped (and is in "Review skipped").
 */
export function undoOutcome(session: ReviewSession, id: Id, name: string): ReviewSession {
  if (session.outcomes[id] !== name) return session
  const outcomes = { ...session.outcomes }
  delete outcomes[id]
  const passed = session.ids.indexOf(id) < session.index && !session.skipped.includes(id)
  return { ...session, outcomes, skipped: passed ? [...session.skipped, id] : session.skipped }
}

/** The end's totals: each outcome with how many objects it was, in the order first used; and how many were skipped. */
export function summarize(session: ReviewSession): { outcomes: { name: string; count: number }[]; skipped: number } {
  const counts = new Map<string, number>()
  for (const id of session.ids) {
    const name = session.outcomes[id]
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return { outcomes: [...counts].map(([name, count]) => ({ name, count })), skipped: session.skipped.filter((id) => !session.outcomes[id]).length }
}

/** A new review of the objects skipped in this one, in the same order. */
export function skippedSession(session: ReviewSession): ReviewSession {
  const skipped = new Set(session.skipped.filter((id) => !session.outcomes[id]))
  const { userId, spaceId, typeId, viewId, viewName } = session
  return startSession({ userId, spaceId, typeId, viewId, viewName }, session.ids.filter((id) => skipped.has(id)))
}

/**
 * The actions a review shows as buttons, and the rest (in More): Done, Defer and the next step where
 * the type has them (by their ids, with the names and changes set up for them), then others in their
 * order up to three. Drop, which ends a task without doing it, is never one of the three. No action
 * is left out or made up.
 */
export function reviewActions(actions: readonly QuickActionDef[]): { featured: QuickActionDef[]; more: QuickActionDef[] } {
  const known = ['done', 'defer', 'next-step'].flatMap((id) => actions.filter((a) => a.id === id))
  const featured = [...known, ...actions.filter((a) => !known.includes(a) && a.id !== 'drop')].slice(0, 3)
  return { featured, more: actions.filter((a) => !featured.includes(a)) }
}

/** The stored review, if it is this user's in this space; another user's is forgotten. */
export function readSession(userId: Id | undefined, spaceId: Id | undefined, storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = safeStorage()): ReviewSession | null {
  if (!storage || !userId || !spaceId) return null
  let session: ReviewSession | null = null
  try {
    session = JSON.parse(storage.getItem(REVIEW_KEY) ?? 'null') as ReviewSession | null
  } catch {}
  session = valid(session)
  if (!session) return null
  if (session.userId !== userId) {
    try {
      storage.removeItem(REVIEW_KEY)
    } catch {}
    return null
  }
  return session.spaceId === spaceId ? session : null
}

/** Keeps the review on this device, or forgets it (null). */
export function writeSession(session: ReviewSession | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()) {
  try {
    if (session) storage?.setItem(REVIEW_KEY, JSON.stringify(session))
    else storage?.removeItem(REVIEW_KEY)
  } catch {}
}

/** A stored session as written, or null: anything missing or of another shape (an older version, damage) is not offered. */
function valid(data: unknown): ReviewSession | null {
  const s = data as Partial<ReviewSession> | null
  if (!s || typeof s !== 'object' || s.v !== 1) return null
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((x) => typeof x === 'string')
  if (![s.userId, s.spaceId, s.typeId, s.viewId, s.viewName].every((x) => typeof x === 'string') || !strings(s.ids) || !strings(s.skipped)) return null
  if (typeof s.index !== 'number' || !Number.isInteger(s.index) || s.index < 0 || s.index > s.ids.length) return null
  if (!s.outcomes || typeof s.outcomes !== 'object' || Object.values(s.outcomes).some((x) => typeof x !== 'string')) return null
  return s as ReviewSession
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
