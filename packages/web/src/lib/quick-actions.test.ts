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
const openStepsOf = vi.fn()
vi.mock('./subtasks.ts', () => ({ openStepsOf: (...args: unknown[]) => openStepsOf(...args) }))
const choiceDialog = vi.fn()
vi.mock('./overlays.ts', () => ({ choiceDialog: (...args: unknown[]) => choiceDialog(...args) }))

const { quickAsk, runQuickAction, textProblem, textAnswer } = await import('./quick-actions.ts')
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
  openStepsOf.mockReset()
  openStepsOf.mockResolvedValue([])
  choiceDialog.mockReset()
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

  it('offers retries for only failed objects and keeps narrowing after another failure', async () => {
    let failing = new Set(['b', 'c'])
    const save = vi.fn(async (id: string) => {
      if (failing.has(id)) throw new Error('offline')
    })
    const onFailed = vi.fn()
    const saved = await runQuickAction(task, [open('a'), open('b'), open('c')], done, { save, onFailed })
    expect(saved.map((edit) => edit.id)).toEqual(['a'])
    expect(onFailed).toHaveBeenCalledTimes(1)
    save.mockClear()
    failing = new Set(['c'])
    expect((await onFailed.mock.calls[0]![0]()).map((edit: { id: string }) => edit.id)).toEqual(['b'])
    expect(save.mock.calls.map(([id]) => id)).toEqual(['b', 'c'])
    expect(onFailed).toHaveBeenCalledTimes(2)
    save.mockClear()
    failing.clear()
    expect((await onFailed.mock.calls[1]![0]()).map((edit: { id: string }) => edit.id)).toEqual(['c'])
    expect(save.mock.calls.map(([id]) => id)).toEqual(['c'])
    save.mockClear()
    await message().action!.run()
    expect(save.mock.calls).toEqual(['a', 'b', 'c'].map((id) => [id, { status: status('todo') }]))
    expect(message().message).toBe('Done · 3 tasks')
  })

  it('offers Retry after every unprompted save fails', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const onFailed = vi.fn()
    expect(await runQuickAction(task, [open('a')], done, { save, onFailed })).toEqual([])
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect((await onFailed.mock.calls[0]![0]()).map((edit: { id: string }) => edit.id)).toEqual(['a'])
  })

  it('retries a partially saved question with the original answer and without asking again', async () => {
    let offline = true
    const save = vi.fn(async (id: string) => {
      if (offline && id === 'b') throw new Error('offline')
    })
    const onFailed = vi.fn()
    const running = runQuickAction(task, [open('a'), open('b')], defer, { save, onFailed })
    await quickAsk.value!.answer(day('2026-11-20'))
    expect((await running).map((edit) => edit.id)).toEqual(['a'])
    expect(quickAsk.value).toBeNull()
    offline = false
    save.mockClear()
    const retried = await onFailed.mock.calls[0]![0]()
    expect(retried.map((edit: { id: string }) => edit.id)).toEqual(['b'])
    expect(save.mock.calls).toEqual([['b', { due: day('2026-11-20') }]])
    expect(quickAsk.value).toBeNull()
  })

  it('keeps a completely failed question open with its own Retry rather than a bulk retry', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const onFailed = vi.fn()
    const running = runQuickAction(task, [open('a')], defer, { save, onFailed })
    await quickAsk.value!.answer(day('2026-11-20'))
    expect(quickAsk.value!.state).toEqual({ saving: false, error: 'offline' })
    expect(onFailed).not.toHaveBeenCalled()
    await quickAsk.value!.answer(null)
    expect(await running).toEqual([])
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

  describe('closing a task with open subtasks', () => {
    const steps = [open('s1'), open('s2')]
    const saveAll = () => {
      const saved: [string, Record<string, PropertyValue | undefined>][] = []
      setProperties.mockImplementation(async (id: string, values: Record<string, PropertyValue | undefined>) => void saved.push([id, values]))
      return saved
    }

    it('asks once and closes them with the parent when told to; one Undo puts all back', async () => {
      openStepsOf.mockResolvedValue(steps)
      choiceDialog.mockResolvedValue('close')
      const saved = saveAll()
      const save = vi.fn(async () => {})
      await runQuickAction(task, [open('p')], done, { save })
      expect(choiceDialog).toHaveBeenCalledTimes(1)
      expect(choiceDialog.mock.calls[0]![0].title).toBe('Close its 2 open subtasks too?')
      expect(choiceDialog.mock.calls[0]![0].choices.map((c: { label: string }) => c.label)).toEqual(['Close them too', 'Leave open'])
      expect(saved).toEqual([['s1', { status: status('done') }], ['s2', { status: status('done') }]])
      expect(message().message).toBe('Done · 2 subtasks closed too')
      saved.length = 0
      await message().action!.run()
      expect(save).toHaveBeenLastCalledWith('p', { status: status('todo') })
      expect(saved).toEqual([['s1', { status: status('todo') }], ['s2', { status: status('todo') }]])
    })

    it('still asks when the page has already changed the object it ran on (the task page edits it in place)', async () => {
      openStepsOf.mockResolvedValue(steps)
      choiceDialog.mockResolvedValue('leave')
      const parent = open('p')
      await runQuickAction(task, [parent], done, { save: async (_id, values) => void Object.assign(parent.props, values) })
      expect(choiceDialog).toHaveBeenCalledTimes(1)
      expect(message().message).toBe('Done · 2 subtasks still open')
    })

    it('leaves them open when asked to, or when the question is dismissed, and says so', async () => {
      openStepsOf.mockResolvedValue(steps)
      const save = vi.fn(async () => {})
      choiceDialog.mockResolvedValue('leave')
      await runQuickAction(task, [open('p')], done, { save })
      expect(message().message).toBe('Done · 2 subtasks still open')
      choiceDialog.mockResolvedValue(null)
      await runQuickAction(task, [open('q')], done, { save })
      expect(message().message).toBe('Done · 2 subtasks still open')
      expect(setProperties).not.toHaveBeenCalled()
    })

    it('closes the subtasks of a dropped parent by dropping them', async () => {
      const withDrop = { ...task, properties: task.properties.map((p) => (p.id === 'status' && p.kind === 'select' ? { ...p, options: [...p.options, { id: 'dropped', label: 'Dropped', status: 'done' as const }] } : p)) }
      const drop = quickActionsOf(withDrop).find((a) => a.id === 'drop')!
      openStepsOf.mockResolvedValue([open('s1')])
      choiceDialog.mockResolvedValue('close')
      const saved = saveAll()
      await runQuickAction(withDrop, [open('p')], drop, { save: async () => {} })
      expect(choiceDialog.mock.calls[0]![0].title).toBe('Close its open subtask too?')
      expect(saved).toEqual([['s1', { status: status('dropped') }]])
    })

    it('asks about nothing for an action that does not close, or a repeating task done, or no open subtasks', async () => {
      openStepsOf.mockResolvedValue(steps)
      const save = vi.fn(async () => {})
      const running = runQuickAction(task, [open('c')], defer, { save })
      quickAsk.value!.answer(day('2026-11-20'))
      await running
      await runQuickAction(task, [open('r', day('2026-11-20', 'FREQ=WEEKLY'))], done, { save })
      openStepsOf.mockResolvedValue([])
      await runQuickAction(task, [open('d')], done, { save })
      expect(choiceDialog).not.toHaveBeenCalled()
      expect(message().message).toBe('Done')
    })
  })

  it('calls onSaved with the saved edits, and onUndo with only the ones Undo restored', async () => {
    let offline = false
    const save = vi.fn(async (id: string) => {
      if (offline && id === 'b') throw new Error('offline')
    })
    const onSaved = vi.fn()
    const onUndo = vi.fn()
    const saved = await runQuickAction(task, [open('a'), open('b'), open('c')], done, { save, onSaved, onUndo })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(onUndo).not.toHaveBeenCalled()
    offline = true
    await message().action!.run()
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onUndo.mock.calls[0]![0].map((e: { id: string }) => e.id)).toEqual(['a', 'c'])
    expect(lastError.value).toBe('offline')
    // Pressing Undo again tries the one that is left, and says only that one.
    offline = false
    await message().action!.run()
    expect(onUndo.mock.calls[1]![0].map((e: { id: string }) => e.id)).toEqual(['b'])
    await message().action!.run()
    expect(onUndo).toHaveBeenCalledTimes(2)
  })

  it('calls neither callback for a question that is cancelled or saved nothing', async () => {
    const onSaved = vi.fn()
    const onUndo = vi.fn()
    const running = runQuickAction(task, [open('a')], defer, { save: vi.fn(), onSaved, onUndo })
    await quickAsk.value!.answer(null)
    expect(await running).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('keeps the question open when nothing saves, to retry or cancel, and saves once on retry', async () => {
    let offline = true
    const save = vi.fn(async () => {
      if (offline) throw new Error('offline')
    })
    const running = runQuickAction(task, [open('a')], defer, { save })
    const question = quickAsk.value!
    await question.answer(day('2026-11-20'))
    // Still there, with why, and nothing said as saved.
    expect(quickAsk.value).toBe(question)
    expect(question.state).toEqual({ saving: false, error: 'offline' })
    expect(notice.value).toBeNull()
    offline = false
    await question.answer(day('2026-11-21'))
    const saved = await running
    expect(quickAsk.value).toBeNull()
    expect(saved.map((e) => e.values.due)).toEqual([day('2026-11-21')])
    expect(message().message).toBe('Defer · Due <2026-11-21>')
    // Cancel after a failure writes nothing more.
    save.mockClear()
    offline = true
    const again = runQuickAction(task, [open('a')], defer, { save })
    await quickAsk.value!.answer(day('2026-11-20'))
    await quickAsk.value!.answer(null)
    expect(await again).toEqual([])
    expect(quickAsk.value).toBeNull()
  })

  it('takes one answer at a time: a second while saving is ignored, Cancel too', async () => {
    const releases: (() => void)[] = []
    const save = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)))
    const running = runQuickAction(task, [open('a'), open('b')], defer, { save })
    const question = quickAsk.value!
    const first = question.answer(day('2026-11-20'))
    expect(question.state.saving).toBe(true)
    await question.answer(day('2026-11-22'))
    await question.answer(null)
    expect(quickAsk.value).toBe(question)
    expect(save).toHaveBeenCalledTimes(2)
    releases.forEach((release) => release())
    await first
    const saved = await running
    expect(saved.map((e) => e.values.due)).toEqual([day('2026-11-20'), day('2026-11-20')])
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('closes the question when only some objects saved, with the others counted in the notice', async () => {
    const save = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('offline')
    })
    const running = runQuickAction(task, [open('a'), open('b')], defer, { save })
    await quickAsk.value!.answer(day('2026-11-20'))
    const saved = await running
    expect(saved.map((e) => e.id)).toEqual(['a'])
    expect(quickAsk.value).toBeNull()
    expect(lastError.value).toBe('offline')
    expect(message().message).toBe('Defer · Due <2026-11-20> · 1 not saved')
  })

  it('says what it applies to, what the button says, and where the due dates would go', async () => {
    const triage = { ...task, properties: [...task.properties, { id: 'dodate', kind: 'date' as const, name: 'Do date' }], quickActions: { deferField: 'dodate' } }
    const deferDo = quickActionsOf(triage).find((a) => a.id === 'defer')!
    const objects = [open('late', day('2026-11-18')), open('weekly', day('2026-11-18', 'FREQ=WEEKLY')), open('none')]
    let running = runQuickAction(triage, objects, deferDo, { save: vi.fn(), noun: (n) => `${n} things`, submitLabel: 'Save & next task' })
    expect(quickAsk.value).toMatchObject({ count: 3, scope: '3 things', submitLabel: 'Save & next task', day: undefined, closes: false })
    expect(quickAsk.value!.dueMoves('2026-11-20')).toEqual({ count: 1, to: undefined })
    await quickAsk.value!.answer(null)
    await running
    running = runQuickAction(triage, objects[0]!, deferDo, { save: vi.fn(), scope: 'Fix the roof' })
    expect(quickAsk.value).toMatchObject({ count: 1, scope: 'Fix the roof', submitLabel: 'Save', closes: undefined, due: '2026-11-18' })
    expect(quickAsk.value!.dueMoves('2026-11-20')).toEqual({ count: 1, to: '2026-11-20' })
    expect(quickAsk.value!.dueMoves('2026-11-17')).toEqual({ count: 0, to: undefined })
    await quickAsk.value!.answer(null)
    await running
  })

  it('knows a custom action that also closes, so the question does not say the task stays open', async () => {
    const status_ = task.properties.find((p) => p.id === 'status')
    const doneId = (status_ as { options: { id: string; status?: string }[] }).options.find((o) => o.status === 'done')!.id
    const withNext = { ...task, properties: [...task.properties, { id: 'next', kind: 'text' as const, name: 'Next step' }] }
    const closeAndAsk = { id: 'close-note', name: 'Close with note', changes: [{ field: 'status', value: { kind: 'value' as const, value: status(doneId) } }, { field: 'next', value: { kind: 'ask' as const } }] }
    const keepAndAsk = { id: 'note', name: 'Next step', changes: [{ field: 'next', value: { kind: 'ask' as const } }] }
    let running = runQuickAction(withNext, [open('a')], closeAndAsk, { save: vi.fn(), submitLabel: 'Save & next task' })
    expect(quickAsk.value!.closes).toBe(true)
    await quickAsk.value!.answer(null)
    await running
    running = runQuickAction(withNext, [open('a')], keepAndAsk, { save: vi.fn(), submitLabel: 'Save & next task' })
    expect(quickAsk.value!.closes).toBe(false)
    await quickAsk.value!.answer(null)
    await running
  })
})

describe('text answers', () => {
  const next = { id: 'next', kind: 'text' as const, name: 'Next step' }
  const amount = { id: 'amount', kind: 'number' as const, name: 'Hours' }
  it('keeps an invalid number out of the no-op path and says what is wrong', () => {
    expect(textProblem(amount, '3,5')).toBeUndefined()
    expect(textProblem(amount, '')).toBeUndefined()
    expect(textProblem(amount, 'soon')).toBe('Enter a number for Hours, like 3 or 2.5')
    expect(textProblem(next, 'soon')).toBeUndefined()
    expect(textAnswer(amount, '3,5', '', true)).toEqual({ kind: 'number', value: 3.5 })
  })
  it('an unchanged line is nothing to do, an empty one clears', () => {
    expect(textAnswer(next, ' Call ', 'Call', true)).toBeNull()
    expect(textAnswer(next, ' Call ', 'Call', false)).toEqual({ kind: 'text', value: 'Call' })
    expect(textAnswer(next, '  ', 'Call', true)).toBe('clear')
  })
})
