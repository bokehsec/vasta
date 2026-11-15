import { describe, expect, it, vi } from 'vitest'
import type { ObjectRecord, ObjectSummary, ObjectType, PropertyValue } from '@vasta/core'
import { createBuiltinTypes } from '@vasta/core'
import { createCompletionFeedback } from './completion-feedback.ts'
import type { ObjectSaveObserver } from './object-saves.ts'

const task = createBuiltinTypes('s', '2026-11-13T12:00:00.000Z').find((type) => type.system === 'task')!
const page = createBuiltinTypes('s', '2026-11-13T12:00:00.000Z').find((type) => type.system === 'page')!
const status = (value: string): PropertyValue => ({ kind: 'select', value: [value] })
const day = (value: string, rrule?: string): PropertyValue => ({ kind: 'date', value: { start: `${value}T00:00:00.000Z`, resolution: 'day', ...(rrule ? { rrule } : {}) } })

const summary = (id: string, state = 'todo', due?: PropertyValue, typeId = task.id): ObjectSummary =>
  ({ id, typeId, title: id, preview: '', props: { status: status(state), ...(due ? { due } : {}) } }) as unknown as ObjectSummary
const asRecord = (object: ObjectSummary, props: ObjectSummary['props'] = object.props) => ({ ...object, props, content: {} }) as unknown as ObjectRecord

function setup(initial: ObjectSummary[], type: ObjectType | undefined | null = task) {
  let rows = initial
  const replace = vi.fn((object: ObjectRecord | ObjectSummary) => {
    rows = rows.map((row) => (row.id === object.id ? ({ ...row, props: object.props } as ObjectSummary) : row))
  })
  const save = vi.fn(async (_id: string, _values: Record<string, PropertyValue | undefined>) => ({}))
  const failed = vi.fn()
  const feedback = createCompletionFeedback({ type: () => type ?? undefined, rows: () => rows, replace, save, failed })
  const complete = (id: string, props?: ObjectSummary['props']) => {
    const row = rows.find((candidate) => candidate.id === id)!
    return feedback.observe(asRecord(row, props ?? { ...row.props, status: status('done') }))
  }
  const reopen = (id: string) => { rows = rows.map((row) => (row.id === id ? { ...row, props: { ...row.props, status: status('todo') } } : row)) }
  return { feedback, replace, save, failed, complete, reopen, rows: () => rows }
}

const retry = () => vi.fn(async () => ({}) as ObjectRecord)

describe('retention eligibility', () => {
  it('retains a visible open task the moment its done save starts', () => {
    const { feedback, complete } = setup([summary('a'), summary('b')])
    expect(complete('a')).toBeDefined()
    expect(feedback.entries.has('a')).toBe(true)
    expect(feedback.entries.get('a')).toMatchObject({ index: 0, pending: true, repeat: false })
    expect(feedback.done(summary('a'))).toBe(true)
    expect(feedback.busy('a')).toBe(true)
    expect(feedback.busy('b')).toBe(false)
  })

  it('replaces the row with the optimistic object immediately', () => {
    const { replace, complete } = setup([summary('a')])
    complete('a')
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0]![0].props.status).toEqual(status('done'))
  })

  it('ignores a task that is not in the visible rows', () => {
    const { feedback, complete, replace } = setup([summary('a')])
    const hidden = asRecord(summary('hidden'), { status: status('done') })
    expect(feedback.observe(hidden)).toBeUndefined()
    expect(feedback.entries.size).toBe(0)
    expect(replace).not.toHaveBeenCalled()
    expect(complete('a')).toBeDefined()
  })

  it('ignores a task that was already done or closed before', () => {
    const { feedback, complete } = setup([summary('old', 'done')])
    expect(complete('old')).toBeUndefined()
    expect(feedback.entries.size).toBe(0)
  })

  it('ignores saves that do not make the task done', () => {
    const { feedback, complete } = setup([summary('a')])
    expect(complete('a', { status: status('doing') })).toBeUndefined()
    expect(feedback.entries.size).toBe(0)
  })

  it('ignores an object that is not of the task type', () => {
    const { feedback } = setup([summary('n', 'todo', undefined, page.id)])
    const note = asRecord(summary('n', 'done', undefined, page.id))
    expect(feedback.observe(note)).toBeUndefined()
    expect(feedback.entries.size).toBe(0)
  })

  it('ignores everything when the type is not the system task type or missing', () => {
    expect(setup([summary('a')], page).complete('a')).toBeUndefined()
    expect(setup([summary('a')], null).complete('a')).toBeUndefined()
  })

  it('does not start a second entry for a task already retained', () => {
    const { feedback, complete } = setup([summary('a')])
    complete('a')
    const entry = feedback.entries.get('a')
    expect(complete('a')).toBeUndefined()
    expect(feedback.entries.get('a')).toBe(entry)
  })
})

