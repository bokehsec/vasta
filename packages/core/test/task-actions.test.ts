import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyDef, PropertyValue } from '../src/model.ts'
import { isClosedTask, quickActionValues, resolveQuickActions } from '../src/task-actions.ts'

const AT = '2026-11-13T12:00:00.000Z'
const types = createBuiltinTypes('s', AT)
const task = types.find((t) => t.system === 'task')!
const page = types.find((t) => t.system === 'page')!

/** The built-in task with "Scheduled", "Dropped" and a "Do date", as a space set up for triage has. */
function triageTask(quickActions?: ObjectType['quickActions']): ObjectType {
  const properties: PropertyDef[] = task.properties.map((p) =>
    p.id === 'status' && p.kind === 'select'
      ? { ...p, options: [...p.options, { id: 'scheduled', label: 'Scheduled', status: 'todo' }, { id: 'dropped', label: 'Dropped', status: 'done' }] }
      : p
  )
  const added: PropertyDef[] = [{ id: 'dodate', kind: 'date', name: 'Do date' }, { id: 'next', kind: 'text', name: 'Next step' }]
  return { ...task, properties: [...properties, ...added], ...(quickActions ? { quickActions } : {}) }
}

const status = (id: string): PropertyValue => ({ kind: 'select', value: [id] })
const day = (value: string, rrule?: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })

describe('resolveQuickActions', () => {
  it('defaults to Done, the due date and no Drop on the built-in task', () => {
    const resolved = resolveQuickActions(task)
    expect(resolved.done?.id).toBe('done')
    expect(resolved.deferField?.id).toBe('due')
    expect(resolved.deferStatus).toBeUndefined()
    expect(resolved.drop).toBeUndefined()
  })

  it('drops to the second option meaning done when none is chosen', () => {
    expect(resolveQuickActions(triageTask()).drop?.id).toBe('dropped')
  })

  it('follows the type settings', () => {
    const resolved = resolveQuickActions(triageTask({ deferField: 'dodate', deferStatus: 'scheduled', dropStatus: 'dropped' }))
    expect(resolved.deferField?.id).toBe('dodate')
    expect(resolved.deferStatus?.id).toBe('scheduled')
    expect(resolved.drop?.id).toBe('dropped')
  })

  it('falls back when a setting names something gone or of the wrong kind', () => {
    const resolved = resolveQuickActions(triageTask({ deferField: 'priority', deferStatus: 'gone', dropStatus: 'done', nextStepField: 'dodate' }))
    expect(resolved.deferField?.id).toBe('due')
    expect(resolved.deferStatus).toBeUndefined()
    expect(resolved.drop?.id).toBe('dropped')
    expect(resolved.nextStepField).toBeUndefined()
  })

  it('has a next step field only when the type names a text property', () => {
    expect(resolveQuickActions(triageTask()).nextStepField).toBeUndefined()
    expect(resolveQuickActions(triageTask({ nextStepField: 'next' })).nextStepField?.id).toBe('next')
  })

  it('offers nothing on other types', () => {
    expect(resolveQuickActions(page)).toEqual({})
    expect(resolveQuickActions(undefined)).toEqual({})
  })
})

describe('quickActionValues', () => {
  const type = triageTask({ deferField: 'dodate', deferStatus: 'scheduled' })

  it('sets the status for Done and Drop', () => {
    expect(quickActionValues(type, { props: {} }, { kind: 'done' })).toEqual({ status: status('done') })
    expect(quickActionValues(type, { props: {} }, { kind: 'drop' })).toEqual({ status: status('dropped') })
  })

  it('sets the day and the status for Defer', () => {
    expect(quickActionValues(type, { props: { status: status('todo') } }, { kind: 'defer', day: '2026-11-16' })).toEqual({ dodate: day('2026-11-16'), status: status('scheduled') })
  })

  it('keeps a repeating date repeating', () => {
    const values = quickActionValues(task, { props: { due: day('2026-11-13', 'FREQ=WEEKLY') } }, { kind: 'defer', day: '2026-11-20' })
    expect(values).toEqual({ due: day('2026-11-20', 'FREQ=WEEKLY') })
  })

  it('sets or clears the next step', () => {
    const type = triageTask({ nextStepField: 'next' })
    expect(quickActionValues(type, { props: {} }, { kind: 'next-step', text: '  Ask Nabil ' })).toEqual({ next: { kind: 'text', value: 'Ask Nabil' } })
    expect(quickActionValues(type, { props: {} }, { kind: 'next-step', text: ' ' })).toEqual({ next: undefined })
    expect(quickActionValues(triageTask(), { props: {} }, { kind: 'next-step', text: 'x' })).toBeUndefined()
  })

  it('has nothing to do where the type cannot', () => {
    expect(quickActionValues(task, { props: {} }, { kind: 'drop' })).toBeUndefined()
    expect(quickActionValues(page, { props: {} }, { kind: 'done' })).toBeUndefined()
  })
})

describe('isClosedTask', () => {
  it('is true for any option meaning done', () => {
    const type = triageTask()
    expect(isClosedTask(type, { props: { status: status('done') } })).toBe(true)
    expect(isClosedTask(type, { props: { status: status('dropped') } })).toBe(true)
    expect(isClosedTask(type, { props: { status: status('scheduled') } })).toBe(false)
    expect(isClosedTask(type, { props: {} })).toBe(false)
    expect(isClosedTask(page, { props: { status: status('done') } })).toBe(false)
  })
})
