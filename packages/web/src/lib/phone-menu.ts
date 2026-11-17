// The phone's bottom menu is each person's own, the same in every space and on every device of
// theirs (an account preference, lib/preferences.ts); Settings › Appearance changes it from a desktop too.
import { preference } from './preferences.ts'

export const DEFAULT_PHONE_MENU = ['home', 'tasks', 'inbox', 'calendar', 'search'] as const
export const PHONE_MENU_LIMIT = 5
export type PhoneMenuItem = typeof DEFAULT_PHONE_MENU[number] | 'today' | 'settings' | 'menu' | `type:${string}`

const valid = (value: unknown): value is PhoneMenuItem => typeof value === 'string' && (
  [...DEFAULT_PHONE_MENU, 'today', 'settings', 'menu'].includes(value) || value.startsWith('type:') && value.length > 5
)

/** Ignore damaged preferences; types missing here are kept for the spaces that have them. */
export function normalizePhoneMenu(value: unknown): PhoneMenuItem[] {
  const items = Array.isArray(value) ? [...new Set(value.filter(valid))].slice(0, PHONE_MENU_LIMIT) : []
  return items.length ? items : [...DEFAULT_PHONE_MENU]
}

/** The person's menu: the stored choice, damaged or not, cleaned up; the default until they choose. */
export const usePhoneMenu = () => preference<PhoneMenuItem[]>('phone-menu', [...DEFAULT_PHONE_MENU], { scope: 'account', parse: normalizePhoneMenu })