describe('placement and pin order', () => {
  it('shows the retained snapshot, otherwise the object', () => {
    const { feedback, complete, rows } = setup([summary('a'), summary('b')])
    complete('a')
    expect(feedback.placement(rows()[0]!).props.status).toEqual(status('todo'))
    expect(feedback.placement(rows()[1]!)).toBe(rows()[1])
  })

  it('keeps the snapshot independent of later replacements', () => {
    const { feedback, complete, rows } = setup([summary('a')])
    complete('a')
    expect(rows()[0]!.props.status).toEqual(status('done'))
    expect(feedback.entries.get('a')!.before.props.status).toEqual(status('todo'))
  })

  it('moves a retained row back to its original index in a fresh list', () => {
    const { feedback, complete } = setup([summary('a'), summary('b'), summary('c')])
    complete('b')
    const fresh = [summary('a'), summary('c'), summary('b'), summary('d')]
    expect(feedback.pin(fresh).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps several retained rows in their original order whatever order they arrive in', () => {
    const { feedback, complete } = setup([summary('a'), summary('b'), summary('c'), summary('d')])
    complete('c')
    complete('a')
    const fresh = [summary('b'), summary('d'), summary('a'), summary('c')]
    expect(feedback.pin(fresh).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('clamps an index beyond the list to the end', () => {
    const { feedback, complete } = setup([summary('a'), summary('b'), summary('c')])
    complete('c')
    expect(feedback.pin([summary('c'), summary('a')]).map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('pins the raw row object even when search matches stay in the list', () => {
    const { feedback, complete } = setup([summary('a'), summary('b')])
    complete('a')
    const raw = [summary('a', 'done'), summary('b')]
    const pinned = feedback.pin(raw)
    expect(pinned[0]).toBe(raw[0])
    expect(pinned.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('leaves an unretained list untouched in order', () => {
    const { feedback } = setup([])
    expect(feedback.pin([summary('b'), summary('a')]).map((row) => row.id)).toEqual(['b', 'a'])
  })
})

describe('save success', () => {
  it('stops being pending and keeps the row with the real saved props', () => {
    const { feedback, complete, replace } = setup([summary('a', 'todo', day('2026-11-20'))])
    const observer = complete('a')!
    const saved = asRecord(summary('a'), { status: status('done'), due: day('2026-11-20'), priority: status('high') })
    observer.saved!(saved)
    expect(replace).toHaveBeenLastCalledWith(saved)
    expect(feedback.entries.get('a')).toMatchObject({ pending: false, repeat: false })
    expect(feedback.done(summary('a'))).toBe(true)
  })

  it('detects a repeat when the saved task is open again with an advanced due date', () => {
    const { feedback, complete } = setup([summary('a', 'todo', day('2026-11-20', 'FREQ=WEEKLY'))])
    const observer = complete('a')!
    observer.saved!(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-27', 'FREQ=WEEKLY') }))
    expect(feedback.entries.get('a')).toMatchObject({ pending: false, repeat: true })
    expect(feedback.done(summary('a'))).toBe(true)
  })

  it('is not a repeat when the saved task stays open with the same due date', () => {
    const { feedback, complete } = setup([summary('a', 'todo', day('2026-11-20'))])
    const observer = complete('a')!
    observer.saved!(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-20') }))
    expect(feedback.entries.get('a')!.repeat).toBe(false)
  })

  it('is not a repeat when the saved task is done even if due changed', () => {
    const { feedback, complete } = setup([summary('a', 'todo', day('2026-11-20'))])
    const observer = complete('a')!
    observer.saved!(asRecord(summary('a'), { status: status('done'), due: day('2026-11-27') }))
    expect(feedback.entries.get('a')!.repeat).toBe(false)
  })
})

describe('undo', () => {
  it('writes only the exact prior status for a plain completion', async () => {
    const { feedback, complete, save } = setup([summary('a', 'doing', day('2026-11-20'))])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('done'), due: day('2026-11-20') }))
    await feedback.undo('a')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('a', { status: status('doing') })
    expect(Object.keys(save.mock.calls[0]![1])).toEqual(['status'])
  })

  it('also writes the prior due date after a repeat', async () => {
    const { feedback, complete, save } = setup([summary('a', 'doing', day('2026-11-20', 'FREQ=WEEKLY'))])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-27', 'FREQ=WEEKLY') }))
    await feedback.undo('a')
    expect(save).toHaveBeenCalledWith('a', { status: status('doing'), due: day('2026-11-20', 'FREQ=WEEKLY') })
  })

  it('does nothing while the completion is still pending or when nothing is retained', async () => {
    const { feedback, complete, save } = setup([summary('a')])
    await feedback.undo('missing')
    complete('a')
    await feedback.undo('a')
    expect(save).not.toHaveBeenCalled()
  })

  it('is busy during the undo save and settles afterwards, also when it fails', async () => {
    const { feedback, complete, save } = setup([summary('a')])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('done') }))
    let release!: () => void
    save.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}) }))
    const pending = feedback.undo('a')
    expect(feedback.busy('a')).toBe(true)
    await feedback.undo('a')
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await pending
    expect(feedback.busy('a')).toBe(false)
    save.mockRejectedValueOnce(new Error('offline'))
    await expect(feedback.undo('a')).rejects.toThrow('offline')
    expect(feedback.busy('a')).toBe(false)
    expect(feedback.entries.has('a')).toBe(true)
  })

  it('releases the row when the undo save is observed as reopening the task', () => {
    const { feedback, complete, replace } = setup([summary('a', 'doing')])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('done') }))
    const reopened = asRecord(summary('a'), { status: status('doing') })
    const observer = feedback.observe(reopened)!
    expect(feedback.entries.has('a')).toBe(false)
    expect(replace).toHaveBeenLastCalledWith(reopened)
    const final = asRecord(summary('a'), { status: status('doing'), priority: status('high') })
    observer.saved!(final)
    expect(replace).toHaveBeenLastCalledWith(final)
  })

  it('treats an unrelated reopen of a repeating task as a new save, not an undo', () => {
    const { feedback, complete } = setup([summary('a', 'todo', day('2026-11-20', 'FREQ=WEEKLY'))])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-27', 'FREQ=WEEKLY') }))
    expect(feedback.observe(asRecord(summary('a'), { status: status('todo'), due: day('2026-12-04', 'FREQ=WEEKLY') }))).toBeUndefined()
    expect(feedback.entries.has('a')).toBe(true)
  })

  it('accepts a repeat undo when the due date returns to the prior one', () => {
    const { feedback, complete } = setup([summary('a', 'todo', day('2026-11-20', 'FREQ=WEEKLY'))])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-27', 'FREQ=WEEKLY') }))
    expect(feedback.observe(asRecord(summary('a'), { status: status('todo'), due: day('2026-11-20', 'FREQ=WEEKLY') }))).toBeDefined()
    expect(feedback.entries.has('a')).toBe(false)
  })

  it('restores the retention and reports failure when an undo save fails', () => {
    const { feedback, complete, replace, failed } = setup([summary('a', 'doing')])
    complete('a')!.saved!(asRecord(summary('a'), { status: status('done') }))
    const entry = feedback.entries.get('a')!
    const observer = feedback.observe(asRecord(summary('a'), { status: status('doing') }))!
    const again = retry()
    observer.failed!(again)
    expect(feedback.entries.get('a')).toBe(entry)
    expect(replace.mock.lastCall![0].props.status).toEqual(status('done'))
    expect(failed).toHaveBeenCalledWith(again)
  })
})

