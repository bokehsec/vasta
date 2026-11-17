import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { Filter, FilterGroup, ObjectType, PropertyDef } from '../src/model.ts'
import { matchesFilter } from '../src/query.ts'
import { andFilters, savedConditions, savedShowsClosed, savedWithNarrowing, shownFilter, withSavedConditions } from '../src/view-filter.ts'

const AT = '2026-11-16T12:00:00.000Z'
const base = createBuiltinTypes('s', AT).find((t) => t.system === 'task')!
const task: ObjectType = {
  ...base,
  properties: base.properties.map((p): PropertyDef => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'dropped', label: 'Dropped', status: 'done' }] } : p)),
}

const status = (operator: Filter['operator'], ids: string[]): Filter => ({ kind: 'filter', field: 'status', operator, value: { kind: 'literal', value: ids } })
const area = (id: string): Filter => ({ kind: 'filter', field: 'area', operator: 'is', value: { kind: 'literal', value: id } })
const and = (...items: (Filter | FilterGroup)[]): FilterGroup => ({ kind: 'group', operator: 'and', items })
const or = (...items: (Filter | FilterGroup)[]): FilterGroup => ({ kind: 'group', operator: 'or', items })
const closedHidden = status('not-contains', ['done', 'dropped'])

describe('what a page filters with', () => {
  it('is the view\'s saved filter alone when nothing is narrowed and Show done is as the view has it', () => {
    const saved = and(area('work'), closedHidden)
    expect(shownFilter(task, saved, false, undefined)).toEqual(saved)
    expect(shownFilter(task, and(area('work')), true, and())).toEqual(and(area('work')))
    expect(shownFilter(task, undefined, true, undefined)).toBeUndefined()
  })

  it('shows closed tasks when the person chose to, without editing the saved filter', () => {
    const saved = and(area('work'), closedHidden)
    expect(shownFilter(task, saved, true, undefined)).toEqual(and(area('work')))
    expect(saved).toEqual(and(area('work'), closedHidden))
    // A view that shows them starts shown, and hides them for the person who chose so.
    expect(shownFilter(task, and(area('work')), false, undefined)).toEqual(and(area('work'), closedHidden))
  })

  it('puts the narrowing on top of the view\'s conditions: both must match', () => {
    const shown = shownFilter(task, and(area('work'), closedHidden), false, and(status('is', ['next'])))!
    expect(shown).toEqual(and(area('work'), closedHidden, status('is', ['next'])))
    const item = (areaId: string, statusId: string) => ({ props: { area: { kind: 'select', value: [areaId] }, status: { kind: 'select', value: [statusId] } } }) as never
    const context = { types: new Map([[task.id, task]]), today: '2026-11-16', timeZone: 'UTC' } as never
    expect(matchesFilter(item('work', 'next'), shown, context)).toBe(true)
    expect(matchesFilter(item('home', 'next'), shown, context)).toBe(false)
  })

  it('nests an "any of" so it keeps its meaning', () => {
    const either = or(status('is', ['next']), status('is', ['waiting']))
    expect(andFilters(and(area('work')), either)).toEqual({ kind: 'group', operator: 'and', items: [and(area('work')), either] })
    expect(andFilters(either, and(area('work')))).toEqual({ kind: 'group', operator: 'and', items: [either, and(area('work'))] })
    expect(andFilters(and(), undefined)).toBeUndefined()
  })
})

describe('Show done', () => {
  it('starts as what the view\'s own filter says', () => {
    expect(savedShowsClosed(task, and(area('work'), closedHidden))).toBe(false)
    expect(savedShowsClosed(task, and(area('work')))).toBe(true)
    expect(savedShowsClosed(task, undefined)).toBe(true)
  })

  it('is not listed among the view\'s conditions', () => {
    expect(savedConditions(task, and(area('work'), closedHidden))).toEqual(and(area('work')))
    expect(savedConditions(task, and(closedHidden))).toBeUndefined()
    // A view that leaves out only part of the closed statuses keeps that as a condition of its own.
    const partial = and(status('not-contains', ['done']))
    expect(savedConditions(task, partial)).toEqual(partial)
  })
})

describe('editing the view\'s own filter on purpose', () => {
  it('keeps the closed-task condition the view had', () => {
    expect(withSavedConditions(task, and(area('work'), closedHidden), and(area('home')))).toEqual(and(area('home'), closedHidden))
    expect(withSavedConditions(task, and(area('work'), closedHidden), and())).toEqual(and(closedHidden))
    expect(withSavedConditions(task, and(area('work')), and())).toBeUndefined()
    expect(withSavedConditions(task, and(area('work')), and(area('home')))).toEqual(and(area('home')))
  })
})

describe('Save to view', () => {
  it('adds the narrowing to the saved filter, after what it has', () => {
    expect(savedWithNarrowing(and(closedHidden), and(area('work')))).toEqual(and(closedHidden, area('work')))
    expect(savedWithNarrowing(undefined, and(area('work')))).toEqual(and(area('work')))
    expect(savedWithNarrowing(and(area('work')), and())).toEqual(and(area('work')))
  })
})
