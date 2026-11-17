// "New" in context. Every way of making an item (the type page's New and the phone's "+", the
// sidebar's and the top bar's New, a group's "+", a board column's "+", the default template) asks
// here for its starting values (core's newItemValues: the view's filter, Mine, the day, the group
// and column) and goes through startNew(): the quick card, where nothing is made until Add, or the
// type's default template, which is made at once because it has content and opens in the window.
// A type page says it is showing (showsNewPlace) so New made elsewhere (the phone's "+") knows the
// view it is on.
import { inject, onScopeDispose, provide, shallowRef, type InjectionKey } from 'vue'
import { newItemValues, type Filter, type FilterGroup, type Id, type NewItemValues, type ObjectRecord, type ObjectType } from '@vasta/core'
import { dayKey, isTodayRoute } from './actions.ts'
import { NO_VALUE, queryContext, type Group } from './query.ts'
import { typesById } from './state.ts'
import { createFromTemplate, currentTemplates, templatesOf } from './templates.ts'
import { router } from '../router.ts'

/** The view New is made from: its type, its filter, and whether it shows only the user's own. */
export interface NewPlace {
  typeId: Id
  filter: () => Filter | FilterGroup | undefined
  mine: () => boolean
}

/** What a group, column or lane stands for, to be added into. */
export interface NewGroup {
  field: string
  group: Group
}

const NEW_PLACE: InjectionKey<NewPlace> = Symbol('new-place')

/** The type page showing now: New from the phone's "+" or the sidebar takes its view's values. */
export const newPlace = shallowRef<NewPlace | undefined>()

/** Call in a type page's setup: New under it, and anywhere on the page, starts from this view. */
export function showsNewPlace(place: NewPlace) {
  newPlace.value = place
  provide(NEW_PLACE, place)
  onScopeDispose(() => {
    if (newPlace.value === place) newPlace.value = undefined
  })
}

/** The view New inside a page is made from (a board's or a group's "+"); none outside a type page. */
export const useNewPlace = () => inject(NEW_PLACE, undefined)

/** The quick card being shown, if one is: App.vue draws it (QuickAdd). */
export const newCard = shallowRef<{ id: number; type: ObjectType; initial: NewItemValues; capture: boolean } | null>(null)
let cards = 0

/** The starting values of a new `type` item made in `place` (the view of the page, if any) and `groups`. */
export function newValues(type: ObjectType, groups: NewGroup[] = [], place?: NewPlace): NewItemValues {
  return newItemValues({
    type,
    query: queryContext(),
    ...(place ? { filter: place.filter(), mine: place.mine() } : {}),
    ...(isTodayRoute(router.currentRoute.value) ? { day: dayKey() } : {}),
    groups: groups.map(({ field, group }) => ({ field, value: group.key === NO_VALUE ? null : group.key })),
  })
}

export const defaultTemplateOf = (typeId: Id): ObjectRecord | undefined => templatesOf(typeId).find((t) => t.template?.kind === 'template' && t.template.default)

/**
 * Start a new item of a type, from where the user is. `template`: a template to make it from, or
 * 'blank' for none; by default the type's default template, else the quick card. `capture`: the
 * card offers "Capture a note instead" (the phone's "+").
 */
export async function startNew(typeId: Id, options: { groups?: NewGroup[]; template?: ObjectRecord | 'blank'; capture?: boolean } = {}) {
  const type = typesById.value.get(typeId)
  if (!type) return
  const place = newPlace.value?.typeId === typeId ? newPlace.value : undefined
  const initial = newValues(type, options.groups, place)
  await currentTemplates()
  const template = options.template === 'blank' ? undefined : (options.template ?? defaultTemplateOf(typeId))
  // A template has text and a cursor place of its own: it is made first and opens in the window.
  if (template) void createFromTemplate(type, template, { data: { props: initial.props, tagIds: initial.tagIds } })
  else newCard.value = { id: ++cards, type, initial, capture: !!options.capture }
}
