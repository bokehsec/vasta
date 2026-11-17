// The one way to change a type: say which of its fields change and to what. A save that sends the
// whole type would put back what another device, another dialog or an earlier save changed in
// fields it never meant to touch; a patch names only its own. The web app's queue (lib/type-patch.ts),
// the replica's store and the server's PATCH route all apply it here.
import type { ObjectType } from './model.ts'
import { PLAIN_FIELDS } from './sync.ts'

/** The fields of a type a patch may change (the type's synced fields, but not its trash state). */
export const TYPE_PATCH_FIELDS = PLAIN_FIELDS.types.filter((name) => name !== 'deletedAt') as readonly (keyof ObjectType & string)[]

/** Fields to set; null (or undefined, in the app) takes an optional field away. */
export type TypePatch = { [K in (typeof TYPE_PATCH_FIELDS)[number]]?: ObjectType[K] | null }

const REQUIRED = ['name', 'pluralName', 'properties', 'views']

/** The type with `patch` applied and `updatedAt` set; throws a message for a field that is not patchable or cannot be taken away. */
export function applyTypePatch(type: ObjectType, patch: TypePatch, at: string): ObjectType {
  const next: Record<string, unknown> = { ...type, updatedAt: at }
  for (const [field, value] of Object.entries(patch)) {
    if (!(TYPE_PATCH_FIELDS as readonly string[]).includes(field)) throw new Error(`a type's ${field} cannot be changed this way`)
    if (value === null || value === undefined) {
      if (REQUIRED.includes(field)) throw new Error(`a type needs its ${field}`)
      delete next[field]
    } else next[field] = value
  }
  return next as unknown as ObjectType
}
