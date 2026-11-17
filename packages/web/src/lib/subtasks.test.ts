import { describe, expect, it, vi } from 'vitest'
import type { ObjectSummary, ObjectType, PropertyValue } from '@vasta/core'
import { createBuiltinTypes } from '@vasta/core'

// Steps load from the server and write through the app's actions: stand in for them.
vi.mock('./actions.ts', () => ({ createObject: vi.fn(), setProperties: vi.fn() }))
const objectsOfType = vi.fn(async (_typeId: string): Promise<ObjectSummary[]> => [])
const summaries = vi.fn(async (_ids: string[]): Promise<ObjectSummary[]> => [])
vi.mock('./api.ts', () => ({ api: { objectsOfType: (typeId: string) => objectsOfType(typeId), summaries: (ids: string[]) => summaries(ids) } }))
let changed: (event: unknown) => void = () => {}
vi.mock('./events.ts', () => ({ onChange: vi.fn((listener: (event: unknown) => void) => void (changed = listener)) }))
vi.mock('./overlays.ts', () => ({ promptDialog: vi.fn() }))
vi.mock('./pick.ts', () => ({ pickObject: vi.fn() }))
const types = new Map<string, ObjectType>()
vi.mock('./state.ts', () => ({ lastError: { value: '' }, primeSummaries: vi.fn(), typesById: { value: types } }))

const { inheritedValues, loadSubtasks, noteSaved, openStepsOf, subtasksOf } = await import('./subtasks.ts')

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

describe('openStepsOf', () => {
  it('is empty for a type without steps', async () => {
    expect(await openStepsOf(createBuiltinTypes('s', '2026-11-13T12:00:00.000Z').find((t) => t.system === 'page'), 'a')).toEqual([])
    expect(await openStepsOf(undefined, 'a')).toEqual([])
  })
})

describe('keeping the index in step', () => {
  const tasks: ObjectType = { ...task, id: 'tasks', subtasks: { parentField: 'parent' }, properties: [...task.properties, { id: 'parent', kind: 'relation', name: 'Part of', multiple: false, targetTypeIds: [] }] }
  const step = (id: string, parent: string | undefined, createdAt: string, state = 'todo'): ObjectSummary =>
    ({ id, typeId: tasks.id, title: id, preview: '', createdAt, props: { status: select(state), ...(parent ? { parent: { kind: 'relation', value: [parent] } } : {}) } }) as unknown as ObjectSummary
  const ids = (parent: string) => subtasksOf(tasks, parent).map((s) => s.id)

  it('puts a saved object under its parent, moves it with its parent field and drops it when gone', async () => {
    types.set(tasks.id, tasks)
    objectsOfType.mockResolvedValue([step('p', undefined, '1'), step('a', 'p', '2'), step('b', 'p', '3'), step('q', undefined, '4')])
    await loadSubtasks(tasks.id)
    expect(ids('p')).toEqual(['a', 'b'])
    objectsOfType.mockClear()
    // A step saved with another status stays in its place; a new one goes by its creation, oldest first.
    noteSaved(step('a', 'p', '2', 'done'))
    noteSaved(step('c', 'p', '2.5'))
    expect(ids('p')).toEqual(['a', 'c', 'b'])
    expect(subtasksOf(tasks, 'p')[0]!.props.status).toEqual(select('done'))
    // Moved under another parent, then out of every parent.
    noteSaved(step('c', 'q', '2.5'))
    expect([ids('p'), ids('q')]).toEqual([['a', 'b'], ['c']])
    noteSaved(step('c', undefined, '2.5'))
    expect(ids('q')).toEqual([])
    // Trashed: gone.
    noteSaved({ ...step('b', 'p', '3'), deletedAt: '2026-11-16T00:00:00.000Z' } as ObjectSummary)
    expect(ids('p')).toEqual(['a'])
    expect(objectsOfType).not.toHaveBeenCalled()
  })

  it('fetches only the changed objects, together, when the change events come, not the whole type', async () => {
    types.set(tasks.id, tasks)
    objectsOfType.mockResolvedValue([step('p', undefined, '1'), step('a', 'p', '2'), step('b', 'p', '3')])
    await loadSubtasks(tasks.id, true)
    objectsOfType.mockClear()
    summaries.mockResolvedValue([step('a', undefined, '2'), step('x', 'p', '5')])
    for (const id of ['a', 'x', 'b']) changed({ kind: 'object', id, typeId: tasks.id, spaceId: 's', updatedAt: '2026-11-16T00:00:00.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(summaries).toHaveBeenCalledTimes(1)
    expect(summaries).toHaveBeenCalledWith(['a', 'x', 'b'])
    // a left its parent, x joined, b was not sent back (deleted).
    expect(ids('p')).toEqual(['x'])
    expect(objectsOfType).not.toHaveBeenCalled()
  })
})
