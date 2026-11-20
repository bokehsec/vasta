import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, reactive, ref } from 'vue'
import { allReminderTasksHandled, mergeReminderTasks, useHandledReminderTasks, type ReminderTask } from './reminder-tasks.ts'

const task = (id: string) => ({ id, title: id, typeId: 'task', due: '2026-11-20T00:00:00.000Z' })
const initial = () => mergeReminderTasks([], { tasks: [task('one'), task('two')], planned: [{ id: 'three', title: 'three', typeId: 'task', day: '2026-11-20' }] })
const scopes: ReturnType<typeof effectScope>[] = []

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})

it('keeps done and moved rows in their original groups across polls, without duplicates', () => {
  const rows = initial()
  rows[0]!.done = true
  rows[1]!.movedTo = '2026-11-21'
  rows[2]!.movedTo = '2026-11-23'
  const polled = mergeReminderTasks(rows, { tasks: [task('two'), task('four')], planned: [] })
  expect(polled.map((row) => row.id)).toEqual(['one', 'two', 'three', 'four'])
  expect(polled[0]).toMatchObject({ done: true, group: 'due' })
  expect(polled[1]).toMatchObject({ movedTo: '2026-11-21', group: 'due' })
  expect(polled[2]).toMatchObject({ movedTo: '2026-11-23', group: 'planned' })
  expect(allReminderTasksHandled(polled)).toBe(false)
})

it('does not count an empty list, an unhandled task or an unfinished save as handled', () => {
  expect(allReminderTasksHandled([])).toBe(false)
  const rows = initial()
  expect(allReminderTasksHandled(rows)).toBe(false)
  rows[0]!.done = true
  rows[1]!.movedTo = '2026-11-21'
  rows[2]!.movedTo = '2026-11-24'
  expect(allReminderTasksHandled(rows)).toBe(true)
  rows[1]!.busy = true
  expect(allReminderTasksHandled(rows)).toBe(false)
  rows[1]!.busy = false
  rows[1]!.error = 'Could not undo'
  expect(allReminderTasksHandled(rows)).toBe(false)
})

function timed(rows: ReminderTask[], enabled = ref(true)) {
  vi.useFakeTimers()
  const state = reactive(rows)
  const answer = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useHandledReminderTasks(() => state, () => enabled.value, answer))
  return { state, answer, scope, enabled }
}

it('answers after a beat when one task is done and the other two are moved', () => {
  const { state, answer } = timed(initial())
  state[0]!.done = true
  state[1]!.movedTo = '2026-11-21'
  state[2]!.movedTo = '2026-11-24'
  vi.advanceTimersByTime(999)
  expect(answer).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(answer).toHaveBeenCalledTimes(1)
})

it('cancels the beat as soon as undo starts, and waits for a new successful action', () => {
  const { state, answer } = timed(initial())
  state.forEach((row) => { row.done = true })
  vi.advanceTimersByTime(900)
  state[0]!.busy = true
  vi.advanceTimersByTime(1000)
  expect(answer).not.toHaveBeenCalled()
  state[0]!.done = false
  state[0]!.busy = false
  vi.advanceTimersByTime(1000)
  expect(answer).not.toHaveBeenCalled()
  state[0]!.done = true
  vi.advanceTimersByTime(1000)
  expect(answer).toHaveBeenCalledTimes(1)
})

it('cancels when answered elsewhere, a drawer opens or the component goes away', () => {
  const { state, answer, scope, enabled } = timed(initial())
  state.forEach((row) => { row.done = true })
  vi.advanceTimersByTime(900)
  enabled.value = false
  vi.advanceTimersByTime(1000)
  expect(answer).not.toHaveBeenCalled()
  enabled.value = true
  scope.stop()
  vi.advanceTimersByTime(1000)
  expect(answer).not.toHaveBeenCalled()
})

it('waits for newly listed tasks rather than answering for an old snapshot', () => {
  const { state, answer } = timed(initial())
  state.forEach((row) => { row.done = true })
  vi.advanceTimersByTime(900)
  state.push(...mergeReminderTasks([], { tasks: [task('new')] }))
  vi.advanceTimersByTime(1000)
  expect(answer).not.toHaveBeenCalled()
})

it('does not retry a failed answer every second without another task action', () => {
  const { state, answer, enabled } = timed(initial())
  state.forEach((row) => { row.done = true })
  vi.advanceTimersByTime(1000)
  expect(answer).toHaveBeenCalledTimes(1)
  enabled.value = false
  enabled.value = true
  vi.advanceTimersByTime(5000)
  expect(answer).toHaveBeenCalledTimes(1)
})
