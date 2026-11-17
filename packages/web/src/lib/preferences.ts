// The person's display choices, stored in one place. A preference has a key (a path such as
// `type/<id>/mine` or `page-width`: what it belongs to first, so deleting a view or type can drop its
// keys with one prefix) and one of three scopes:
//   account  follows the person to every device: kept on the server with the user's profile
//            (User.preferences, which reaches an offline start with the cached /api/auth/me);
//            a change not sent yet waits here and goes when the server can be reached.
//            Folds, "show done", the phone's menu, the last view of a type, the Habits display…
//   device   this device and this person: localStorage `vasta.device.<user>.<key>`. Page width,
//            capture drafts, where a pane or the camera of a board is.
//   browser  this device, whoever uses it: `vasta.browser.<key>`. What shows before anyone has
//            logged in (the theme) and caches.
// Nothing a person folds, hides or picks changes what anyone else sees; the views themselves
// (their filters, sorts, fields) stay shared data on the type. `preference()` is a ref to write
// through; values are JSON. Technical switches that are not choices (`vasta.replica`, the review
// session) stay outside.
import { computed, ref, toValue, type MaybeRefOrGetter, type WritableComputedRef } from 'vue'
import type { User } from '@vasta/core'
import { NetworkError, authApi } from './api.ts'
import { convertLegacy, isBrowserLegacy } from './preferences-legacy.ts'

export type PreferenceScope = 'account' | 'device' | 'browser'

let userId = ''
/** The account's preferences as the server last said, and the changes not yet sent (null: removed). */
let account = new Map<string, unknown>()
let pending: Record<string, unknown> = {}
/** Device and browser values read from localStorage so far, by storage name. */
const stored = new Map<string, unknown>()
/** Bumped by every change: what reads a preference re-reads when it moves. */
const revision = ref(0)

const accountCacheName = (user: string) => `vasta.account.${user}`

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function storageName(scope: 'device' | 'browser', key: string): string | undefined {
  if (scope === 'browser') return `vasta.browser.${key}`
  return userId ? `vasta.device.${userId}.${key}` : undefined
}

function readStored(name: string): unknown {
  if (stored.has(name)) return stored.get(name)
  let value: unknown
  try {
    const raw = storage()?.getItem(name)
    if (raw != null) value = JSON.parse(raw)
  } catch {}
  stored.set(name, value)
  return value
}

function writeStored(name: string, value: unknown) {
  stored.set(name, value)
  try {
    if (value === undefined) storage()?.removeItem(name)
    else storage()?.setItem(name, JSON.stringify(value))
  } catch {}
}

/** The stored value, or undefined. */
export function getPreference(scope: PreferenceScope, key: string): unknown {
  void revision.value
  if (scope === 'account') return userId ? account.get(key) : undefined
  const name = storageName(scope, key)
  return name ? readStored(name) : undefined
}

/** Store a value; undefined removes it (the default shows again). */
export function setPreference(scope: PreferenceScope, key: string, value: unknown) {
  if (scope === 'account') {
    if (!userId) return
    if (value === undefined) account.delete(key)
    else account.set(key, value)
    queue(key, value === undefined ? null : value)
  } else {
    const name = storageName(scope, key)
    if (!name) return
    writeStored(name, value)
  }
  revision.value++
}

/**
 * A preference as a ref. `key` may be a getter (a view's id changes), undefined while what it
 * belongs to is not known: then it reads the fallback and writes nothing. `parse` turns a stored
 * value that may be damaged or from an older build into one the app can use (undefined: the fallback).
 */
export function preference<T>(
  key: MaybeRefOrGetter<string | undefined>,
  fallback: MaybeRefOrGetter<T>,
  options: { scope: PreferenceScope; parse?: (value: unknown) => T | undefined }
): WritableComputedRef<T> {
  return computed<T>({
    get() {
      const id = toValue(key)
      const value = id ? getPreference(options.scope, id) : undefined
      if (value === undefined) return toValue(fallback)
      return (options.parse ? options.parse(value) : (value as T)) ?? toValue(fallback)
    },
    set(value) {
      const id = toValue(key)
      if (id) setPreference(options.scope, id, value)
    },
  })
}

