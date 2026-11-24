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
  it('Today, Schedule, Done, Drop and Snooze keep T, S, D, X and N, whatever the first status is called', () => {
    const type = withStatuses(
      [{ id: 'dele', label: 'Delegated', status: 'todo' }, { id: 'next', label: 'Next', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }, { id: 'drop', label: 'Dropped', status: 'done' }],
      { actions: [{ id: 'defer', name: 'Defer', changes: [{ field: 'dodate', value: { kind: 'ask' } }] }, { id: 'done', name: 'Done', changes: [set('done')] }, { id: 'drop', name: 'Drop', changes: [set('drop')] }] }
    )
    const { keys, main } = reviewDecisions(type, task('dele'), { isNew: true, planFieldIds: [] })
    expect(main.map((b) => b.role)).toEqual(['today', 'defer', 'done', 'drop', 'snooze'])
    expect(keys.get('t')?.role).toBe('today')
    expect(keys.get('d')?.role).toBe('done')
    expect(keys.get('s')?.role).toBe('defer')
    expect(keys.get('x')?.role).toBe('drop')
    expect(keys.get('n')?.role).toBe('snooze')
    expect(keys.get('f')).toBeUndefined()
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
