// Quick capture: the phone's "Note / Type" picker works on the text's "/Type " prefix (read by
// typed-line.ts, so typing it by hand and picking it are the same) and offers the types you
// actually make; a text that was not saved is kept on this device, per user and space, to come back
// at the next capture (also after a reload: QuickCapture writes it as you type and when the page
// is hidden).
import type { Id, ObjectRecord, ObjectType } from '@vasta/core'
import { typedLine } from './typed-line.ts'

/** `text` with its "/Type " prefix replaced by `type`'s (none: removed), keeping what follows it. */
export function withType(types: ObjectType[], text: string, type?: ObjectType): string {
  const body = typedLine(types, text)?.rest ?? text
  return type ? `/${type.name} ${body}` : body
}

/** What the user wrote, without a type prefix: empty when only a type was picked. */
export const writtenText = (types: ObjectType[], text: string): string => (typedLine(types, text)?.rest ?? text).trim()

/** How many types the picker shows before "More…". */
export const CHIPS = 4

/**
 * The types the picker shows first: the ones most of the `created` objects (made in the last 90
 * days) are of, `keep` at most, then the rest under "More…"; a type being used (`current`) stays in
 * sight. With nothing made lately, the first `keep` types in their order.
 */
export function usedTypes(types: ObjectType[], created: Pick<ObjectRecord, 'typeId'>[], current?: ObjectType, keep = CHIPS): { shown: ObjectType[]; more: ObjectType[] } {
  const counts = new Map<Id, number>()
  for (const { typeId } of created) counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  const ranked = types.filter((type) => counts.has(type.id)).sort((a, b) => counts.get(b.id)! - counts.get(a.id)!)
  const shown = ranked.length ? ranked.slice(0, keep) : types.slice(0, keep)
  if (current && !shown.includes(current) && types.includes(current)) shown.push(current)
  return { shown, more: types.filter((type) => !shown.includes(type)) }
}

const draftKey = (userId: Id, spaceId: Id) => `vasta.capture-draft.${userId}.${spaceId}`

/** The draft kept for this user and space, or ''. */
export function readDraft(userId: Id, spaceId: Id, storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    return storage.getItem(draftKey(userId, spaceId)) ?? ''
  } catch {
    return ''
  }
}

/** Keep `text` as the draft; a blank one clears it. */
export function writeDraft(userId: Id, spaceId: Id, text: string, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (text.trim()) storage.setItem(draftKey(userId, spaceId), text)
    else storage.removeItem(draftKey(userId, spaceId))
  } catch {
    // Storage blocked or full: the draft is lost, nothing else.
  }
}

export const clearDraft = (userId: Id, spaceId: Id, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void => writeDraft(userId, spaceId, '', storage)
