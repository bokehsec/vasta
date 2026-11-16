import { beforeEach, expect, it, vi } from 'vitest'
import { createBuiltinTypes, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { completeRepeat } from '@vasta/core/calendar'

const { object, setProperties } = vi.hoisted(() => ({ object: vi.fn(), setProperties: vi.fn() }))
vi.mock('./api.ts', () => ({ api: { object } }))
vi.mock('./actions.ts', () => ({ dayKey: () => '2026-11-15', setProperties }))
vi.mock('./state.ts', () => ({ primeFromObject: vi.fn(), lastError: { value: '' }, notice: { value: null } }))
vi.mock('./session.ts', () => ({ session: { user: { id: 'tester' } } }))
vi.mock('./subtasks.ts', () => ({ openStepsOf: vi.fn(async () => []) }))
vi.mock('./format.ts', () => ({ formatLongDay: (value: string) => value.slice(0, 10) }))

import { setTaskDone } from './task-completion.ts'
import { notice } from './state.ts'

const task = createBuiltinTypes('space', '2026-11-15T12:00:00.000Z').find((type) => type.system === 'task')!
const statusField = task.properties.find((property) => property.id === 'status')!
if (statusField.kind === 'select') statusField.options.push({ id: 'next', label: 'Next', status: 'todo' })
const status = (value: string): PropertyValue => ({ kind: 'select', value: [value] })
const due = (rule = 'FREQ=DAILY'): PropertyValue => ({ kind: 'date', value: { start: '2026-11-15T00:00:00.000Z', resolution: 'day', rrule: rule } })
let stored: ObjectRecord

beforeEach(() => {
  object.mockReset()
  setProperties.mockReset()
  notice.value = null
  stored = { id: 'task', typeId: task.id, title: 'Task', props: { status: status('next') }, content: {} } as unknown as ObjectRecord
  object.mockImplementation(async () => structuredClone(stored))
  setProperties.mockImplementation(async (_id: string, values: Record<string, PropertyValue | undefined>) => {
    const edited = { ...stored, props: { ...stored.props } }
    for (const [field, value] of Object.entries(values)) {
      if (value) edited.props[field] = value
      else delete edited.props[field]
    }
    stored = completeRepeat(edited, stored, task, 'America/Toronto')
    return stored
  })
})

const undo = async () => (notice.value as unknown as { action: { run: () => Promise<void> } }).action.run()

it('checkbox completion has an Undo that restores Next, not the default To do', async () => {
  await setTaskDone(stored.id, task, true)
  expect(stored.props.status).toEqual(status('done'))
  await undo()
  expect(stored.props.status).toEqual(status('next'))
})

it('checkbox Undo restores the exact occurrence and its previous status', async () => {
  const previousDue = due()
  stored.props.due = previousDue
  await setTaskDone(stored.id, task, true)
  expect(stored.props.due).not.toEqual(previousDue)
  expect(stored.props.status).toEqual(status('next'))
  await undo()
  expect(stored.props.due).toEqual(previousDue)
  expect(stored.props.status).toEqual(status('next'))
})

it('the last repeat completes normally', async () => {
  stored.props.due = due('FREQ=DAILY;COUNT=1')
  await setTaskDone(stored.id, task, true)
  expect(stored.props.status).toEqual(status('done'))
  await undo()
  expect(stored.props.status).toEqual(status('next'))
})

it('rapid repeat taps fetch and complete once', async () => {
  stored.props.due = due()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  object.mockImplementation(async () => { await gate; return structuredClone(stored) })
  const first = setTaskDone(stored.id, task, true)
  await expect(setTaskDone(stored.id, task, true)).resolves.toBeUndefined()
  release()
  await first
  expect(object).toHaveBeenCalledTimes(1)
  expect(setProperties).toHaveBeenCalledTimes(1)
  expect(stored.props.due?.kind === 'date' && stored.props.due.value.start).toBe('2026-11-16T00:00:00.000Z')
})

it('a failed fetch releases the guard for a retry', async () => {
  object.mockRejectedValueOnce(new Error('offline'))
  await expect(setTaskDone(stored.id, task, true)).rejects.toThrow('offline')
  await setTaskDone(stored.id, task, true)
  expect(stored.props.status).toEqual(status('done'))
})

it('the circle runs the type’s own Done, so it does what the Done button does', async () => {
  const finish = { id: 'finish', name: 'Finish', changes: [{ field: 'status', value: { kind: 'value' as const, value: status('done') } }, { field: 'due', value: { kind: 'clear' as const } }] }
  const custom = { ...task, quickActions: { actions: [finish] } }
  stored.props.due = due('FREQ=WEEKLY;COUNT=1')
  const previousDue = stored.props.due
  await setTaskDone(stored.id, custom, true)
  expect(stored.props.status).toEqual(status('done'))
  expect(stored.props.due).toBeUndefined()
  expect((notice.value as unknown as { message: string }).message).toBe('Finish')
  await undo()
  expect(stored.props.due).toEqual(previousDue)
  expect(stored.props.status).toEqual(status('next'))
})

it('a type with no Done action of its own gets the built-in one', async () => {
  const custom = { ...task, quickActions: { actions: [{ id: 'later', name: 'Later', changes: [{ field: 'due', value: { kind: 'day' as const, days: 1 } }] }] } }
  await setTaskDone(stored.id, custom, true)
  expect(stored.props.status).toEqual(status('done'))
})

it('unticking a closed task reopens it as a to-do status, never back into triage', async () => {
  const withInbox = { ...task, properties: task.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [{ id: 'in', label: 'Inbox', status: 'todo' as const }, ...p.options] } : p)) }
  stored.props.status = status('done')
  await setTaskDone(stored.id, withInbox, false)
  expect(stored.props.status).toEqual(status('todo'))
  expect((notice.value as unknown as { message: string }).message).toBe('Reopened')
})
