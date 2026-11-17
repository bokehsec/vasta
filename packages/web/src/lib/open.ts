// Where an object opens: its own page (/o/<id>), the side pane next to the page that is showing
// (?pane=<id> on that page's address), or a window over the page (?popup=<id>; a sheet from the
// bottom on a phone). Everything that opens an object goes through here, so the choice is made in
// one place. The pane and the popup live in the address, so back/forward, reload and copied links
// bring them back; leaving the page closes them, and a page changing only its own query (the
// calendar's view and date) keeps them (the guard in router.ts). Back closes them, and closing
// them goes back too, never a step forward (closePopup; the Back rule is in lib/back.ts).
import { computed, type InjectionKey } from 'vue'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { Id } from '@vasta/core'
import { closingOverlay, router } from '../router.ts'
import { isPhone } from './viewport.ts'
import { lastError, notice, summaryOf, typesById } from './state.ts'

export type OpenPlace = 'page' | 'pane' | 'popup'
/** 'type' opens it where its type says (the window unless the type's Open in is another) on a phone, and on its page on a desktop. */
export type OpenWhere = OpenPlace | 'type'

export interface OpenOptions {
  /** A block of its text to scroll to (#b-<id>). */
  block?: Id | undefined
  /** Extra query for the page, such as `new` or `capture`. */
  query?: LocationQueryRaw
  /** 'pane' opens it next to the current page where there is room for one, 'popup' in a window
   * over what is showing; the default is its page. */
  where?: OpenWhere
  /** Replace the current history entry; a pane or popup already open is always replaced (see openObject). */
  replace?: boolean
}

export const objectPath = (id: Id) => `/o/${id}`

/** The route of an object's page, for links (they keep ⌘-click, middle click and "Copy link"). */
export function objectRoute(id: Id, options: Pick<OpenOptions, 'block' | 'query'> = {}): RouteLocationRaw {
  return { path: objectPath(id), ...(options.query ? { query: options.query } : {}), ...(options.block ? { hash: `#b-${options.block}` } : {}) }
}

/**
 * Puts text on the clipboard: the clipboard API, else the older copy command (the API is missing on
 * a plain-http address, such as the server's LAN address). False when neither worked.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const box = document.createElement('textarea')
    box.value = text
    box.readOnly = true
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
    document.body.append(box)
    try {
      box.select()
      box.setSelectionRange(0, text.length)
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      box.remove()
    }
  }
}

/**
 * "Copy link to page": <server>/o/<object-id> in the browser, vasta://o/<object-id> in the
 * desktop app. Shows a notice once copied. When the clipboard refuses, the link still gets out:
 * the share sheet where there is one (it has Copy), else a box with the link selected to copy by hand.
 */
export async function copyObjectLink(objectId: Id) {
  const path = `o/${objectId}`
  const link = '__TAURI_INTERNALS__' in window ? `vasta://${path}` : `${location.origin}/${path}`
  if (await copyText(link)) {
    notice.value = { message: 'Link to the page copied' }
    return
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url: link })
      return
    } catch (error) {
      // Closed without sharing: nothing more to do.
      if ((error as Error).name === 'AbortError') return
    }
  }
  try {
    window.prompt('Copy this link to the page', link)
  } catch {
    lastError.value = `Could not copy the link: ${link}`
  }
}

/**
 * Where a view (a type's view or a query) opens what is linked inside it, by id: its own choice,
 * else the type's of the object linked (a relation's chip included); undefined opens its page.
 * Provided by the collection, read by every ObjectLink inside it, whatever the layout.
 */
export const VIEW_OPENS: InjectionKey<(id: Id) => OpenPlace | undefined> = Symbol('view-opens')

/** The object in the side pane, if one is open. */
export const paneObjectId = computed(() => {
  const value = router.currentRoute.value.query.pane
  return typeof value === 'string' && value ? value : undefined
})
/** The block the pane scrolls to. */
export const paneBlockId = computed(() => {
  const value = router.currentRoute.value.query.paneBlock
  return typeof value === 'string' && value ? value : undefined
})

/** The object in the popup window, if one is open. */
export const popupObjectId = computed(() => {
  const value = router.currentRoute.value.query.popup
  return typeof value === 'string' && value ? value : undefined
})
/** The block the popup scrolls to. */
export const popupBlockId = computed(() => {
  const value = router.currentRoute.value.query.popupBlock
  return typeof value === 'string' && value ? value : undefined
})
/** Whether the popup's object is new (its title gets the cursor): `?popup=<id>&new=1`. */
export const popupIsNew = computed(() => router.currentRoute.value.query.new === '1')
/** Where a template put the cursor in the popup's text ("<block>:<offset>"). */
export const popupCursor = computed(() => {
  const value = router.currentRoute.value.query.cursor
  return typeof value === 'string' && value ? value : undefined
})

