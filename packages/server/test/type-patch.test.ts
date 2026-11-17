// Changing a type by patch: the server's PATCH route and a replica's patchType touch only the
// fields they name, so what another dialog, device or request changed in other fields is kept.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinTypeId, createBuiltinTypes, type ObjectType, type ViewDef } from '@vasta/core'
import { NodeMediaStore } from '@vasta/core/media-node'
import { NodeStore } from '@vasta/core/node'
import { createApp } from '../src/app.ts'
import { Device, asUser, now } from './helpers.ts'

const at = '2026-11-16T12:00:00.000Z'
const json = (body: unknown, method = 'PATCH') => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const view = (id: string, name = id): ViewDef => ({ id, name, layout: 'list' })

function setup() {
  const store = new NodeStore(':memory:')
  store.putSpace({ id: 's', name: 's', sidebar: [], createdAt: at })
  for (const type of createBuiltinTypes('s', at)) store.putType(type)
  const media = new NodeMediaStore(mkdtempSync(path.join(tmpdir(), 'vasta-type-patch-')))
  const app = createApp({ store, media })
  const user = asUser(app, store, { spaces: ['s'] })
  return { store, app, user, task: builtinTypeId('s', 'task') }
}

describe('PATCH /api/types/:id', () => {
  it('changes the fields in the body and keeps the others, including views saved meanwhile', async () => {
    const { store, user, task } = setup()
    const before = store.getType(task)!
    // Someone adds a view (as TypePage does); the settings dialog, opened before, then saves its name and icon.
    await user.request(`/api/types/${task}`, json({ views: [...before.views, view('mine', 'Mine')] }))
    const saved = (await (await user.request(`/api/types/${task}`, json({ name: 'Chores', pluralName: 'Chores', description: 'Things to do' }))).json()) as ObjectType
    expect(saved).toMatchObject({ name: 'Chores', description: 'Things to do', system: 'task' })
    expect(saved.views.map((v) => v.id)).toEqual([...before.views.map((v) => v.id), 'mine'])
    expect(store.getType(task)!.views.map((v) => v.id)).toContain('mine')
    expect(store.getType(task)!.properties).toEqual(before.properties)
  })

  it('normalizes Rules while independent view and custom-setting saves keep each other', async () => {
    const { store, user, task } = setup()
    const before = store.getType(task)!
    const quickActions = { nextStepField: 'next-step' }
    const results = await Promise.all([
      user.request(`/api/types/${task}`, json({ rules: { cover: true, tags: false, unknown: true } })),
      user.request(`/api/types/${task}`, json({ views: [...before.views, view('new')] })),
      user.request(`/api/types/${task}`, json({ quickActions, review: { every: 12 }, subtasks: { parentField: 'parent' } })),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(store.getType(task)).toMatchObject({ rules: { cover: true }, quickActions, review: { every: 12 }, subtasks: { parentField: 'parent' } })
    expect(store.getType(task)!.rules).toEqual({ cover: true })
    expect(store.getType(task)!.views.map((v) => v.id)).toContain('new')
    const put = await user.request(`/api/types/${task}`, json({ ...store.getType(task), rules: { tags: true, cover: 'yes' } }, 'PUT'))
    expect(put.status).toBe(200)
    expect(store.getType(task)!.rules).toEqual({ tags: true })
    await user.request(`/api/types/${task}`, json({ rules: { cover: false } }))
    expect(store.getType(task)!.rules).toBeUndefined()
    expect(store.getType(task)!.quickActions).toEqual(quickActions)
  })

  it('takes an optional field away with null, and refuses fields that are not the type\'s own to change', async () => {
    const { store, user, task } = setup()
    await user.request(`/api/types/${task}`, json({ openIn: 'pane' }))
    expect(store.getType(task)!.openIn).toBe('pane')
    await user.request(`/api/types/${task}`, json({ openIn: null }))
    expect(store.getType(task)!.openIn).toBeUndefined()
    for (const body of [{ system: 'page' }, { id: 'other' }, { spaceId: 'x' }, { deletedAt: at }, { name: null }, { name: '  ' }]) {
      const response = await user.request(`/api/types/${task}`, json(body))
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    expect((await user.request('/api/types/missing', json({ name: 'x' }))).status).toBe(404)
    expect((await user.request(`/api/types/${task}`, json([]))).status).toBe(400)
    expect(store.getType(task)).toMatchObject({ system: 'task', spaceId: 's', name: 'Task' })
  })
})

describe('patchType on a replica', () => {
  it('pushes only the patched fields: two devices changing different fields of a type both keep their change', async () => {
    const { store, user, task } = setup()
    const phone = new Device('phone', user.request)
    const laptop = new Device('laptop', user.request)
    await phone.sync.sync()
    await laptop.sync.sync()
    const views = [...phone.store.getType(task)!.views, view('mine', 'Mine')]

    // Offline, the phone adds a view and the laptop renames the type from a dialog opened before.
    phone.online = false
    laptop.online = false
    phone.store.patchType(task, { views }, now())
    laptop.store.patchType(task, { name: 'Chores', pluralName: 'Chores', rules: { tags: true }, review: { every: 14 } }, now())
    phone.online = true
    laptop.online = true
    await phone.sync.sync()
    await laptop.sync.sync()
    await phone.sync.sync()

    for (const type of [store.getType(task)!, phone.store.getType(task)!, laptop.store.getType(task)!]) {
      expect(type.name).toBe('Chores')
      expect(type.rules).toEqual({ tags: true })
      expect(type.review).toEqual({ every: 14 })
      expect(type.views.map((v) => v.id)).toContain('mine')
    }
  })

  it('refuses a patch the type cannot take, and a type that is not there', async () => {
    const { user, task } = setup()
    const device = new Device('phone', user.request)
    await device.sync.sync()
    expect(() => device.store.patchType(task, { system: 'page' } as never, now())).toThrow('cannot be changed')
    expect(() => device.store.patchType(task, { name: ' ' }, now())).toThrow('needs a name')
    expect(() => device.store.patchType('missing', { name: 'x' }, now())).toThrow('not found')
    expect(device.store.getType(task)!.name).toBe('Task')
    expect(device.store.outboxSize()).toBe(0)
  })
})
