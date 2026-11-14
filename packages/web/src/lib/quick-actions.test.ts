import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinTypes, quickActionsOf, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { completeRepeat } from '@vasta/core/calendar'

// The runner talks to the server and the app's state only through these: stand in for them.
const setProperties = vi.fn()
vi.mock('./actions.ts', () => ({ dayKey: () => '2026-11-13', setProperties: (...args: unknown[]) => setProperties(...args) }))
vi.mock('./calendar.ts', () => ({ nextWeekStart: () => '2026-11-15' }))
vi.mock('./format.ts', () => ({ formatLongDay: (iso: string) => `<${iso.slice(0, 10)}>` }))
vi.mock('./session.ts', () => ({ session: { user: { id: 'u1' } } }))
vi.mock('./state.ts', () => ({ lastError: { value: '' }, notice: { value: null } }))
const openStepsNote = vi.fn()
vi.mock('./subtasks.ts', () => ({ openStepsNote: (...args: unknown[]) => openStepsNote(...args) }))

const { quickAsk, runQuickAction } = await import('./quick-actions.ts')
const { lastError, notice } = await import('./state.ts')

const AT = '2026-11-13T12:00:00.000Z'
const task = createBuiltinTypes('s', AT).find((t) => t.system === 'task')!
const done = quickActionsOf(task).find((a) => a.id === 'done')!
const defer = quickActionsOf(task).find((a) => a.id === 'defer')!
const status = (id: string): PropertyValue => ({ kind: 'select', value: [id] })
const day = (value: string, rrule?: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })
const open = (id: string, due?: PropertyValue) => ({ id, props: { status: status('todo'), ...(due ? { due } : {}) } as Record<string, PropertyValue> })
const message = () => (notice.value as { message: string; action?: { run: () => Promise<unknown> } } | null)!

beforeEach(() => {
  setProperties.mockReset()
  openStepsNote.mockReset()
  lastError.value = ''
  notice.value = null
})

