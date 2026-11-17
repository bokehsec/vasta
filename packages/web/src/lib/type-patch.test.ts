import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectType, TypePatch } from '@vasta/core'

const { state, patchTypeCall, typeCall } = vi.hoisted(() => {
  const state = { types: [] as ObjectType[], unsaved: new Map<string, ObjectType>() }
  return {
    state,
    patchTypeCall: vi.fn<(id: string, patch: TypePatch) => Promise<ObjectType>>(),
    typeCall: vi.fn<(id: string) => Promise<ObjectType>>(),
  }
})
vi.mock('./api.ts', () => ({ api: { patchType: patchTypeCall, type: typeCall } }))
vi.mock('./state.ts', () => ({
  get typesById() { return { value: new Map(state.types.map((t) => [t.id, t])) } },
  unsavedTypes: state.unsaved,
  replaceType: (type: ObjectType) => {
    const unsaved = state.unsaved.get(type.id)
    if (unsaved && unsaved !== type) return
    state.types = [type]
  },
}))
import { patchType, patchViews } from './type-patch.ts'

const at = '2026-11-16T12:00:00.000Z'
const view = (id: string) => ({ id, name: id, layout: 'list' as const })
const base = (): ObjectType => ({ id: 't', spaceId: 's', name: 'Task', pluralName: 'Tasks', properties: [], views: [view('a')], createdAt: at, updatedAt: at })

/** The server: applies a patch to what it has, as the PATCH route does. */
let stored: ObjectType
beforeEach(() => {
  vi.clearAllMocks()
  state.unsaved.clear()
  stored = base()
  state.types = [base()]
  patchTypeCall.mockImplementation(async (_id, patch) => {
    stored = { ...stored, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null)) } as ObjectType
    for (const [field, value] of Object.entries(patch)) if (value === null) delete (stored as unknown as Record<string, unknown>)[field]
    return stored
  })
  typeCall.mockImplementation(async () => stored)
})

describe('patchType', () => {
  it('shows the change at once and sends only the fields it names', async () => {
    const saved = patchType('t', { name: 'Chores' })
    expect(state.types[0]!.name).toBe('Chores')
    expect(state.unsaved.has('t')).toBe(true)
    await saved
    expect(patchTypeCall).toHaveBeenCalledWith('t', { name: 'Chores' })
    expect(state.unsaved.has('t')).toBe(false)
    expect(state.types[0]!.views).toHaveLength(1)
  })

  it('puts changes made before the send in one request, a later one for a field winning', async () => {
    const first = patchType('t', { name: 'One', description: 'x' })
    const second = patchType('t', { name: 'Two' })
    await Promise.all([first, second])
    expect(patchTypeCall).toHaveBeenCalledTimes(1)
    expect(patchTypeCall).toHaveBeenCalledWith('t', { name: 'Two', description: 'x' })
  })

  it('takes an optional field away with null', async () => {
    stored.openIn = 'pane'
    state.types = [{ ...stored }]
    await patchType('t', { openIn: undefined })
    expect(patchTypeCall).toHaveBeenCalledWith('t', { openIn: null })
    expect(state.types[0]!.openIn).toBeUndefined()
  })

  it('sends one request at a time and keeps the local copy until the last one answers', async () => {
    let finish!: (type: ObjectType) => void
    patchTypeCall.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = patchType('t', { name: 'One' })
    await vi.waitFor(() => expect(patchTypeCall).toHaveBeenCalledTimes(1))
    const second = patchType('t', { description: 'Later' })
    expect(patchTypeCall).toHaveBeenCalledTimes(1)
    stored = { ...stored, name: 'One' }
    finish(stored)
    await first
    // The first answer does not know the second change: it must not replace the type.
    expect(state.types[0]).toMatchObject({ name: 'One', description: 'Later' })
    await second
    expect(patchTypeCall).toHaveBeenLastCalledWith('t', { description: 'Later' })
    expect(state.types[0]).toMatchObject({ name: 'One', description: 'Later' })
  })

  it('does not overwrite what the type was given meanwhile elsewhere: a duplicate view made inside the debounce survives a settings save', async () => {
    // A view setting edited (debounced), then a view duplicated before it was sent, then the settings dialog saves its fields.
    const type = () => state.types[0]!
    const edit = patchViews(type(), (views) => { views[0]!.sort = [{ field: 'title', direction: 'asc' }] }, { delay: 50 })
    const duplicate = patchViews(type(), (views) => views.push({ ...view('a'), id: 'b', name: 'a copy', sort: [{ field: 'title', direction: 'asc' }] }))
    const settings = patchType('t', { name: 'Chores' })
    await Promise.all([edit, duplicate, settings])
    expect(stored.views.map((v) => v.id)).toEqual(['a', 'b'])
    expect(stored.name).toBe('Chores')
    for (const [, patch] of patchTypeCall.mock.calls) expect(Object.keys(patch).every((field) => ['views', 'name'].includes(field))).toBe(true)
  })

  it('queues Rules, a view edit and custom settings without reverting a concurrent answer', async () => {
    let finish!: (type: ObjectType) => void
    patchTypeCall.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const rules = patchType('t', { rules: { tags: true } })
    await vi.waitFor(() => expect(patchTypeCall).toHaveBeenCalledTimes(1))
    const views = patchViews(state.types[0]!, (list) => list.push(view('b')))
    const custom = patchType('t', { quickActions: { nextStepField: 'next' }, review: { every: 14 } })
    stored = { ...stored, rules: { tags: true } }
    finish(stored)
    await Promise.all([rules, views, custom])
    expect(state.types[0]).toMatchObject({ rules: { tags: true }, quickActions: { nextStepField: 'next' }, review: { every: 14 } })
    expect(state.types[0]!.views.map((v) => v.id)).toEqual(['a', 'b'])
    expect(patchTypeCall).toHaveBeenCalledTimes(2)
    expect(patchTypeCall.mock.calls[1]![1]).not.toHaveProperty('rules')
  })

  it('puts the stored copy back and rejects every caller when the save fails', async () => {
    patchTypeCall.mockRejectedValueOnce(new Error('network'))
    const first = patchType('t', { name: 'One' })
    const second = patchType('t', { description: 'Two' })
    const failures = Promise.allSettled([first, second])
    const results = await failures
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(state.unsaved.has('t')).toBe(false)
    expect(state.types[0]!.name).toBe('Task')
    // The next change still goes out.
    await patchType('t', { name: 'Three' })
    expect(stored.name).toBe('Three')
  })

  it('refuses a patch that would take away a field the type needs', async () => {
    await expect(patchType('t', { name: undefined })).rejects.toThrow('needs its name')
    expect(patchTypeCall).not.toHaveBeenCalled()
  })
})
