// Where an object opens: its own page (/o/<id>), the side pane next to the page that is showing
// (?pane=<id> on that page's address), or a window over the page (?popup=<id>; a sheet from the
// bottom on a phone). Everything that opens an object goes through here, so the choice is made in
// one place. The pane and the popup live in the address, so back/forward, reload and copied links
// bring them back; leaving the page closes them, and a page changing only its own query (the
// calendar's view and date) keeps them (the guard in router.ts).
import { computed, type InjectionKey } from 'vue'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { Id } from '@vasta/core'
import { closingOverlay, router } from '../router.ts'
import { isPhone } from './viewport.ts'
import { lastError, notice } from './state.ts'

export type OpenPlace = 'page' | 'pane' | 'popup'

export interface OpenOptions {
  /** A block of its text to scroll to (#b-<id>). */
  block?: Id | undefined
  /** Extra query for the page, such as `new` or `capture`. */
  query?: LocationQueryRaw
  /** 'pane' opens it next to the current page where there is room for one, 'popup' in a window
   * over what is showing; the default is its page. */
  where?: OpenPlace
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

/**
 * Where an object asked to open in the pane or the popup goes: phones have no room for a pane, and
 * the page of the same object is already showing it, so both open (or stay on) the page. A popup
 * has room everywhere, but not over the same object's page either.
 */
export function resolvePlace(id: Id, where: OpenPlace = 'page', phone = isPhone.value, onPage = pageObjectId.value): OpenPlace {
  if (onPage === id) return 'page'
  if (where === 'pane') return phone ? 'page' : 'pane'
  return where
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

export async function closePane(replace = false) {
  if (!paneObjectId.value) return
  const to = withPane(undefined)
  closingOverlay.pane = true
  try {
    return await (replace ? router.replace(to) : router.push(to))
  } finally {
    closingOverlay.pane = false
  }
}

/** Closes the popup window. An untouched new item in it is removed (PopupHost does that). */
export async function closePopup(replace = false) {
  if (!popupObjectId.value) return
  const to = withPopup(undefined)
  closingOverlay.popup = true
  try {
    return await (replace ? router.replace(to) : router.push(to))
  } finally {
    closingOverlay.popup = false
  }
}

/** The popup's object on its own page, in place of the page behind it. */
export function expandPopup(replace = false) {
  const id = popupObjectId.value
  if (!id) return
  const to = objectRoute(id, { block: popupBlockId.value })
  return replace ? router.replace(to) : router.push(to)
}

/** The pane's object on its own page, in place of the page behind it. */
export function expandPane(replace = false) {
  const id = paneObjectId.value
  if (!id) return
  const to = objectRoute(id, { block: paneBlockId.value })
  return replace ? router.replace(to) : router.push(to)
}
