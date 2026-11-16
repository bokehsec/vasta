// What a new object starts with so that it shows in the view it was made from (the quick card on
// a type page): the values the view's filter asks for. Only what a filter states plainly fills a
// field ("Area is Work", "Status is Next", "Sprint is the current one", "Do date is today"); what it
// rules out ("is not", "is empty", "before") fills nothing. Of an "or", the first choice that
// works with the rest of the view is used.
import type { DateValue, Filter, FilterGroup, Id, ObjectSummary, ObjectType, PropertyDef, PropertyValue } from './model.ts'
import { matchesFilter, type QueryContext } from './query.ts'
import { addDays } from './time.ts'

type Fill = Record<Id, PropertyValue>

/** The values a new object of `type` takes so that `filter` shows it. */
export function fillFromFilter(type: ObjectType, filter: Filter | FilterGroup | undefined, context: QueryContext): Fill {
  if (!filter) return {}
  let fallback: Fill | undefined
  for (const candidate of fills(type, filter, context)) {
    const object = draft(type, candidate.props)
    // Try each choice with the enclosing AND's values too: an earlier OR branch may conflict
    // with them, while a later one lets the new object appear in the whole view.
    if (!candidate.choices.every((choice) => matchesFilter(object, choice, context))) continue
    fallback ??= candidate.props
    if (matchesFilter(object, filter, context)) return candidate.props
  }
  // A range or a negative condition may be impossible to fill. Keep any plain defaults.
  return fallback ?? {}
}

type Candidate = { props: Fill; choices: FilterGroup[] }

function* fills(type: ObjectType, item: Filter | FilterGroup, context: QueryContext): Generator<Candidate> {
  if (item.kind === 'filter') {
    yield { props: fillOne(type, item, context), choices: [] }
  } else if (item.operator === 'and') {
    yield* combine(type, item.items, context, { props: {}, choices: [] })
  } else {
    for (const part of item.items) {
      for (const candidate of fills(type, part, context)) {
        if (Object.keys(candidate.props).length) yield { props: candidate.props, choices: [...candidate.choices, item] }
      }
    }
    // An OR with no fillable branch need not stop its enclosing AND's other defaults.
    yield { props: {}, choices: [] }
  }
}

function* combine(type: ObjectType, items: (Filter | FilterGroup)[], context: QueryContext, base: Candidate): Generator<Candidate> {
  if (!items.length) {
    yield base
    return
  }
  const [first, ...rest] = items
  for (const candidate of fills(type, first!, context)) {
    yield* combine(type, rest, context, {
      props: { ...candidate.props, ...base.props },
      choices: [...base.choices, ...candidate.choices],
    })
  }
}

/** A blank object of the type with only these values, to try a fill against a filter. */
function draft(type: ObjectType, props: Fill): ObjectSummary {
  const at = new Date().toISOString()
  return { id: '', spaceId: type.spaceId, typeId: type.id, title: '', aliases: [], tagIds: [], collectionIds: [], props, createdAt: at, updatedAt: at, preview: '' }
}

const dayValue = (day: string): DateValue => ({ start: `${day}T00:00:00.000Z`, resolution: 'day' })

function fillOne(type: ObjectType, filter: Filter, context: QueryContext): Fill {
  const def = type.properties.find((p) => p.id === filter.field)
  const value = def ? valueFor(def, filter, context) : undefined
  return def && value ? { [def.id]: value } : {}
}

function valueFor(def: PropertyDef, filter: Filter, context: QueryContext): PropertyValue | undefined {
  const { operator, value } = filter
  if (def.kind === 'checkbox') return operator === 'is-checked' ? { kind: 'checkbox', value: true } : undefined
  if (def.kind === 'select' || def.kind === 'relation' || def.kind === 'person') {
    if (operator !== 'is' && operator !== 'contains') return undefined
    let ids: Id[] = []
    if (value?.kind === 'literal') ids = Array.isArray(value.value) ? value.value : typeof value.value === 'string' ? [value.value] : []
    else if (value?.name === 'me' && context.me) ids = [context.me]
    else if (value?.name === 'current-sprint' && context.currentSprint) ids = [context.currentSprint]
    else if (value?.name === 'parent' && !value.field && context.parent) ids = [context.parent.id]
    if (!ids.length) return undefined
    // "is" asks for exactly these; "contains" for any of them, so one is enough.
    return { kind: def.kind, value: operator === 'is' && def.multiple ? ids : ids.slice(0, 1) }
  }
  if (operator !== 'is' || !value) return undefined
  if (def.kind === 'date') {
    if (value.kind === 'variable') return value.name === 'today' ? { kind: 'date', value: dayValue(addDays(context.today, value.offsetDays ?? 0)) } : undefined
    return typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.value) ? { kind: 'date', value: dayValue(value.value) } : undefined
  }
  if (value.kind !== 'literal') return undefined
  if (def.kind === 'text' && typeof value.value === 'string') return { kind: 'text', value: value.value }
  if (def.kind === 'number' && typeof value.value === 'number') return { kind: 'number', value: value.value }
  return undefined
}
