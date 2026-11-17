// The localStorage keys the app used before preferences.ts, and where their values go now. Read
// once when the browser or the account starts (migrateLegacy…), each recognised key is converted,
// stored under its new name and removed. Delete this file once every device has started a build
// that has it; nothing else reads the old names.
import type { PreferenceScope } from './preferences.ts'
import { sessionKey, validSession } from './review-session.ts'

export interface Converted {
  scope: PreferenceScope
  key: string
  value: unknown
}

type Parse = (raw: string) => unknown
const flag: Parse = (raw) => raw === '1'
const text: Parse = (raw) => raw
const json: Parse = (raw) => JSON.parse(raw)
const number: Parse = (raw) => (Number.isFinite(Number(raw)) && raw.trim() ? Number(raw) : undefined)

/** Keys that were one name for the whole browser. */
const FIXED: Record<string, [PreferenceScope, string, Parse]> = {
  'vasta.theme': ['browser', 'theme', text],
  'vasta.block-spacing': ['browser', 'block-spacing', text],
  'vasta.type-icons': ['browser', 'type-icons', text],
  'vasta.icons': ['browser', 'icons', json],
  'vasta.people': ['browser', 'people', json],
  'vasta.board-tools': ['browser', 'board/tools', json],
  'vasta.space': ['device', 'last-space', text],
  'vasta.page-width': ['device', 'page-width', text],
  'vasta.pane-width': ['device', 'pane-width', number],
  'vasta.sidebar-collapsed': ['device', 'sidebar-collapsed', flag],
  'vasta.capture-asks': ['device', 'capture/asks', flag],
  'vasta.capture-daily': ['device', 'capture/daily', flag],
  'vasta.capture-inbox': ['device', 'capture/inbox', flag],
  'vasta.board-draw-mode': ['device', 'board/draw-mode', text],
  'vasta.board-details': ['device', 'board/details', flag],
  'vasta.tips.hidden': ['account', 'tips/hidden', flag],
  'vasta.tips.swipe': ['account', 'tips/swipe', flag],
  'vasta.inbox.showDone': ['account', 'inbox/show-done', flag],
  'vasta.nutrition-range': ['account', 'nutrition/range', number],
  'vasta.tags.folded': ['account', 'tags/folded', json],
  'vasta.calendar.view': ['account', 'calendar/view', text],
  'vasta.calendar.hidden': ['account', 'calendar/hidden', json],
  'vasta.calendar.showClosed': ['account', 'calendar/show-closed', flag],
  'vasta.calendar.panel': ['account', 'calendar/panel', flag],
  'vasta.calendar.createType': ['account', 'calendar/create-type', text],
}

/** A fold scope as it was written (JSON of ['type', id, view], ['embed', parent, instance, object] or ['query', id]) as the path of what it belongs to. */
function foldOwner(scope: unknown): string | undefined {
  let parts: unknown
  try { parts = typeof scope === 'string' ? JSON.parse(scope) : undefined } catch {}
  if (!Array.isArray(parts) || !parts.every((part) => typeof part === 'string' && part)) return undefined
  const [kind, ...ids] = parts as string[]
  if (kind === 'type' && ids.length === 2) return `type/${ids[0]}/view/${ids[1]}`
  if (kind === 'embed' && ids.length === 3) return `object/${ids[0]}/embed/${ids[1]}/${ids[2]}`
  if (kind === 'query' && ids.length === 1) return `object/${ids[0]}/query`
  return undefined
}

/** Keys with an id in their name; those that named a person belong to that person's account only. */
function pattern(name: string, user: string): [PreferenceScope, string, Parse] | undefined {
  let m: RegExpMatchArray | null
  if ((m = name.match(/^vasta\.view\.(.+)$/))) return ['account', `type/${m[1]}/last-view`, text]
  if ((m = name.match(/^vasta\.mine\.(.+)$/))) return ['account', `type/${m[1]}/mine`, flag]
  if ((m = name.match(/^vasta\.phoneTable\.([^.]+)\.(.+)$/))) return ['account', `type/${m[1]}/view/${m[2]}/phone-table`, flag]
  if ((m = name.match(/^vasta\.phone-menu:(.+)$/))) return m[1] === user ? ['account', 'phone-menu', json] : undefined
  if ((m = name.match(/^vasta\.board-camera\.(.+)$/))) return ['device', `board/${m[1]}/camera`, json]
  if ((m = name.match(/^vasta\.capture-draft\.([^.]+)\.(.+)$/))) return m[1] === user ? ['device', `capture-draft/${m[2]}`, text] : undefined
  if (name.startsWith('vasta.group-folds:')) {
    let parts: unknown
    try { parts = JSON.parse(name.slice('vasta.group-folds:'.length)) } catch {}
    if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== user || typeof parts[3] !== 'string') return undefined
    const owner = foldOwner(parts[2])
    return owner ? ['account', `${owner}/folds/${parts[3]}`, json] : undefined
  }
  return undefined
}

/** The one paused review the device kept, now one per type: kept if it is this person's and of the current shape. */
function legacyReview(raw: string, user: string): Converted | undefined {
  try {
    const data = JSON.parse(raw) as { userId?: unknown }
    const session = validSession(data)
    return session && data.userId === user ? { scope: 'device', key: sessionKey(session.typeId), value: session } : undefined
  } catch {
    return undefined
  }
}

/** What the old key `name` holding `raw` means now; undefined when it is not one of the old keys, is another account's, or holds nothing usable. */
export function convertLegacy(name: string, raw: string, user: string): Converted | undefined {
  if (name === 'vasta.review') return legacyReview(raw, user)
  const found = FIXED[name] ?? pattern(name, user)
  if (!found) return undefined
  const [scope, key, parse] = found
  try {
    const value = parse(raw)
    return value === undefined ? undefined : { scope, key, value }
  } catch {
    return undefined
  }
}

/** Whether `name` is one of the old keys of the whole browser (read before anyone has logged in). */
export const isBrowserLegacy = (name: string) => FIXED[name]?.[0] === 'browser'
