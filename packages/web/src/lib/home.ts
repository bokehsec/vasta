// Home is an ordinary page, remembered per person and space. Keep the choice separate from
// fetching and creating it, so a space's shared start page never becomes someone else's Home.
import { computed } from 'vue'
import { BODY_PROPERTY_ID, builtinTypeId, textToBlocks, type Doc, type DocNode, type Id, type ObjectSummary, type Space } from '@vasta/core'
import { router } from '../router.ts'
import { createObject } from './actions.ts'
import { api } from './api.ts'
import { preference } from './preferences.ts'
import { session } from './session.ts'
import { lastError, workspace } from './state.ts'

type HomeObject = Pick<ObjectSummary, 'id' | 'spaceId' | 'deletedAt' | 'createdBy'>

/**
 * A remembered page wins. The space's chosen start page is adopted by its maker, or by an owner when
 * an editor (an agent's account, say) made it for them; anyone else gets a copy. None: create.
 */
export function homePage(space: Pick<Space, 'id' | 'opensOn'>, remembered: HomeObject | undefined, opened: HomeObject | undefined, userId: Id, owners: ReadonlySet<Id> = new Set()): Id | undefined {
  const usable = (page: HomeObject | undefined): page is HomeObject => page?.spaceId === space.id && !page.deletedAt
  if (usable(remembered)) return remembered.id
  if (space.opensOn?.kind === 'object' && opened?.id === space.opensOn.id && usable(opened) && adopts(opened, userId, owners)) return opened.id
}

const adopts = (page: HomeObject, userId: Id, owners: ReadonlySet<Id>) =>
  page.createdBy === userId || (owners.has(userId) && !owners.has(page.createdBy ?? ''))

/** Rewrites only Query embeds, at any depth. Pages, block links and mentions keep their targets. */
export function copyHomeDoc(doc: Doc, queries: ReadonlyMap<Id, Id>): Doc {
  const copy = (node: DocNode): DocNode => ({
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs, ...(node.type === 'objectEmbed' && queries.has(String(node.attrs.objectId)) ? { objectId: queries.get(String(node.attrs.objectId)) } : {}) } } : {}),
    ...(node.content ? { content: node.content.map(copy) } : {}),
  })
  return { ...doc, content: doc.content.map(copy) }
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
    // Owners only matter for adopting the start page. Unknown (offline), nothing is made: an owner
    // must not end up with a copy of the page that should be theirs.
    const rememberedPage = pages.find((page) => page.id === remembered)
    const owners = opened && !(rememberedPage?.spaceId === space.id && !rememberedPage.deletedAt) ? new Set((await api.members(space.id)).filter((m) => m.role === 'owner').map((m) => m.userId)) : new Set<Id>()
    // Everything below writes into this space: stop if the person moved to another one meanwhile.
    const stillHere = () => {
      if (workspace.space?.id !== space.id || session.user?.id !== userId) throw new Error('Home was not set up: the space changed while it was being made.')
    }
    const chosen = homePage(space, pages.find((page) => page.id === remembered), pages.find((page) => page.id === opened), userId, owners)
    let id = chosen
    if (!id) {
      let content: Record<string, Doc> = { [BODY_PROPERTY_ID]: { type: 'doc' as const, content: textToBlocks('Your Home. Type / to add a query or embed a page.') } }
      const start = pages.find((page) => page.id === opened)
      if (start && start.spaceId === space.id && !start.deletedAt && !adopts(start, userId, owners)) {
        const source = await api.object(start.id)
        const targets = new Set<Id>()
        const visit = (node: DocNode) => {
          if (node.type === 'objectEmbed' && typeof node.attrs?.objectId === 'string') targets.add(node.attrs.objectId)
          node.content?.forEach(visit)
        }
        Object.values(source.content).forEach((doc) => doc.content.forEach(visit))
        const copies = new Map<Id, Id>()
        const queryType = builtinTypeId(space.id, 'query')
        const embedded = targets.size ? await api.summaries([...targets]) : []
        for (const target of embedded) {
          if (target.spaceId !== space.id || target.deletedAt || target.typeId !== queryType) continue
          const query = await api.object(target.id)
          stillHere()
          const copy = await createObject(queryType, { title: query.title, query: query.query }, false)
          copies.set(target.id, copy.id)
        }
        content = Object.fromEntries(Object.entries(source.content).map(([field, doc]) => [field, copyHomeDoc(doc, copies)]))
      }
      stillHere()
      id = (await createObject(builtinTypeId(space.id, 'page'), { title: 'Home', content }, false)).id
    }
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