describe('save failure', () => {
  it('releases the row, restores the before state and hands over the retry', () => {
    const { feedback, complete, replace, failed, rows } = setup([summary('a', 'doing', day('2026-11-20'))])
    const observer = complete('a')!
    const again = retry()
    observer.failed!(again)
    expect(feedback.entries.has('a')).toBe(false)
    expect(replace.mock.lastCall![0].props.status).toEqual(status('doing'))
    expect(rows()[0]!.props.status).toEqual(status('doing'))
    expect(failed).toHaveBeenCalledWith(again)
  })

  it('keeps rows independent when only one of several saves fails', () => {
    const { feedback, complete, failed } = setup([summary('a'), summary('b'), summary('c')])
    const observers = ['a', 'b', 'c'].map((id) => complete(id)!)
    observers[0]!.saved!(asRecord(summary('a'), { status: status('done') }))
    observers[1]!.failed!(retry())
    observers[2]!.saved!(asRecord(summary('c'), { status: status('done') }))
    expect([...feedback.entries.keys()].sort()).toEqual(['a', 'c'])
    expect(feedback.entries.get('a')!.pending).toBe(false)
    expect(feedback.entries.get('c')!.pending).toBe(false)
    expect(failed).toHaveBeenCalledTimes(1)
  })
})

