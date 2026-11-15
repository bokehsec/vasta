// Shared destinations for the phone bar and its settings. Type ids stay within their space.
import { computed } from 'vue'
import type { Icon } from '@vasta/core'
import { dayKey } from './actions.ts'
import { people } from './people.ts'
import { usePhoneMenu, type PhoneMenuItem } from './phone-menu.ts'
import { systemType, workspace } from './state.ts'

export interface PhonePlace {
  id: PhoneMenuItem
  label: string
  fallback: string
  icon?: Icon
  to?: string
}

export const phoneMenu = usePhoneMenu(() => people.me && workspace.space ? JSON.stringify([people.me, workspace.space.id]) : '')

export const phonePlaces = computed<PhonePlace[]>(() => {
  const task = systemType('task')
  return [
    { id: 'home', label: 'Home', fallback: 'ph:house', to: '/' },
    ...(task ? [{ id: 'tasks' as const, label: 'Tasks', fallback: 'ph:check-circle', to: `/t/${task.id}` }] : []),
    { id: 'inbox', label: 'Inbox', fallback: 'ph:tray', to: '/inbox' },
    { id: 'calendar', label: 'Calendar', fallback: 'ph:calendar-blank', to: '/calendar' },
    { id: 'search', label: 'Search', fallback: 'ph:magnifying-glass' },
    { id: 'today', label: 'Today', fallback: 'ph:calendar-dot' },
    { id: 'settings', label: 'Settings', fallback: 'ph:gear', to: '/settings' },
    ...workspace.types.filter((type) => type.system !== 'task').map((type): PhonePlace => ({
      id: `type:${type.id}`, label: type.pluralName, fallback: 'ph:shapes', ...(type.icon ? { icon: type.icon } : {}), to: `/t/${type.id}`,
    })),
  ]
})

export const visiblePhonePlaces = computed(() => {
  const places = phoneMenu.value.flatMap((id) => phonePlaces.value.find((place) => place.id === id) ?? [])
  // A space without the selected types must still have a usable bar.
  return places.length ? places : [phonePlaces.value[0]!]
})

export function phonePlacePath(place: PhonePlace): string | undefined {
  return place.id === 'today' ? `/calendar?view=day&date=${dayKey()}` : place.to
}
