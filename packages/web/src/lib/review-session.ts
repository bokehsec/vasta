// A review (ProcessMode): a view's open objects one at a time, in an order fixed when it starts.
// The session is ids and places only, never the objects' text: the review shows each object as it
// is now, so a change made elsewhere (its page, an Undo) is what it shows. It lives on this device
// (a device preference of this person, kept by use-review-session.ts), one paused session per type (a type is in
// one space), so closing the review, opening an object and coming back, or a reload, all return to
// the same object, and a review of one type never replaces another's. Each object counts once in
// the end's totals: its last outcome, taken off again by Undo.
import type { Id } from '@vasta/core'

/** `tasks`: Review tasks, the new ones first and then those due for a check-in; `review`: a view's open objects of any other type. */
export type ReviewKind = 'tasks' | 'review'

export interface ReviewSession {
  v: 1
  spaceId: Id
  typeId: Id
  viewId: string
  /** The view's name when it started, to say what is being reviewed. */
  viewName: string
  /** The objects, in the order it started with. */
  ids: Id[]
  /** The place: ids.length once past the last one (the end). */
  index: number
  /** The action name each object was last decided with (Done, Defer…). */
  outcomes: Record<Id, string>
  /** Objects moved past without a decision. */
  skipped: Id[]
  /** An object opened from the review: coming back to the list from it reopens the review there. */
  openedId?: Id
  kind: ReviewKind
  /** Where its check-ins came from: the view it started in, or the whole space ("Review all"). */
  scope: 'space' | 'view'
  /** What it covers, in words: the view's name and what narrowed it, or all tasks in the space. */
  scopeLabel: string
  /** A `tasks` review: how many of the ids, at the start, were new when it began. */
  newCount?: number
  /** Where each card was scrolled to: survives Pause and Open details. */
  cards?: Record<Id, { scrollTop: number }>
}

export type ReviewScope = Pick<ReviewSession, 'spaceId' | 'typeId' | 'viewId' | 'viewName' | 'kind' | 'scope' | 'scopeLabel' | 'newCount'>

export function startSession(scope: ReviewScope, ids: readonly Id[]): ReviewSession {
  return { v: 1, ...scope, ids: [...ids], index: 0, outcomes: {}, skipped: [] }
}

export const workflowTitle = (session: ReviewSession) => (session.kind === 'tasks' ? 'Review tasks' : 'Review this view')

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

/**
 * An action saved on `id` (the place it was run from, `at`): its outcome replaces any earlier one,
 * and the review moves past it unless `advance` is false (a next step: still the object at hand).
 */
export function recordOutcome(session: ReviewSession, id: Id, name: string, at = session.ids.indexOf(id), advance = true): ReviewSession {
  const next = { ...session, outcomes: { ...session.outcomes, [id]: name }, skipped: session.skipped.filter((s) => s !== id) }
  return advance && at >= 0 && session.index === at ? moveBy(next, 1) : next
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
  const { ids, index: _, outcomes: __, skipped: ___, openedId: ____, cards: _____, v: ______, newCount, ...scope } = session
  const left = ids.filter((id) => skipped.has(id))
  return startSession(newCount === undefined ? scope : { ...scope, newCount: ids.slice(0, newCount).filter((id) => skipped.has(id)).length }, left)
}

/** Where a type's paused review is kept (what belongs to the type first, so deleting it drops it). */
export const sessionKey = (typeId: Id) => `type/${typeId}/review`

/** A stored session as written, or null: anything missing or of another shape (an older version, damage) is not offered. */
export function validSession(data: unknown): ReviewSession | null {
  const s = data as Partial<ReviewSession> | null
  if (!s || typeof s !== 'object' || s.v !== 1) return null
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((x) => typeof x === 'string')
  if (![s.spaceId, s.typeId, s.viewId, s.viewName, s.scopeLabel].every((x) => typeof x === 'string') || !strings(s.ids) || !strings(s.skipped)) return null
  if (typeof s.index !== 'number' || !Number.isInteger(s.index) || s.index < 0 || s.index > s.ids.length) return null
  if (!s.outcomes || typeof s.outcomes !== 'object' || Object.values(s.outcomes).some((x) => typeof x !== 'string')) return null
  if (s.kind !== 'tasks' && s.kind !== 'review') return null
  if (s.scope !== 'space' && s.scope !== 'view') return null
  if (s.newCount !== undefined && (!Number.isInteger(s.newCount) || s.newCount < 0 || s.newCount > s.ids.length)) return null
  if (s.cards !== undefined && (!s.cards || typeof s.cards !== 'object' || Object.values(s.cards).some((c) => !c || !Number.isFinite(c.scrollTop) || c.scrollTop < 0))) return null
  // Only what the session is made of: what older builds also saved (fields, notes open) is let go.
  return {
    v: 1, spaceId: s.spaceId!, typeId: s.typeId!, viewId: s.viewId!, viewName: s.viewName!, ids: s.ids, index: s.index, outcomes: s.outcomes, skipped: s.skipped,
    ...(typeof s.openedId === 'string' ? { openedId: s.openedId } : {}), kind: s.kind, scope: s.scope, scopeLabel: s.scopeLabel!,
    ...(s.newCount !== undefined ? { newCount: s.newCount } : {}),
    ...(s.cards ? { cards: Object.fromEntries(Object.entries(s.cards).map(([id, c]) => [id, { scrollTop: c.scrollTop }])) } : {}),
  }
}
