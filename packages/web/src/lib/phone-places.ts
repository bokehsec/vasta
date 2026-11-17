// Shared destinations for the phone bar and its settings. One menu for every space: a type is
// remembered by its plural name, so it shows in each space that has a type of that name.
import { computed } from 'vue'
import type { Icon } from '@vasta/core'
import { dayKey } from './actions.ts'
import { usePhoneMenu, type PhoneMenuItem } from './phone-menu.ts'
import { systemType, workspace } from './state.ts'

export interface PhonePlace {
  id: PhoneMenuItem
  label: string
  fallback: string
  icon?: Icon
  to?: string
}

export const phoneMenu = usePhoneMenu()

/** The menu's id for a type: its plural name, case aside (the same type in another space matches). */
export const typeMenuItem = (pluralName: string): PhoneMenuItem => `type:${pluralName.trim().toLowerCase()}`

export const phonePlaces = computed<PhonePlace[]>(() => {
  const task = systemType('task')
  return [
    { id: 'home', label: 'Home', fallback: 'ph:house', to: '/' },
    ...(task ? [{ id: 'tasks' as const, label: 'Tasks', fallback: 'ph:check-circle', to: `/t/${task.id}` }] : []),
    { id: 'inbox', label: 'Inbox', fallback: 'ph:tray', to: '/inbox' },
    { id: 'calendar', label: 'Calendar', fallback: 'ph:calendar-blank', to: '/calendar' },
    { id: 'search', label: 'Search', fallback: 'ph:magnifying-glass' },
    { id: 'today', label: 'Today', fallback: 'ph:calendar-check' },
    { id: 'settings', label: 'Settings', fallback: 'ph:gear', to: '/settings' },
    // The side menu, as the top-left button opens it, within reach of a thumb.
    { id: 'menu', label: 'Menu', fallback: 'ph:list' },
    ...workspace.types.filter((type) => type.system !== 'task').map((type): PhonePlace => ({
      id: typeMenuItem(type.pluralName), label: type.pluralName, fallback: 'ph:shapes', ...(type.icon ? { icon: type.icon } : {}), to: `/t/${type.id}`,
    })),
  ]
})

export const visiblePhonePlaces = computed(() => {
  const places = phoneMenu.value.flatMap((id) => phonePlaces.value.find((place) => place.id === id) ?? [])
  // A type this space doesn't have is left out; a bar of only such types falls back to Home.
  return places.length ? places : [phonePlaces.value[0]!]
})

export function phonePlacePath(place: PhonePlace): string | undefined {
  return place.id === 'today' ? `/calendar?view=day&date=${dayKey()}` : place.to
}
