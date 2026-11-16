import { beforeEach, expect, it, vi } from 'vitest'
import type { ObjectType } from '@vasta/core'

const { workspace, saveType, replaceType, unsavedTypes } = vi.hoisted(() => {
  const workspace = { types: [] as ObjectType[] }
  return {
    workspace,
    unsavedTypes: new Map<string, ObjectType>(),
    saveType: vi.fn<(type: ObjectType) => Promise<ObjectType>>(),
    replaceType: vi.fn((type: ObjectType) => { workspace.types = [type] }),
  }
})
vi.mock('./api.ts', () => ({ api: { saveType } }))
vi.mock('./state.ts', () => ({ workspace, replaceType, unsavedTypes }))
import { saveHabitProgress } from './habit-progress.ts'

beforeEach(() => {
  vi.clearAllMocks()
  workspace.types = [{ id: 'habit', name: 'Habit' } as ObjectType]
})

it('serializes rapid choices, merges them against the latest state and ignores older responses', async () => {
  let finish!: (type: ObjectType) => void
  saveType.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  saveType.mockImplementationOnce(async (type) => type)
  const stale = workspace.types[0]!
  const first = saveHabitProgress(stale, { chart: 'line' })
  await vi.waitFor(() => expect(saveType).toHaveBeenCalledTimes(1))
  const second = saveHabitProgress(stale, { weeks: 13 })
  expect(workspace.types[0]!.habits).toMatchObject({ chart: 'line', weeks: 13 })
  expect(saveType).toHaveBeenCalledTimes(1)
  // An unrelated edit should survive when the queued request starts.
  workspace.types[0]!.name = 'My habits'
  finish(saveType.mock.calls[0]![0])
  await first
  expect(workspace.types[0]!.habits?.weeks).toBe(13)
  await second
  expect(saveType.mock.calls[1]![0]).toMatchObject({ name: 'My habits', habits: { chart: 'line', weeks: 13 } })
  expect(workspace.types[0]!.habits?.weeks).toBe(13)
})

it('continues saving later choices after a request fails', async () => {
  saveType.mockRejectedValueOnce(new Error('network'))
  saveType.mockImplementationOnce(async (type) => type)
  const first = saveHabitProgress(workspace.types[0]!, { chart: 'line' })
  const failed = expect(first).rejects.toThrow('network')
  const second = saveHabitProgress(workspace.types[0]!, { weeks: 8 })
  await failed
  await second
  expect(saveType.mock.calls[1]![0].habits).toMatchObject({ chart: 'line', weeks: 8 })
})