/** Remove every preference whose key starts with `prefix` (a view, type or space that was deleted): `type/<id>/`. */
export function dropPreferences(prefix: string) {
  if (userId) for (const key of [...account.keys()]) if (key.startsWith(prefix)) setPreference('account', key, undefined)
  const own = userId ? `vasta.device.${userId}.${prefix}` : undefined
  try {
    const store = storage()
    for (let i = (store?.length ?? 0) - 1; i >= 0; i--) {
      const name = store?.key(i)
      if (name && own && name.startsWith(own)) {
        store?.removeItem(name)
        stored.delete(name)
      }
    }
  } catch {}
  revision.value++
}

// Account preferences: the server's copy, the local cache, and sending changes ------------------

let timer: ReturnType<typeof setTimeout> | undefined
let sending = false

function saveCache() {
  try {
    storage()?.setItem(accountCacheName(userId), JSON.stringify({ pending }))
  } catch {}
}

function queue(key: string, value: unknown) {
  pending = { ...pending, [key]: value }
  saveCache()
  schedule(800)
}

function schedule(delay: number) {
  clearTimeout(timer)
  if (userId && Object.keys(pending).length) timer = setTimeout(() => void flush(), delay)
}

/** Send what changed since the last send; a failure to reach the server keeps it for the next try. */
export async function flush() {
  clearTimeout(timer)
  const user = userId
  if (!user || sending || !Object.keys(pending).length) return
  sending = true
  const batch = pending
  pending = {}
  try {
    await authApi.updateProfile({ preferences: batch })
    if (user === userId) saveCache()
  } catch (error) {
    if (user !== userId) return
    // Not reaching the server: keep the changes, newer ones over older. Anything it refused is dropped.
    if (error instanceof NetworkError) {
      pending = { ...batch, ...pending }
      saveCache()
      schedule(30_000)
    } else saveCache()
  } finally {
    sending = false
  }
  if (user === userId && Object.keys(pending).length) schedule(800)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
  // A change not sent before the page closes waits in the local cache and goes at the next start.
}

// Starting and stopping, and moving the old keys ----------------------------------------------

/**
 * Old localStorage keys (preferences-legacy.ts), converted and removed. A key holding a value
 * keeps it: only a key not set yet takes the old one. `user` empty: only what belongs to the
 * whole browser (read before anyone logs in).
 */
export function migrateLegacy(user: string) {
  try {
    const store = storage()
    if (!store) return
    const names: string[] = []
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i)
      if (name?.startsWith('vasta.')) names.push(name)
    }
    for (const name of names) {
      if (!user && !isBrowserLegacy(name)) continue
      const converted = convertLegacy(name, store.getItem(name) ?? '', user)
      if (!converted) continue
      store.removeItem(name)
      const { scope, key, value } = converted
      if (scope === 'account') {
        if (!account.has(key)) {
          account.set(key, value)
          pending[key] = value
        }
      } else {
        const target = storageName(scope, key)
        if (target && store.getItem(target) === null) writeStored(target, value)
      }
    }
  } catch {}
}

/** The person logged in: load their preferences (the server's, with what was changed here and not sent), move the old keys, send. */
export function startPreferences(user: Pick<User, 'id' | 'preferences'>) {
  userId = user.id
  let cached: { pending?: Record<string, unknown> } = {}
  try {
    cached = JSON.parse(storage()?.getItem(accountCacheName(user.id)) ?? '{}') as typeof cached
  } catch {}
  // The user comes from the server (or its offline copy of /api/auth/me), which leaves `preferences`
  // out when there are none: that is the answer, never the cache's older values.
  account = new Map(Object.entries(user.preferences ?? {}))
  pending = cached.pending ?? {}
  for (const [key, value] of Object.entries(pending)) {
    if (value === null) account.delete(key)
    else account.set(key, value)
  }
  stored.clear()
  migrateLegacy(user.id)
  saveCache()
  revision.value++
  void flush()
}

/** Logged out: forget the account's preferences (the cache stays on this device for the next login). */
export function stopPreferences() {
  clearTimeout(timer)
  userId = ''
  account = new Map()
  pending = {}
  stored.clear()
  revision.value++
}

// What belongs to the whole browser is read before anyone has logged in.
migrateLegacy('')
