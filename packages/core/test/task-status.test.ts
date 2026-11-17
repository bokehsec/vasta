import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType, PropertyValue } from '../src/model.ts'
import { doneActionOf, dropActionOf, quickActionsOf, reopenActionOf, statusActionOf } from '../src/task-actions.ts'
import { closedStatusIds, closingOf, doneOptionOf, dropOptionOf, isClosedTask, reopenOptionOf, triageOptionsOf } from '../src/task-status.ts'

const base = createBuiltinTypes('s', '2026-11-16T12:00:00Z').find((t) => t.system === 'task')!
const page = createBuiltinTypes('s', '2026-11-16T12:00:00Z').find((t) => t.system === 'page')!
const withOptions = (options: { id: string; label: string; status?: 'todo' | 'doing' | 'done' }[], quickActions?: ObjectType['quickActions']): ObjectType => ({
  ...base,
  properties: base.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options } : p)),
  ...(quickActions ? { quickActions } : {}),
})
const task = withOptions([
  { id: 'in', label: 'Inbox', status: 'todo' },
  { id: 'next', label: 'Next', status: 'todo' },
  { id: 'doing', label: 'Doing', status: 'doing' },
  { id: 'done', label: 'Done', status: 'done' },
  { id: 'cancelled', label: 'Cancelled', status: 'done' },
  { id: 'dropped', label: 'Dropped', status: 'done' },
])
const at = (id?: string): { props: Record<string, PropertyValue> } => ({ props: id ? { status: { kind: 'select', value: [id] } } : {} })

describe('what a status means', () => {
  it('closed is any option meaning done; Done is the first, the others are dropped', () => {
    expect(closedStatusIds(task)).toEqual(['done', 'cancelled', 'dropped'])
    expect(closingOf(task, at('done'))).toBe('done')
    expect(closingOf(task, at('cancelled'))).toBe('dropped')
    expect(closingOf(task, at('next'))).toBeUndefined()
    expect(closingOf(task, at())).toBeUndefined()
    expect(isClosedTask(task, at('dropped'))).toBe(true)
    expect(isClosedTask(task, at('doing'))).toBe(false)
    expect(isClosedTask(page, at('done'))).toBe(false)
    expect(isClosedTask(undefined, at('done'))).toBe(false)
  })

  it('Drop is what the type\'s own Drop action sets (an option meaning done), else the one after Done', () => {
    const dropAction = (id: string) => ({ actions: [{ id: 'drop', name: 'Drop', changes: [{ field: 'status', value: { kind: 'value' as const, value: { kind: 'select' as const, value: [id] } } }] }] })
    expect(doneOptionOf(task)?.id).toBe('done')
    expect(dropOptionOf(task)?.id).toBe('cancelled')
    expect(dropOptionOf({ ...task, quickActions: dropAction('dropped') })?.id).toBe('dropped')
    expect(dropOptionOf({ ...task, quickActions: dropAction('done') })?.id).toBe('cancelled')
    expect(dropOptionOf({ ...task, quickActions: dropAction('next') })?.id).toBe('cancelled')
    expect(dropOptionOf(base)).toBeUndefined()
  })

  it('incoming is the type’s own list, else Inbox, else nothing', () => {
    expect(triageOptionsOf(task).map((o) => o.id)).toEqual(['in'])
    expect(triageOptionsOf({ ...task, quickActions: { triageStatuses: ['next', 'done'] } }).map((o) => o.id)).toEqual(['next'])
    expect(triageOptionsOf({ ...task, quickActions: { triageStatuses: [] } })).toEqual([])
    expect(triageOptionsOf(base)).toEqual([])
    expect(triageOptionsOf(page)).toEqual([])
  })

  it('reopens to the status it had, else the first to-do option that is not incoming', () => {
    expect(reopenOptionOf(task)?.id).toBe('next')
    expect(reopenOptionOf(task, at('doing').props.status)?.id).toBe('doing')
    expect(reopenOptionOf(task, at('done').props.status)?.id).toBe('next')
    expect(reopenOptionOf(base)?.id).toBe('todo')
    // Only an incoming to-do option: still an open status, rather than none.
    const onlyInbox = withOptions([{ id: 'in', label: 'Inbox', status: 'todo' }, { id: 'done', label: 'Done', status: 'done' }])
    expect(reopenOptionOf(onlyInbox)?.id).toBe('in')
  })
})

describe('the actions that close and reopen', () => {
  it('Done and Drop are the type’s own actions that set them, else the built-in ones', () => {
    expect(doneActionOf(task)?.name).toBe('Mark done')
    expect(dropActionOf(task)?.name).toBe('Drop')
    const own = { id: 'finish', name: 'Finish', changes: [{ field: 'status', value: { kind: 'value' as const, value: { kind: 'select' as const, value: ['done'] } } }, { field: 'next', value: { kind: 'clear' as const } }] }
    const custom = { ...task, quickActions: { actions: [own] }, properties: [...task.properties, { id: 'next', kind: 'text' as const, name: 'Next step' }] }
    expect(doneActionOf(custom)?.id).toBe('finish')
    // No action of its own sets Drop: the plain one.
    expect(dropActionOf(custom)?.changes).toEqual([{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['cancelled'] } } }])
    expect(quickActionsOf(custom).map((a) => a.id)).toEqual(['finish'])
  })

  it('a status without an action of its own gets a plain one', () => {
    const doing = task.properties.find((p) => p.id === 'status' && p.kind === 'select')!
    if (doing.kind !== 'select') throw new Error('status is a select')
    expect(statusActionOf(task, doing.options[2]!).name).toBe('Doing')
    expect(doneActionOf(page)).toBeUndefined()
  })

  it('reopen sets the option that reopens, named for the notice', () => {
    expect(reopenActionOf(task)?.changes).toEqual([{ field: 'status', value: { kind: 'value', value: { kind: 'select', value: ['next'] } } }])
    expect(reopenActionOf(task, at('doing').props.status)?.changes[0]?.value).toEqual({ kind: 'value', value: { kind: 'select', value: ['doing'] } })
    expect(reopenActionOf(page)).toBeUndefined()
  })
})