describe('clear and prune', () => {
  it('clears everything', () => {
    const { feedback, complete } = setup([summary('a'), summary('b')])
    complete('a')
    complete('b')
    feedback.clear()
    expect(feedback.entries.size).toBe(0)
    expect(feedback.done(summary('a'))).toBe(false)
  })

  it('does not resurrect a cleared row when its in-flight save succeeds', () => {
    const { feedback, complete, replace } = setup([summary('a')])
    const observer = complete('a')!
    feedback.clear()
    const calls = replace.mock.calls.length
    observer.saved!(asRecord(summary('a'), { status: status('done') }))
    expect(feedback.entries.size).toBe(0)
    expect(replace.mock.calls.length).toBe(calls)
  })

  it('does not resurrect or restore a cleared row when its in-flight save fails', () => {
    const { feedback, complete, replace, failed } = setup([summary('a')])
    const observer = complete('a')!
    feedback.clear()
    const calls = replace.mock.calls.length
    observer.failed!(retry())
    expect(feedback.entries.size).toBe(0)
    expect(replace.mock.calls.length).toBe(calls)
    expect(failed).not.toHaveBeenCalled()
  })

  it('ignores a stale save callback after the same task was retained again', () => {
    const { feedback, complete, reopen } = setup([summary('a')])
    const stale = complete('a')!
    feedback.clear()
    reopen('a')
    const fresh = complete('a')!
    stale.saved!(asRecord(summary('a'), { status: status('done') }))
    expect(feedback.entries.get('a')!.pending).toBe(true)
    fresh.saved!(asRecord(summary('a'), { status: status('done') }))
    expect(feedback.entries.get('a')!.pending).toBe(false)
  })

  it('prunes entries that are deleted or no longer accessible', () => {
    const { feedback, complete } = setup([summary('a'), summary('b'), summary('c')])
    complete('a')
    complete('b')
    complete('c')
    feedback.prune(new Set(['b', 'zzz']))
    expect([...feedback.entries.keys()]).toEqual(['b'])
  })
})

describe('moving', () => {
  it('drops the retention, suppresses completion during the drag and releases afterwards', async () => {
    const { feedback, complete, reopen } = setup([summary('a'), summary('b')])
    complete('a')
    reopen('a')
    let during: ObjectSaveObserver | undefined = {}
    const result = await feedback.moving('a', async () => {
      expect(feedback.entries.has('a')).toBe(false)
      during = complete('a')
      return 'moved'
    })
    expect(result).toBe('moved')
    expect(during).toBeUndefined()
    expect(feedback.entries.size).toBe(0)
    reopen('a')
    expect(complete('a')).toBeDefined()
  })

  it('only suppresses the moving task and releases even when the move throws', async () => {
    const { feedback, complete } = setup([summary('a'), summary('b')])
    await expect(feedback.moving('a', async () => {
      expect(complete('b')).toBeDefined()
      throw new Error('drop failed')
    })).rejects.toThrow('drop failed')
    expect(complete('a')).toBeDefined()
  })
})
