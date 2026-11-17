// Quick capture: the phone's "Note / Type" picker works on the text's "/Type " prefix (read by
// typed-line.ts, so typing it by hand and picking it are the same) and offers the types you
// actually make; a text that was not saved is kept on this device (a device preference, per space), to come back
// at the next capture (also after a reload: QuickCapture writes it as you type and when the page
// is hidden).
import type { Id, ObjectRecord, ObjectType } from '@vasta/core'
import { getPreference, setPreference } from './preferences.ts'
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

const draftKey = (spaceId: Id) => `capture-draft/${spaceId}`

/** The draft kept for this space (on this device, for the person logged in), or ''. */
export function readDraft(spaceId: Id): string {
  const draft = getPreference('device', draftKey(spaceId))
  return typeof draft === 'string' ? draft : ''
}

/** Keep `text` as the draft; a blank one clears it. */
export function writeDraft(spaceId: Id, text: string): void {
  setPreference('device', draftKey(spaceId), text.trim() ? text : undefined)
}

export const clearDraft = (spaceId: Id): void => writeDraft(spaceId, '')
