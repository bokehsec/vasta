// Home is an ordinary page, remembered per person and space. Keep the choice separate from
// fetching and creating it, so a space's shared start page never becomes someone else's Home.
import { computed } from 'vue'
import { BODY_PROPERTY_ID, builtinTypeId, textToBlocks, type Id, type ObjectSummary, type Space } from '@vasta/core'
import { router } from '../router.ts'
import { createObject } from './actions.ts'
import { api } from './api.ts'
import { preference } from './preferences.ts'
import { session } from './session.ts'
import { lastError, workspace } from './state.ts'

type HomeObject = Pick<ObjectSummary, 'id' | 'spaceId' | 'deletedAt' | 'createdBy'>

/** A remembered page wins; only the maker may adopt the space's chosen start page. None: create. */
export function homePage(space: Pick<Space, 'id' | 'opensOn'>, remembered: HomeObject | undefined, opened: HomeObject | undefined, userId: Id): Id | undefined {
  const usable = (page: HomeObject | undefined): page is HomeObject => page?.spaceId === space.id && !page.deletedAt
  if (usable(remembered)) return remembered.id
  if (space.opensOn?.kind === 'object' && opened?.id === space.opensOn.id && usable(opened) && opened.createdBy === userId) return opened.id
}

const homePreference = (spaceId: () => Id | undefined) => preference<Id | undefined>(
  () => {
    const id = spaceId()
    return id ? `home/${id}` : undefined
  },
  undefined,
  { scope: 'account', parse: (value) => typeof value === 'string' && value ? value : undefined }
)
const currentHome = homePreference(() => workspace.space?.id)
export const myHomeId = computed(() => currentHome.value)

/** Share a lookup/create between the sidebar, the phone bar and the start page. */
const pending = new Map<string, Promise<Id>>()

export async function resolveHome(): Promise<Id | undefined> {
  const space = workspace.space
  const userId = session.user?.id
  if (!space || !userId) return
  const key = `${userId}/${space.id}`
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const home = homePreference(() => space.id)
  const resolve = async () => {
    const remembered = home.value
    const opened = space.opensOn?.kind === 'object' ? space.opensOn.id : undefined
    const ids = [...new Set([remembered, opened].filter((id): id is Id => !!id))]
    // A failed lookup is not a missing page: let the caller show the error rather than duplicate it.
    // Offline, a remembered Home still opens (the replica has it); only a new one waits for the server.
    const pages = ids.length ? await api.summaries(ids).catch((error) => { if (remembered) return null; throw error }) : []
    if (!pages) return remembered!
    const chosen = homePage(space, pages.find((page) => page.id === remembered), pages.find((page) => page.id === opened), userId)
    const id = chosen ?? (await createObject(builtinTypeId(space.id, 'page'), {
      title: 'Home',
      content: { [BODY_PROPERTY_ID]: { type: 'doc', content: textToBlocks('Your Home. Type / to add a query or embed a page.') } },
    }, false)).id
    // A lookup that finished after logout must not write into the next person's preferences.
    if (session.user?.id === userId) home.value = id
    return id
  }
  const promise = resolve()
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    pending.delete(key)
  }
}

export async function openHome() {
  const spaceId = workspace.space?.id
  const userId = session.user?.id
  try {
    const id = await resolveHome()
    if (id && workspace.space?.id === spaceId && session.user?.id === userId) await router.push(`/o/${id}`)
  } catch (error) {
    lastError.value = (error as Error).message
  }
}