/** The object whose page is showing. */
export const pageObjectId = computed(() => {
  const route = router.currentRoute.value
  return route.path.startsWith('/o/') ? (route.params.id as string | undefined) : undefined
})

/** Whether an object is open, on its page, in the pane or in the popup. */
export const isOpen = (id: Id) => pageObjectId.value === id || paneObjectId.value === id || popupObjectId.value === id

/** Where a type opens its objects: its Open in setting, a window unless it says otherwise. */
const typeOpensOf = (id: Id): OpenPlace => typesById.value.get(summaryOf(id)?.typeId ?? '')?.openIn ?? 'popup'

/**
 * Where an object asked to open in the pane or the popup goes: phones have no room for a pane, and
 * the page of the same object is already showing it, so both open (or stay on) the page. A popup
 * has room everywhere, but not over the same object's page either. 'type' is where its type says
 * on a phone (`typeOpens`), its page on a desktop.
 */
export function resolvePlace(id: Id, where: OpenWhere = 'page', phone = isPhone.value, onPage = pageObjectId.value, typeOpens: OpenPlace = typeOpensOf(id)): OpenPlace {
  if (onPage === id) return 'page'
  const place = where === 'type' ? (phone ? typeOpens : 'page') : where
  if (place === 'pane') return phone ? 'page' : 'pane'
  return place
}

/** The current address with the pane set to an object, or without a pane. */
function withPane(id: Id | undefined, block?: Id): RouteLocationRaw {
  const { pane: _pane, paneBlock: _block, popup: _popup, popupBlock: _popupBlock, new: _new, ...rest } = router.currentRoute.value.query
  return { query: { ...rest, ...(id ? { pane: id } : {}), ...(id && block ? { paneBlock: block } : {}) }, hash: router.currentRoute.value.hash }
}

/** The current address with the popup set to an object, or without a popup. */
function withPopup(id: Id | undefined, block?: Id, query?: LocationQueryRaw): RouteLocationRaw {
  const { pane: _pane, paneBlock: _block, popup: _popup, popupBlock: _popupBlock, new: _new, ...rest } = router.currentRoute.value.query
  return { query: { ...rest, ...(id ? { popup: id, ...(query ?? {}), ...(block ? { popupBlock: block } : {}) } : {}) }, hash: router.currentRoute.value.hash }
}

/**
 * Opens an object. With the pane or popup already open, showing another object in it replaces the
 * history entry: reading through a list is one Back to leave it, not one per object.
 */
export function openObject(id: Id, options: OpenOptions = {}) {
  const place = resolvePlace(id, options.where)
  const to = place === 'pane' ? withPane(id, options.block) : place === 'popup' ? withPopup(id, options.block, options.query) : objectRoute(id, options)
  const replacing = options.replace || (place === 'pane' && paneObjectId.value) || (place === 'popup' && popupObjectId.value)
  return replacing ? router.replace(to) : router.push(to)
}

/**
 * Closes the pane or popup, kept in the address. When the entry before is the page without it (it
 * was opened over the page) that is gone back to, so the next Back leaves the page and does not
 * reopen the window; else (opened by an address, or read through from list to list) the entry is
 * replaced. `replace`: always replace (one object giving way to another page).
 */
async function closeOverlay(kind: 'pane' | 'popup', to: RouteLocationRaw, replace: boolean) {
  if (!replace && router.options.history.state.back === router.resolve(to).fullPath) return router.back()
  closingOverlay[kind] = true
  try {
    return await router.replace(to)
  } finally {
    closingOverlay[kind] = false
  }
}

export async function closePane(replace = false) {
  if (!paneObjectId.value) return
  return closeOverlay('pane', withPane(undefined), replace)
}

/** Closes the popup window (see closeOverlay). */
export async function closePopup(replace = false) {
  if (!popupObjectId.value) return
  return closeOverlay('popup', withPopup(undefined), replace)
}

/** The popup's object on its own page, in the place of the window's history entry: one Back returns to the page behind. */
export function expandPopup() {
  const id = popupObjectId.value
  if (!id) return
  return router.replace(objectRoute(id, { block: popupBlockId.value }))
}

/** The pane's object on its own page, in the place of the pane's history entry. */
export function expandPane() {
  const id = paneObjectId.value
  if (!id) return
  return router.replace(objectRoute(id, { block: paneBlockId.value }))
}
