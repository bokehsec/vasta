// The agent tools' list_habits: a weekly habit reports weeks, and `weeks` adds the progress the
// app's Progress view shows (core habitReport).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinTypeId, createBuiltinTypes, DONE_VALUE, habitDoneKey, newObject, type ObjectRecord } from '@vasta/core'
import { NodeMediaStore } from '@vasta/core/media-node'
import { NodeStore } from '@vasta/core/node'
import { AccountService } from '../src/accounts.ts'
import { AgentTools } from '../src/agent.ts'
import { createApp } from '../src/app.ts'
import { CaptureService } from '../src/capture.ts'
import { ChangeFeed } from '../src/events.ts'
import { asUser } from './helpers.ts'

// Thursday 22 October 2026.
const at = '2026-10-22T12:00:00.000Z'
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('list_habits', () => {
  it('counts a weekly habit by the week and adds progress when asked', async () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) store.putType(type)
    const media = new NodeMediaStore(mkdtempSync(path.join(tmpdir(), 'vasta-habits-')))
    const feed = new ChangeFeed()
    const capture = new CaptureService({ store, media, feed, now: () => at, timeZone: 'UTC' })
    const app = createApp({ store, media, feed, capture, now: () => at })
    const user = asUser(app, store, { spaces: ['s'] })
    const agent = new AgentTools({ store, accounts: new AccountService({ store, now: () => at, capture }), feed, now: () => at, user: user.user, webUrl: 'https://vasta.test' })
    const done = (days: string[]) => Object.fromEntries(days.map((d) => [habitDoneKey(d), DONE_VALUE]))
    // Weeks of 12 and 19 October: three, then two so far (Thursday the 22nd, today not done).
    await user.request('/api/objects', json({ typeId: builtinTypeId('s', 'habit'), title: 'Gym', props: { perweek: { kind: 'number', value: 3 }, ...done(['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-20']) } } satisfies Partial<ObjectRecord>))

    const [plain] = agent.habits({ space: 's', recent: 0 }) as Record<string, unknown>[]
    expect(plain).toMatchObject({ timesPerWeek: 3, day: { scheduled: true, done: false }, stats: { streakUnit: 'week', thisWeek: '2/3', currentStreak: 1 } })
    expect(plain).not.toHaveProperty('repeatsOn')
    expect(plain).not.toHaveProperty('progress')

    const [withProgress] = agent.habits({ space: 's', recent: 0, weeks: 2 }) as { progress: unknown }[]
    expect(withProgress!.progress).toEqual({
      weeks: [{ week: '2026-10-12', done: 3, expected: 3 }, { week: '2026-10-19', done: 2, expected: 2 }],
      done: 5,
      expected: 5,
    })
  })

  it('finds a habit by name among the visible ones, not a trashed duplicate', () => {
    const store = new NodeStore(':memory:')
    store.putSpace({ id: 's', name: 'Space', sidebar: [], createdAt: at })
    for (const type of createBuiltinTypes('s', at)) store.putType(type)
    const media = new NodeMediaStore(mkdtempSync(path.join(tmpdir(), 'vasta-habits-')))
    const feed = new ChangeFeed()
    const capture = new CaptureService({ store, media, feed, now: () => at, timeZone: 'UTC' })
    const app = createApp({ store, media, feed, capture, now: () => at })
    const user = asUser(app, store, { spaces: ['s'] })
    const agent = new AgentTools({ store, accounts: new AccountService({ store, now: () => at, capture }), feed, now: () => at, user: user.user, webUrl: 'https://vasta.test' })
    const habit = store.getType(builtinTypeId('s', 'habit'))!
    store.putObject({ ...newObject(habit, { title: 'Gym' }, 'old', '2026-10-01T00:00:00.000Z'), deletedAt: '2026-10-02T00:00:00.000Z' })
    store.putObject(newObject(habit, { title: 'Gym' }, 'gym', '2026-10-03T00:00:00.000Z'))
    expect(agent.logHabit({ habit: 'gym', space: 's', done: true })).toMatchObject({ id: 'gym' })
    expect(store.getObject('old')!.props[habitDoneKey('2026-10-22')]).toBeUndefined()
  })
})
