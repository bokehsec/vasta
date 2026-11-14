import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue } from '../src/model.ts'
import { eligibleParentFields, outlineRows, parentFieldOf, parentIdOf, subtaskProgress, wouldCycle } from '../src/subtasks.ts'

const task = createBuiltinTypes('s', '2026-11-14T12:00:00.000Z').find((t) => t.system === 'task')!
const withParts = (subtasks?: ObjectType['subtasks']): ObjectType => ({
  ...task,
  properties: [
    ...task.properties,
    { id: 'part-of', kind: 'relation', name: 'Part of', targetTypeIds: [task.id], multiple: false },
    { id: 'related', kind: 'relation', name: 'Related', targetTypeIds: [task.id], multiple: true },
    { id: 'project', kind: 'relation', name: 'Project', targetTypeIds: ['project'], multiple: false },
    { id: 'anything', kind: 'relation', name: 'Anything', targetTypeIds: [], multiple: false },
  ],
  ...(subtasks ? { subtasks } : {}),
})
const rel = (id: string): PropertyValue => ({ kind: 'relation', value: [id] })
const status = (id: string): PropertyValue => ({ kind: 'select', value: [id] })
const done = task.properties.find((p) => p.id === 'status' && p.kind === 'select')!
const doneId = done.kind === 'select' ? done.options.find((o) => o.status === 'done')!.id : ''
const todoId = done.kind === 'select' ? done.options.find((o) => o.status === 'todo')!.id : ''

describe('the parent field', () => {
  it('can be a single relation to the type itself or to any type, not a list or another type', () => {
    expect(eligibleParentFields(withParts()).map((p) => p.id)).toEqual(['part-of', 'anything'])
  })

  it('is the one set, while it is still eligible', () => {
    expect(parentFieldOf(withParts({ parentField: 'part-of' }))?.id).toBe('part-of')
    expect(parentFieldOf(withParts({ parentField: 'related' }))).toBeUndefined()
    expect(parentFieldOf(withParts({ parentField: 'gone' }))).toBeUndefined()
    expect(parentFieldOf(withParts())).toBeUndefined()
    expect(parentIdOf(withParts({ parentField: 'part-of' }), { props: { 'part-of': rel('p') } })).toBe('p')
    expect(parentIdOf(withParts(), { props: { 'part-of': rel('p') } })).toBeUndefined()
  })
})

describe('outline rows', () => {
  const parents: Record<string, string> = { b: 'a', c: 'a', d: 'b', f: 'gone' }
  const rows = (ids: string[], p = parents) => outlineRows(ids.map((id) => ({ id })), (o) => p[o.id]).map((r) => `${'-'.repeat(r.depth)}${r.object.id}${r.hasChildren ? '+' : ''}`)

  it('puts steps after their parent, nested, keeping the order given', () => {
    expect(rows(['c', 'e', 'a', 'd', 'b', 'f'])).toEqual(['e', 'a+', '-c', '-b+', '--d', 'f'])
  })

  it('keeps a step whose parent is not listed at the top level', () => {
    expect(rows(['d', 'c'])).toEqual(['d', 'c'])
  })

  it('does not loop on a loop of parents, and keeps every object once', () => {
    const loop = { x: 'y', y: 'x', z: 'z' }
    const out = rows(['x', 'y', 'z'], loop)
    expect(out.map((r) => r.replace(/[-+]/g, '')).sort()).toEqual(['x', 'y', 'z'])
    expect(out).toContain('z')
  })
})

describe('progress', () => {
  const type = withParts({ parentField: 'part-of' })
  const open = { id: 'p', props: { status: status(todoId) } }

  it('counts closed steps, ready to close once all are and the parent is open', () => {
    expect(subtaskProgress(type, open, [{ id: 'a', props: { status: status(doneId) } }, { id: 'b', props: {} }])).toEqual({ done: 1, total: 2, readyToClose: false })
    expect(subtaskProgress(type, open, [{ id: 'a', props: { status: status(doneId) } }])).toEqual({ done: 1, total: 1, readyToClose: true })
    expect(subtaskProgress(type, { id: 'p', props: { status: status(doneId) } }, [{ id: 'a', props: { status: status(doneId) } }]).readyToClose).toBe(false)
    expect(subtaskProgress(type, open, [])).toEqual({ done: 0, total: 0, readyToClose: false })
  })
})

describe('loops', () => {
  const parents: Record<string, string> = { b: 'a', c: 'b' }
  const parentOf = (id: string) => parents[id]
  it('refuses the object itself and its steps at any depth as its parent', () => {
    expect(wouldCycle('a', 'a', parentOf)).toBe(true)
    expect(wouldCycle('a', 'c', parentOf)).toBe(true)
    expect(wouldCycle('c', 'a', parentOf)).toBe(false)
    expect(wouldCycle('a', 'z', parentOf)).toBe(false)
  })
})
