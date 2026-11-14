import { describe, expect, it, vi } from 'vitest'
import type { ObjectType, PropertyValue } from '@vasta/core'
import { createBuiltinTypes } from '@vasta/core'

// Steps load from the server and write through the app's actions: stand in for them.
vi.mock('./actions.ts', () => ({ createObject: vi.fn(), setProperties: vi.fn() }))
vi.mock('./api.ts', () => ({ api: { objectsOfType: vi.fn(async () => []) } }))
vi.mock('./events.ts', () => ({ onChange: vi.fn() }))
vi.mock('./overlays.ts', () => ({ promptDialog: vi.fn() }))
vi.mock('./pick.ts', () => ({ pickObject: vi.fn() }))
vi.mock('./state.ts', () => ({ lastError: { value: '' }, primeSummaries: vi.fn(), typesById: { value: new Map() } }))

const { inheritedValues, openStepsNote } = await import('./subtasks.ts')

const task = createBuiltinTypes('s', '2026-11-13T12:00:00.000Z').find((t) => t.system === 'task')!
const select = (id: string): PropertyValue => ({ kind: 'select', value: [id] })

/** A type whose status select has another id ("phase") and a "priority" select, with a parent field. */
const project: ObjectType = {
  ...task,
  id: 'project',
  system: undefined,
  subtasks: { parentField: 'parent' },
  properties: [
    { id: 'phase', kind: 'select', name: 'Phase', multiple: false, options: [{ id: 'on', label: 'On', status: 'doing' }, { id: 'over', label: 'Over', status: 'done' }] },
    { id: 'priority', kind: 'select', name: 'Priority', multiple: false, options: [{ id: 'high', label: 'High' }] },
    { id: 'parent', kind: 'relation', name: 'Part of', multiple: false, targetTypeIds: [] },
  ],
}

describe('inheritedValues', () => {
  it('copies selects but not the status, whatever the type calls it', () => {
    const { props } = inheritedValues(project, { props: { phase: select('over'), priority: select('high') }, tagIds: ['t1'] })
    expect(props).toEqual({ priority: select('high') })
  })

  it('leaves out a task’s status and the parent field', () => {
    const parent = { props: { status: select('done'), priority: select('high'), parent: { kind: 'relation', value: ['x'] } } as Record<string, PropertyValue>, tagIds: [] }
    const typed: ObjectType = { ...task, subtasks: { parentField: 'parent' }, properties: [...task.properties, { id: 'parent', kind: 'relation', name: 'Part of', multiple: false, targetTypeIds: [] }] }
    expect(Object.keys(inheritedValues(typed, parent).props)).not.toContain('status')
    expect(Object.keys(inheritedValues(typed, parent).props)).not.toContain('parent')
  })
})

describe('openStepsNote', () => {
  it('is empty for a type without steps', () => {
    expect(openStepsNote(createBuiltinTypes('s', '2026-11-13T12:00:00.000Z').find((t) => t.system === 'page'), [{ id: 'a', props: {} }])).toBeUndefined()
    expect(openStepsNote(undefined, [])).toBeUndefined()
  })
})
