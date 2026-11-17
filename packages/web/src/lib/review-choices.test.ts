import { createBuiltinTypes } from '@vasta/core'
import type { ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { describe, expect, it } from 'vitest'
import { reviewDecisions } from './review-choices.ts'

const base = createBuiltinTypes('s', '2026-11-14T12:00:00Z').find((t) => t.system === 'task')!
const withStatuses = (options: { id: string; label: string; status?: 'todo' | 'done' }[], quickActions?: ObjectType['quickActions']): ObjectType => ({
  ...base,
  properties: base.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options } : p)),
  ...(quickActions ? { quickActions } : {}),
})
const set = (id: string): QuickActionDef['changes'][number] => ({ field: 'status', value: { kind: 'value', value: { kind: 'select', value: [id] } } })
const task = (status?: string) => ({ id: 'a', props: status ? { status: { kind: 'select', value: [status] } } : {} }) as unknown as ObjectSummary

describe('review keys', () => {
  it('Done, Defer and Drop keep D, F and X, whatever the first status is called', () => {
    const type = withStatuses(
      [{ id: 'dele', label: 'Delegated', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }],
      { actions: [{ id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }] }, { id: 'done', name: 'Done', changes: [set('done')] }, { id: 'drop', name: 'Drop', changes: [set('drop')] }] }
    )
    const { keys, main, keyOf } = reviewDecisions(type, task('dele'), { isNew: true, planFieldIds: [] })
    expect(main.map((b) => b.role)).toEqual(['next', 'defer', 'done', 'drop'])
    expect(keys.get('d')?.role).toBe('done')
    expect(keys.get('f')?.role).toBe('defer')
    expect(keys.get('x')?.role).toBe('drop')
    // The first status (Delegated, a new task's Next button) goes without a key rather than take D.
    expect(keyOf(main[0]!)).toBe('')
  })

  it('a first status starting with S takes its initial, and one starting with F does not take Defer\'s', () => {
    const type = withStatuses([{ id: 'soon', label: 'Soon', status: 'todo' }, { id: 'fin', label: 'Finish', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }])
    const { keys } = reviewDecisions(type, task(), { isNew: true, planFieldIds: [] })
    expect(keys.get('f')?.role).toBe('defer')
    expect(keys.get('s')?.label).toBe('Soon')
    expect(keys.get('d')?.role).toBe('done')
  })

  it('Keep is for a task with a place, and links are numbered', () => {
    const type = withStatuses([{ id: 'next', label: 'Next', status: 'todo' }, { id: 'wait', label: 'Waiting', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }])
    expect(reviewDecisions(type, task(), { isNew: true, planFieldIds: [] }).reviewed).toBeUndefined()
    const placed = reviewDecisions(type, task('next'), { isNew: false, planFieldIds: [] })
    expect(placed.reviewed?.id).toBe('reviewed')
    expect(placed.currentStatus?.label).toBe('Next')
    expect(placed.keys.get('1')?.label).toBe('Waiting')
  })
})
