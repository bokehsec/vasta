// Quick capture on a phone: the "Note / Type" picker works on the text's "/Type " prefix (read by
// typed-line.ts, so typing it by hand and picking it are the same), and a text that was not saved
// is kept on this device, per user and space, to come back at the next capture.
import type { Id, ObjectType } from '@vasta/core'
import { typedLine } from './typed-line.ts'

/** `text` with its "/Type " prefix replaced by `type`'s (none: removed), keeping what follows it. */
export function withType(types: ObjectType[], text: string, type?: ObjectType): string {
  const body = typedLine(types, text)?.rest ?? text
  return type ? `/${type.name} ${body}` : body
}

/** What the user wrote, without a type prefix: empty when only a type was picked. */
export const writtenText = (types: ObjectType[], text: string): string => (typedLine(types, text)?.rest ?? text).trim()

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
