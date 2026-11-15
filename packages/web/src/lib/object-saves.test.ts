import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObjectRecord } from '@vasta/core'
import { observeObjectSave, onObjectSave } from './object-saves.ts'

const record = (title: string) => ({ id: 'a', title, props: {} }) as unknown as ObjectRecord

describe('object saves', () => {
  const unsubscribes: Array<() => unknown> = []
  const subscribe = (listener: Parameters<typeof onObjectSave>[0]) => {
    const off = onObjectSave(listener)
    unsubscribes.push(off)
    return off
  }
  afterEach(() => {
    for (const off of unsubscribes.splice(0)) off()
  })

  it('passes the object and base to listeners before saving and returns the saved record', async () => {
    const listener = vi.fn(() => undefined)
    subscribe(listener)
    const object = record('draft')
    const base = record('base')
    const saved = record('saved')
    const save = vi.fn(async () => {
      expect(listener).toHaveBeenCalledWith(object, base)
      return saved
    })
    await expect(observeObjectSave(object, base, save)).resolves.toBe(saved)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('tells every observer the saved record on success and never calls failed', async () => {
    const first = { saved: vi.fn(), failed: vi.fn() }
    const second = { saved: vi.fn(), failed: vi.fn() }
    subscribe(() => first)
    subscribe(() => undefined)
    subscribe(() => second)
    const saved = record('saved')
    await observeObjectSave(record('draft'), undefined, async () => saved)
    expect(first.saved).toHaveBeenCalledWith(saved)
    expect(second.saved).toHaveBeenCalledWith(saved)
    expect(first.failed).not.toHaveBeenCalled()
    expect(second.failed).not.toHaveBeenCalled()
  })

  it('rethrows the error and gives every observer a retry that saves again', async () => {
    const observer = { saved: vi.fn(), failed: vi.fn() }
    subscribe(() => observer)
    const failure = new Error('offline')
    const saved = record('saved')
    const save = vi.fn<() => Promise<ObjectRecord>>().mockRejectedValueOnce(failure).mockResolvedValueOnce(saved)
    await expect(observeObjectSave(record('draft'), undefined, save)).rejects.toBe(failure)
    expect(observer.saved).not.toHaveBeenCalled()
    expect(observer.failed).toHaveBeenCalledTimes(1)
    const retry = observer.failed.mock.calls[0]![0] as () => Promise<ObjectRecord>
    expect(save).toHaveBeenCalledTimes(1)
    await expect(retry()).resolves.toBe(saved)
    expect(save).toHaveBeenCalledTimes(2)
    expect(observer.saved).toHaveBeenCalledWith(saved)
  })

  it('tolerates observers with no callbacks', async () => {
    subscribe(() => ({}))
    await expect(observeObjectSave(record('x'), undefined, async () => record('y'))).resolves.toMatchObject({ title: 'y' })
    await expect(observeObjectSave(record('x'), undefined, async () => { throw new Error('no') })).rejects.toThrow('no')
  })

  it('stops calling a listener once it unsubscribes', async () => {
    const listener = vi.fn(() => undefined)
    const off = subscribe(listener)
    expect(off()).toBe(true)
    await observeObjectSave(record('x'), undefined, async () => record('y'))
    expect(listener).not.toHaveBeenCalled()
    expect(off()).toBe(false)
  })

  it('saves with no listeners', async () => {
    const saved = record('saved')
    await expect(observeObjectSave(record('x'), undefined, async () => saved)).resolves.toBe(saved)
  })
})
