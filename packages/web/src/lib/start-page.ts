// Where "/" goes: the page a space opens on (Space.opensOn), else the first sidebar item, else a welcome.
import type { Id, ObjectSummary, Space } from '@vasta/core'

export type StartPage = { kind: 'today' } | { kind: 'object'; id: Id } | { kind: 'type'; id: Id } | { kind: 'welcome' }

/**
 * `opened` is the object `opensOn` names, as looked up (undefined when it is gone). One that is gone,
 * in the trash or in another space falls back to the first sidebar item, then to the welcome.
 */
export function startPage(space: Pick<Space, 'id' | 'sidebar' | 'opensOn'>, opened: Pick<ObjectSummary, 'id' | 'spaceId' | 'deletedAt'> | undefined, isType: (id: Id) => boolean): StartPage {
  const on = space.opensOn
  if (on?.kind === 'today') return { kind: 'today' }
  if (on?.kind === 'object' && opened?.id === on.id && opened.spaceId === space.id && !opened.deletedAt) return { kind: 'object', id: on.id }
  const first = space.sidebar[0]?.items[0]
  if (!first) return { kind: 'welcome' }
  return isType(first) ? { kind: 'type', id: first } : { kind: 'object', id: first }
}
