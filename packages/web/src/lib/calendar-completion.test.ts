import { beforeEach, expect, it, vi } from 'vitest'
import { createBuiltinTypes, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { completeRepeat } from '@vasta/core/calendar'

const { object, setProperties } = vi.hoisted(() => ({ object: vi.fn(), setProperties: vi.fn() }))
vi.mock('./api.ts', () => ({ api: { object } }))
vi.mock('./actions.ts', () => ({ dayKey: () => '2026-11-15', setProperties }))
vi.mock('./state.ts', () => ({ primeFromObject: vi.fn(), lastError: { value: '' }, notice: { value: null } }))
vi.mock('./session.ts', () => ({ session: { user: { id: 'tester' } } }))
vi.mock('./subtasks.ts', () => ({ openStepsNote: vi.fn() }))
vi.mock('./format.ts', () => ({ formatLongDay: (value: string) => value.slice(0, 10) }))

import { setTaskDone } from './calendar.ts'
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
