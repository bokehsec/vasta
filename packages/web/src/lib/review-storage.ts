// Where a type's paused review is kept: a device preference of this person (preferences.ts), one
// per type, so a review of another type never replaces it. What a session holds is review-session.ts.
import type { Id } from '@vasta/core'
import { getPreference, setPreference } from './preferences.ts'
import { sessionKey, validSession, type ReviewSession } from './review-session.ts'

/** This type's paused review, if it has one in this space. */
export function readSession(spaceId: Id | undefined, typeId: Id): ReviewSession | null {
  const session = validSession(getPreference('device', sessionKey(typeId)))
  return session && session.spaceId === spaceId && session.typeId === typeId ? session : null
}

/** Keeps the review on this device, or forgets it (null: the type's). */
export function writeSession(session: ReviewSession | null, typeId = session?.typeId) {
  if (typeId) setPreference('device', sessionKey(typeId), session ?? undefined)
}
