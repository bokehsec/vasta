// What a view's filter is made of. The view saves its own conditions (shared with everyone who
// uses the view); a person's "Show done" choice and a narrowing they make for one visit are theirs
// and sit on top, so neither edits the saved filter. The page filters with `shownFilter`;
// "Save to view" is the one way a narrowing becomes the view's.
import type { FilterGroup, ObjectType } from './model.ts'
import { hidesClosed, withClosedHidden, withClosedShown } from './closed-filter.ts'

/** The two filters as one that both must match; undefined when both are empty. */
export function andFilters(first: FilterGroup | undefined, second: FilterGroup | undefined): FilterGroup | undefined {
  const a = first?.items.length ? first : undefined
  const b = second?.items.length ? second : undefined
  if (!a || !b) return a ?? b
  if (a.operator === 'and' && b.operator === 'and') return { ...a, items: [...a.items, ...b.items] }
  return { kind: 'group', operator: 'and', items: [a, b] }
}

/** Whether the view's saved filter leaves closed objects out, which is what its "Show done" starts as (shown unless it does). */
export const savedShowsClosed = (type: ObjectType | undefined, saved: FilterGroup | undefined): boolean => !hidesClosed(type, saved)

/** The view's saved conditions without the one that leaves closed objects out (that one is the Show done choice). */
export const savedConditions = (type: ObjectType | undefined, saved: FilterGroup | undefined): FilterGroup | undefined =>
  hidesClosed(type, saved) ? withClosedShown(type, saved) : saved

/** The saved conditions after an edit of `conditions` (what savedConditions gave): the closed-object condition the view had stays. */
export function withSavedConditions(type: ObjectType | undefined, saved: FilterGroup | undefined, conditions: FilterGroup | undefined): FilterGroup | undefined {
  const next = conditions?.items.length ? conditions : undefined
  return hidesClosed(type, saved) ? withClosedHidden(type, next) : next
}

/**
 * The filter a page filters with: the view's saved filter, closed objects shown or left out as
 * `showClosed` says (the person's choice, which starts as the view's), then the narrowing.
 */
export function shownFilter(type: ObjectType | undefined, saved: FilterGroup | undefined, showClosed: boolean, narrowing: FilterGroup | undefined): FilterGroup | undefined {
  const hidden = hidesClosed(type, saved)
  const base = showClosed && hidden ? withClosedShown(type, saved) : !showClosed && !hidden ? withClosedHidden(type, saved) : saved
  return andFilters(base, narrowing)
}

/** The view's saved filter with the narrowing's conditions added (Save to view). */
export const savedWithNarrowing = (saved: FilterGroup | undefined, narrowing: FilterGroup | undefined): FilterGroup | undefined => andFilters(saved, narrowing)
