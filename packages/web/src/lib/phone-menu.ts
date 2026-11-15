// Phone menu choices belong to this device and account (the same in every space), like the theme.
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'

export const DEFAULT_PHONE_MENU = ['home', 'tasks', 'inbox', 'calendar', 'search'] as const
export const PHONE_MENU_LIMIT = 5
export type PhoneMenuItem = typeof DEFAULT_PHONE_MENU[number] | 'today' | 'settings' | 'menu' | `type:${string}`

const choices = new Map<string, PhoneMenuItem[]>()
const revision = ref(0)
const valid = (value: unknown): value is PhoneMenuItem => typeof value === 'string' && (
  [...DEFAULT_PHONE_MENU, 'today', 'settings', 'menu'].includes(value) || value.startsWith('type:') && value.length > 5
)

/** Ignore damaged preferences; types missing here are kept for the spaces that have them. */
export function normalizePhoneMenu(value: unknown): PhoneMenuItem[] {
  const items = Array.isArray(value) ? [...new Set(value.filter(valid))].slice(0, PHONE_MENU_LIMIT) : []
  return items.length ? items : [...DEFAULT_PHONE_MENU]
}

export function usePhoneMenu(scope: MaybeRefOrGetter<string>) {
  return computed<PhoneMenuItem[]>({
    get() {
      const id = toValue(scope)
      if (!id) return [...DEFAULT_PHONE_MENU]
      // Cache storage reads without mutating reactive state during this computed's evaluation.
      void revision.value
      if (!choices.has(id)) {
        let value: unknown
        try { value = JSON.parse(localStorage.getItem(`vasta.phone-menu:${id}`) ?? 'null') } catch {}
        choices.set(id, normalizePhoneMenu(value))
      }
      return choices.get(id)!
    },
    set(value) {
      const id = toValue(scope)
      if (!id) return
      const items = normalizePhoneMenu(value)
      choices.set(id, items)
      revision.value++
      try { localStorage.setItem(`vasta.phone-menu:${id}`, JSON.stringify(items)) } catch {}
    },
  })
}