describe('runQuickAction', () => {
  it('asks once for many objects and saves each with its own values', async () => {
    const save = vi.fn(async () => {})
    const objects = [open('a', day('2026-11-01')), open('b', day('2026-11-02', 'FREQ=WEEKLY')), open('c')]
    const running = runQuickAction(task, objects, defer, { save })
    // One question for all three, nothing saved before it is answered.
    expect(quickAsk.value?.def.id).toBe('due')
    expect(save).not.toHaveBeenCalled()
    quickAsk.value!.answer(day('2026-11-20'))
    const saved = await running
    expect(quickAsk.value).toBeNull()
    expect(saved.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(save).toHaveBeenCalledTimes(3)
    const values = Object.fromEntries(saved.map((e) => [e.id, e.values.due]))
    expect(values.a).toEqual(day('2026-11-20'))
    expect(values.b).toEqual(day('2026-11-20', 'FREQ=WEEKLY'))
    expect(message().message).toBe('Defer · Due <2026-11-20> · 3 tasks')
  })

  it('does nothing when the question is dismissed', async () => {
    const save = vi.fn()
    const running = runQuickAction(task, [open('a')], defer, { save })
    quickAsk.value!.answer(null)
    expect(await running).toEqual([])
    expect(save).not.toHaveBeenCalled()
    expect(notice.value).toBeNull()
  })

  it('counts the ones that fail, says so, and Undo puts back only the ones saved', async () => {
    const save = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('offline')
    })
    const saved = await runQuickAction(task, [open('a'), open('b'), open('c')], done, { save })
    expect(saved.map((e) => e.id)).toEqual(['a', 'c'])
    expect(lastError.value).toBe('offline')
    expect(message().message).toBe('Done · 2 tasks · 1 not saved')
    save.mockClear()
    await message().action!.run()
    expect(save.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c'])
    expect(save).toHaveBeenCalledWith('a', { status: status('todo') })
  })

  it('shows no notice when nothing saved', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await runQuickAction(task, [open('a')], done, { save })).toEqual([])
    expect(lastError.value).toBe('offline')
    expect(notice.value).toBeNull()
  })

  it('Undo of Done on repeating tasks puts the date back on the occurrence it had', async () => {
    const weekly = day('2026-11-13', 'FREQ=WEEKLY')
    const objects = [open('r1', weekly), open('r2', day('2026-11-14', 'FREQ=DAILY')), open('plain', day('2026-11-13'))]
    // The server's side of a save: the object as edited goes through completeRepeat.
    const store = new Map(objects.map((o) => [o.id, { ...o, typeId: task.id, title: o.id } as unknown as ObjectRecord]))
    const original = new Map([...store].map(([id, o]) => [id, structuredClone(o.props)]))
    const save = async (id: string, values: Record<string, PropertyValue | undefined>) => {
      const stored = store.get(id)!
      const props = { ...stored.props }
      for (const [field, value] of Object.entries(values)) {
        if (value) props[field] = value
        else delete props[field]
      }
      store.set(id, completeRepeat({ ...stored, props }, stored, task, 'UTC'))
    }
    await runQuickAction(task, objects, done, { save })
    expect(store.get('r1')!.props.due).not.toEqual(weekly)
    expect(store.get('plain')!.props.status).toEqual(status('done'))
    await message().action!.run()
    for (const [id, props] of original) expect(store.get(id)!.props).toEqual(props)
  })

  it('offers to move the due date with a day asked for another date, and Undo puts both back', async () => {
    // A task whose Defer sets a "Do date" (as a triage setup has it).
    const triage = { ...task, properties: [...task.properties, { id: 'dodate', kind: 'date' as const, name: 'Do date' }], quickActions: { deferField: 'dodate' } }
    const deferDo = quickActionsOf(triage).find((a) => a.id === 'defer')!
    const saved = new Map<string, Record<string, PropertyValue | undefined>>()
    const save = vi.fn(async (id: string, values: Record<string, PropertyValue | undefined>) => void saved.set(id, values))
    const objects = [open('late', day('2026-11-18')), open('fine', day('2026-11-30')), open('weekly', day('2026-11-18', 'FREQ=WEEKLY')), open('none')]
    let running = runQuickAction(triage, objects, deferDo, { save })
    // Two due dates a later day could move: the one that repeats and the task without one do not count.
    expect(quickAsk.value!.dueMovable).toBe(2)
    quickAsk.value!.answer(day('2026-11-20'), true)
    await running
    expect(saved.get('late')).toEqual({ dodate: day('2026-11-20'), due: day('2026-11-20') })
    expect(saved.get('fine')).toEqual({ dodate: day('2026-11-20') })
    expect(saved.get('weekly')).toEqual({ dodate: day('2026-11-20') })
    expect(message().message).toBe('Defer · Do date <2026-11-20> · 4 tasks · 1 due date moved too')
    await message().action!.run()
    expect(saved.get('late')).toEqual({ dodate: undefined, due: day('2026-11-18') })
    // The box off: the due date stays, and the notice says the day is after it.
    running = runQuickAction(triage, objects[0]!, deferDo, { save })
    quickAsk.value!.answer(day('2026-11-20'), false)
    await running
    expect(saved.get('late')).toEqual({ dodate: day('2026-11-20') })
    expect(message().message).toBe('Defer · Do date <2026-11-20> (after its due date, <2026-11-18>)')
    // Defer that sets the due date itself has nothing to offer.
    running = runQuickAction(task, objects[0]!, defer, { save })
    expect(quickAsk.value!.dueMovable).toBe(0)
    quickAsk.value!.answer(null)
    await running
  })

  it('adds the runner’s own "subtasks still open" for the parents it closed, unless the caller words it', async () => {
    openStepsNote.mockReturnValue('2 subtasks still open')
    const save = vi.fn(async () => {})
    const closing = [open('a'), open('b')]
    await runQuickAction(task, closing, done, { save })
    expect(message().message).toBe('Done · 2 tasks · 2 subtasks still open')
    expect(openStepsNote.mock.calls[0]![1].map((o: { id: string }) => o.id)).toEqual(['a', 'b'])
    // An action that closes nothing (Defer) asks about no parent.
    const running = runQuickAction(task, [open('c')], defer, { save })
    quickAsk.value!.answer(day('2026-11-20'))
    await running
    expect(openStepsNote.mock.calls[1]![1]).toEqual([])
    await runQuickAction(task, [open('d')], done, { save, note: () => 'said by the page' })
    expect(message().message).toBe('Done · said by the page')
  })
})
