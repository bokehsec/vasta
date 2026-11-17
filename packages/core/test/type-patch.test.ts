import { describe, expect, it } from 'vitest'
import { createBuiltinTypes } from '../src/builtin-types.ts'
import type { ObjectType } from '../src/model.ts'
import { isPushable } from '../src/sync.ts'
import { NodeStore } from '../src/store-node.ts'
import { TYPE_PATCH_FIELDS, applyTypePatch } from '../src/type-patch.ts'

const AT = '2026-11-16T12:00:00.000Z'
const LATER = '2026-11-16T13:00:00.000Z'
const task = createBuiltinTypes('s', AT).find((t) => t.system === 'task')!
const view = (id: string) => ({ id, name: id, layout: 'list' as const })

describe('applyTypePatch', () => {
  it('sets the fields it names and leaves the rest', () => {
    const next = applyTypePatch(task, { name: 'Chores', views: [view('a')] }, LATER)
    expect(next).toMatchObject({ name: 'Chores', views: [view('a')], pluralName: task.pluralName, updatedAt: LATER })
    expect(next.properties).toBe(task.properties)
    expect(task.name).toBe('Task')
  })

  it('takes an optional field away with null, but not one the type needs', () => {
    const withIcon: ObjectType = { ...task, openIn: 'pane', description: 'x' }
    const next = applyTypePatch(withIcon, { openIn: null, description: null }, LATER)
    expect('openIn' in next || 'description' in next).toBe(false)
    expect(() => applyTypePatch(task, { name: null }, LATER)).toThrow('needs its name')
    expect(() => applyTypePatch(task, { views: null }, LATER)).toThrow('needs its views')
  })

  it('refuses a field that is not the type\'s own to change (its id, space, built-in key, trash state)', () => {
    for (const field of ['id', 'spaceId', 'system', 'createdAt', 'deletedAt']) {
      expect(() => applyTypePatch(task, { [field]: 'x' } as never, LATER)).toThrow('cannot be changed')
    }
    expect(TYPE_PATCH_FIELDS).toContain('views')
    expect(TYPE_PATCH_FIELDS).not.toContain('deletedAt')
  })
})

describe('the server store\'s putType', () => {
  it('round-trips the combined fork and upstream settings and keeps agent settings owner-controlled', () => {
    const store = new NodeStore(':memory:')
    const space = { id: 's', name: 's', sidebar: [], createdAt: AT, opensOn: { kind: 'today' as const }, agents: { instructions: 'Read context first', readOnly: true } }
    store.putSpace(space)
    const combined: ObjectType = { ...task, rules: { tags: true }, quickActions: { nextStepField: 'next' }, review: { every: 12 }, subtasks: { parentField: 'parent' }, habits: { place: 'above', chart: 'calendar', weeks: 4 } }
    store.putType(combined)
    expect(store.getSpace('s')).toEqual(space)
    expect(store.getType(task.id)).toEqual(combined)
    store.putType(applyTypePatch(store.getType(task.id)!, { name: 'Chores' }, LATER))
    expect(store.getType(task.id)).toEqual({ ...combined, name: 'Chores', updatedAt: LATER })
    expect(isPushable('spaces', 'agents')).toBe(false)
    expect(isPushable('spaces', 'opensOn')).toBe(true)
    expect(isPushable('types', 'rules')).toBe(true)
  })

  it('keeps a column this build does not name (a later build\'s) instead of blanking it', () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 's', sidebar: [], createdAt: AT })
    store.putType(task)
    store.db.exec('ALTER TABLE types ADD COLUMN future TEXT')
    store.db.prepare('UPDATE types SET future = ? WHERE id = ?').run('{"keep":true}', task.id)
    store.putType({ ...task, name: 'Renamed', updatedAt: LATER })
    const row = store.db.prepare('SELECT name, future FROM types WHERE id = ?').get(task.id) as { name: string; future: string }
    expect(row).toEqual({ name: 'Renamed', future: '{"keep":true}' })
  })
})
