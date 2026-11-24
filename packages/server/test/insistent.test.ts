import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinTypeId, createBuiltinTypes, habitDoneKey, habitSparkyKey, habitPauseKey, habitValue, isHabitDone, newObject, DONE_VALUE } from '@vasta/core'
import { NodeMediaStore } from '@vasta/core/media-node'
import { NodeStore } from '@vasta/core/node'
import { AccountService } from '../src/accounts.ts'
import { CaptureService } from '../src/capture.ts'
import { ChangeFeed, DesktopListeners, type DesktopNotification, type DesktopTakeover } from '../src/events.ts'
import { normalizeText, textMatch } from '@vasta/core'
import type { LadderStep } from '../src/insistent.ts'
import { ReminderService, type TelegramExtra } from '../src/reminders.ts'

const AT = '2026-10-20T09:00:00.000Z'
/** A wall time in São Paulo (UTC-3), as an instant. */
const local = (iso: string) => Date.parse(`${iso}-03:00`)

function setup() {
  let now = local('2026-10-20T07:00:00')
  const store = new NodeStore(':memory:')
  store.putSpace({ id: 's', name: 'Notes', sidebar: [], createdAt: AT })
  for (const type of createBuiltinTypes('s', AT)) store.putType(type)
  store.putUser({ id: 'u', username: 'arie', name: 'Arie', timeZone: 'America/Sao_Paulo', createdAt: AT }, 'x')
  store.putMember({ spaceId: 's', userId: 'u', role: 'owner', createdAt: AT })
  const media = new NodeMediaStore(mkdtempSync(path.join(tmpdir(), 'vasta-insistent-')))
  const capture = new CaptureService({ store, media, feed: new ChangeFeed(), timeZone: 'UTC' })
  const accounts = new AccountService({ store, capture })
  const habitType = store.getType(builtinTypeId('s', 'habit'))!
  const tagType = store.getType(builtinTypeId('s', 'tag'))!
  const page = store.getType(builtinTypeId('s', 'page'))!
  const task = store.getType(builtinTypeId('s', 'task'))!
  store.putObject(newObject(habitType, { title: 'Escolher quem eu sou', props: { remind: { kind: 'text', value: '9:00' } } }, 'ritual', AT))
  store.putObject(newObject(tagType, { title: 'Afirmação' }, 'affirmation', AT))
  store.putObject(newObject(tagType, { title: 'Corpo', parentId: 'affirmation' }, 'body-tag', AT))
  store.putObject({ ...newObject(page, { title: 'Você é o amor da sua vida.' }, 'p1', AT), tagIds: ['affirmation'] })
  store.putObject({ ...newObject(page, { title: 'Você não deve beleza a ninguém.' }, 'p2', AT), tagIds: ['body-tag'] })
  store.putObject({ ...newObject(page, { title: 'Use o que quiser. Faça o que quiser.' }, 'p3', AT), tagIds: ['affirmation'] })
  store.putObject({ ...newObject(page, { title: 'Untagged' }, 'p4', AT) })
  store.putObject(newObject(task, { title: 'Pay rent', props: { status: { kind: 'select', value: ['todo'] }, due: { kind: 'date', value: { start: '2026-10-20T14:00:00.000Z', resolution: 'time' } } } }, 'rent', AT))

  const ntfy: Record<string, any>[] = []
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    ntfy.push(JSON.parse(String(init?.body)))
    return new Response('{}')
  }) as typeof fetch
  const telegram: { chat: number; text: string; extra?: TelegramExtra }[] = []
  const settled: string[] = []
  const desktop = new DesktopListeners()
  const reminders = new ReminderService({
    store,
    accounts,
    desktop,
    webUrl: 'https://notes.example',
    fetch: fakeFetch,
    now: () => now,
    telegram: async (chat, text, extra) => (telegram.push({ chat, text, ...(extra ? { extra } : {}) }), 100 + telegram.length),
    telegramDone: async (_chat, message, note) => void settled.push(`${message}:${note}`),
  })
  reminders.save('u', { ntfy: { topic: 'arie' }, telegram: true, habits: true, eventsBefore: null })
  store.putUser({ ...store.getUser('u')!, telegramUserId: 42 })
  const user = store.getUser('u')!
  // Ticks every 30 s from the last time to `to`, as the service does.
  const runTo = async (iso: string, step = 30_000) => {
    const to = local(iso)
    let last = now
    while (last < to) {
      const next = Math.min(last + step, to)
      now = next
      await reminders.tick(next)
      last = next
    }
  }
  return { store, reminders, insistent: reminders.insistent, ntfy, telegram, settled, desktop, user, runTo, setNow: (iso: string) => (now = local(iso)), get now() { return now } }
}

const STEPS: LadderStep[] = [
  { after: 0, channels: ['ntfy'] },
  { after: 15, channels: ['ntfy'], urgent: true },
  { after: 30, channels: ['ntfy', 'telegram'], urgent: true },
  { after: 45, channels: ['takeover'], urgent: true },
]

describe('insistent reminders', () => {
  it('repeats until answered, climbs its ladder, and is answered by doing the habit', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { objectId: 'ritual', steps: STEPS, repeat: 10 })
    expect(rule).toMatchObject({ when: { kind: 'object' }, ack: 'done', content: { kind: 'target' } })

    await t.runTo('2026-10-20T08:59:00')
    expect(t.ntfy).toEqual([])
    await t.runTo('2026-10-20T09:00:30')
    expect(t.ntfy).toHaveLength(1)
    expect(t.ntfy[0]).toMatchObject({ topic: 'arie', title: 'Escolher quem eu sou', priority: 4, click: expect.stringMatching(/^https:\/\/notes\.example\/remind\//) })
    expect(t.ntfy[0]!.actions.map((a: { label: string; action: string }) => [a.action, a.label])).toEqual([
      ['http', 'Done ✓'],
      ['http', 'Snooze 15 min'],
      ['view', 'Not today'],
    ])
    // The plain habit reminder at 9:00 is not sent as well.
    expect(t.ntfy.filter((p) => p.message?.startsWith('Not done yet'))).toEqual([])

    // Every 10 minutes, and urgent from the step at 15.
    await t.runTo('2026-10-20T09:16:00')
    expect(t.ntfy.map((p) => p.priority)).toEqual([4, 4, 5])
    await t.runTo('2026-10-20T09:31:00')
    expect(t.telegram).toHaveLength(1)
    expect(t.telegram[0]!.extra!.buttons!.flat().map((b) => b.text)).toEqual(['Done ✓', 'Snooze 15 min', 'Not today'])

    // Done from the ntfy button (a signed link): the habit is done for the day, and nothing more comes.
    const done = t.ntfy[0]!.actions[0].url as string
    const [, id, answer] = /remind\/([\w-]+)\/(\w+)\?s=/.exec(done)!
    const signature = new URL(done).searchParams.get('s')!
    await expect(t.insistent.signed(id!, answer!, 'forged')).rejects.toThrow('not valid')
    await expect(t.insistent.signed(id!, 'snooze', signature)).rejects.toThrow('not valid')
    expect((await t.insistent.signed(id!, answer!, signature)).outcome).toBe('done')
    expect(isHabitDone(t.store.getObject('ritual')!, '2026-10-20')).toBe(true)
    expect(t.settled).toEqual(['101:✓ Done'])
    const sent = t.ntfy.length
    await t.runTo('2026-10-20T10:30:00')
    expect(t.ntfy).toHaveLength(sent)
    expect(t.insistent.stats(t.user, rule.id)).toMatchObject({ total: 1, done: 1, answered: 1, medianMinutes: 31, escalated: 1 })
  })

  it('snoozing waits, does not climb by itself, and climbs a step every few snoozes', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { objectId: 'ritual', steps: STEPS, repeat: 5, snooze: 15, climbAfter: 2 })
    await t.runTo('2026-10-20T09:00:30')
    const [nag] = t.insistent.openNags('u')
    await t.insistent.answer(t.user, nag!.id, { answer: 'snooze' })
    await t.runTo('2026-10-20T09:15:00')
    expect(t.ntfy).toHaveLength(1)
    // Back after the snooze, still on the first step (the ladder's clock left the snooze out).
    await t.runTo('2026-10-20T09:15:40')
    expect(t.ntfy.map((p) => p.priority)).toEqual([4, 4])
    // The second snooze climbs a step: urgent from now on.
    await t.insistent.answer(t.user, nag!.id, { answer: 'snooze' })
    await t.runTo('2026-10-20T09:31:00')
    expect(t.ntfy.map((p) => p.priority)).toEqual([4, 4, 5])
    expect(t.insistent.nag(nag!.id)).toMatchObject({ snoozes: 2, bump: 1 })
  })

  it('"Not today" needs a reason, which the stats keep; a day not answered is ignored', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { objectId: 'ritual', steps: STEPS, repeat: 30 })
    await t.runTo('2026-10-20T09:00:30')
    const [nag] = t.insistent.openNags('u')
    await expect(t.insistent.answer(t.user, nag!.id, { answer: 'skip' })).rejects.toThrow('why')
    await expect(t.insistent.answer(t.user, nag!.id, { answer: 'ok' })).rejects.toThrow('doing it')
    await t.insistent.answer(t.user, nag!.id, { answer: 'skip', reason: '  sick,   staying in bed ' })
    // The next day it is not answered at all.
    // Long stretches in 5-minute looks: the service handles any window.
    await t.runTo('2026-10-21T09:00:30', 300_000)
    await t.runTo('2026-10-22T00:00:30', 300_000)
    const stats = t.insistent.stats(t.user, rule.id)
    expect(stats).toMatchObject({ total: 2, skipped: 1, ignored: 1, answered: 0, reasons: [{ day: '2026-10-20', reason: 'sick, staying in bed' }] })
    expect(stats.days.slice(-3).map((d) => d.outcome)).toEqual(['skipped', 'ignored', null])
  })

  it('closes as done when the habit is done elsewhere, and does not start on a day it is done', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { objectId: 'ritual', steps: STEPS, repeat: 10 })
    await t.runTo('2026-10-20T09:00:30')
    const habit = t.store.getObject('ritual')!
    t.store.putObject({ ...habit, props: { ...habit.props, [habitDoneKey('2026-10-20')]: DONE_VALUE } })
    await t.runTo('2026-10-20T09:01:00')
    expect(t.insistent.openNags('u')).toEqual([])
    const again = t.store.getObject('ritual')!
    t.store.putObject({ ...again, props: { ...again.props, [habitDoneKey('2026-10-21')]: DONE_VALUE } })
    const before = t.ntfy.length
    await t.runTo('2026-10-21T09:30:00', 300_000)
    expect(t.ntfy).toHaveLength(before)
  })

  it('shows random affirmations and is answered by saying them, which marks the habit done', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { objectId: 'ritual', content: { kind: 'tag', tagId: 'affirmation', count: 2 }, ack: 'say', steps: [{ after: 0, channels: ['ntfy', 'telegram'] }], repeat: 15 })
    await t.runTo('2026-10-20T09:00:30')
    const [nag] = t.insistent.openNags('u')
    // Sub-tags count; the untagged page and the tags themselves do not.
    expect(nag!.contentIds).toHaveLength(2)
    expect(nag!.contentIds.every((id) => ['p1', 'p2', 'p3'].includes(id))).toBe(true)
    const view = t.insistent.view(t.user, nag!.id)
    expect(view.expected).toHaveLength(2)
    expect(t.ntfy[0]!.message).toContain(`• ${view.expected[0]}`)
    expect(t.ntfy[0]!.actions[0]).toMatchObject({ action: 'view', label: 'Say it' })
    expect(t.telegram[0]!.text).toContain('Reply to this message with the text')

    await expect(t.insistent.answer(t.user, nag!.id, { answer: 'said', texts: ['something else', 'entirely'] })).rejects.toThrow('phrase 1')
    // Heard loosely: no accents, a word wrong, no punctuation.
    const heard = view.expected.map((text) => normalizeText(text).replace('voce', 'você').replace(/a$/, 'x'))
    expect((await t.insistent.answer(t.user, nag!.id, { answer: 'said', texts: heard })).outcome).toBe('said')
    expect(isHabitDone(t.store.getObject('ritual')!, '2026-10-20')).toBe(true)

    // The next day picks others when it can.
    const habit = t.store.getObject('ritual')!
    t.store.putObject({ ...habit, props: { ...habit.props } })
    await t.runTo('2026-10-21T09:00:30', 300_000)
    const [next] = t.insistent.openNags('u')
    expect(next!.contentIds).not.toEqual(nag!.contentIds)
    expect(t.insistent.stats(t.user, rule.id)).toMatchObject({ said: 1, answered: 1 })
  })

  it('takes a reply in Telegram as the typed text, and a button press', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { title: 'Affirmation', content: { kind: 'tag', tagId: 'affirmation', count: 1 }, when: { kind: 'daily', at: '08:00' }, ack: 'type', steps: [{ after: 0, channels: ['telegram'] }], repeat: 20 })
    await t.runTo('2026-10-20T08:00:30')
    const [nag] = t.insistent.openNags('u')
    const text = t.insistent.view(t.user, nag!.id).expected[0]!
    expect(await t.insistent.telegramReply(t.user, 999, text)).toBeUndefined()
    expect(await t.insistent.telegramReply(t.user, 101, 'nope')).toMatch(/Not quite/)
    expect(await t.insistent.telegramReply(t.user, 101, text.toUpperCase())).toBe('Done ✓')
    expect(t.insistent.nag(nag!.id)).toMatchObject({ outcome: 'typed' })

    t.insistent.create(t.user, { objectId: 'rent', when: { kind: 'object', before: 30 }, steps: [{ after: 0, channels: ['telegram'] }], repeat: null })
    await t.runTo('2026-10-20T10:30:30')
    const [rent] = t.insistent.openNags('u')
    expect(rent).toBeDefined()
    expect(await t.insistent.callback(t.user, `nag:${rent!.id}:skip`)).toEqual({ text: '', askWhy: rent!.id })
    t.insistent.askedWhy(rent!.id, 555, 42)
    expect(await t.insistent.telegramReply(t.user, 555, 'paid it yesterday')).toBe('Skipped for today. Noted why.')
    expect(t.insistent.nag(rent!.id)).toMatchObject({ outcome: 'skipped', reason: 'paid it yesterday' })
  })

  it('marks a task done, and waits out quiet hours', async () => {
    const t = setup()
    t.reminders.save('u', { quiet: { from: '22:00', to: '07:30' } })
    t.setNow('2026-10-20T06:00:00')
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { title: 'Water', content: { kind: 'tasks' }, when: { kind: 'daily', at: '07:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: 10 })
    expect(rule.ack).toBe('ok')
    await t.runTo('2026-10-20T07:29:00')
    expect(t.ntfy).toEqual([])
    await t.runTo('2026-10-20T07:30:30')
    expect(t.ntfy).toHaveLength(1)
    expect(t.ntfy[0]!.message).toContain('• Pay rent')

    const task = t.insistent.create(t.user, { objectId: 'rent', when: { kind: 'object', before: 0 } })
    expect(task.ack).toBe('done')
    await t.runTo('2026-10-20T11:00:30')
    const nag = t.insistent.openNags('u').find((n) => n.ruleId === task.id)!
    await t.insistent.answer(t.user, nag.id, { answer: 'done' })
    expect(t.store.getObject('rent')!.props.status).toEqual({ kind: 'select', value: ['done'] })
  })

  it('starts when the user is first at the computer after an hour, or at the latest time anyway', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { title: 'Stretch', content: { kind: 'tasks' }, when: { kind: 'wake', after: '08:00', latest: '11:00', days: [1, 2, 3, 4, 5] }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    // At the computer before 8: nothing.
    t.reminders.save('u', { habits: false })
    t.setNow('2026-10-20T07:50:00')
    await t.insistent.presence(t.user)
    expect(t.ntfy).toEqual([])
    // Back after 8: it starts then.
    t.setNow('2026-10-20T08:40:00')
    await t.insistent.presence(t.user)
    expect(t.ntfy).toHaveLength(1)
    await t.insistent.presence(t.user)
    expect(t.ntfy).toHaveLength(1)
    // Wednesday, never at the computer: at 11:00 anyway.
    t.setNow('2026-10-21T07:00:00')
    await t.reminders.tick(t.now)
    await t.runTo('2026-10-21T11:00:30')
    expect(t.ntfy).toHaveLength(2)
    expect(t.insistent.stats(t.user, rule.id).total).toBe(2)
  })

  it('takes the screen in desktop apps that can, a notification in older ones, and closes it when answered anywhere', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    const takeovers: DesktopTakeover[] = []
    const dismissed: string[] = []
    const old: DesktopNotification[] = []
    t.desktop.listen('u', () => {}, { takeover: (x) => takeovers.push(x), dismiss: (id) => dismissed.push(id) })
    t.desktop.listen('u', (n) => old.push(n))
    expect(t.reminders.view('u')).toMatchObject({ desktopApps: 2, takeoverApps: 1 })
    t.insistent.create(t.user, { objectId: 'ritual', steps: [{ after: 0, channels: ['takeover'], urgent: true }], escapeAfter: 8 })
    await t.runTo('2026-10-20T09:00:30')
    expect(takeovers).toEqual([{ id: expect.any(String), title: 'Escolher quem eu sou', message: expect.any(String), path: `remind/${takeovers[0]!.id}?takeover=1`, escapeAfter: 8 }])
    expect(old.map((n) => n.title)).toEqual(['Escolher quem eu sou'])
    await t.insistent.answer(t.user, takeovers[0]!.id, { answer: 'escape' })
    expect(dismissed).toEqual([takeovers[0]!.id])
    expect(t.insistent.nag(takeovers[0]!.id)).toMatchObject({ outcome: 'escaped', tookOver: true })
  })

  it('reviews current and recurring tasks, using plan time before a custom deadline field', async () => {
    const t = setup()
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    // Declaration order must not choose the deadline over the work plan.
    const custom = { ...type, properties: type.properties.map((p) => p.id === 'due' ? { ...p, id: 'finish-by' } : p) }
    t.store.putType(custom)
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { status: rent.props.status!,
      'finish-by': { kind: 'date', value: { start: '2026-10-20T18:00:00.000Z', resolution: 'time', rrule: 'FREQ=DAILY' } },
      dodate: { kind: 'date', value: { start: '2026-10-20T12:00:00.000Z', resolution: 'time' } },
    } })
    await t.reminders.tick(t.now)
    const rule = t.insistent.create(t.user, { objectId: 'rent', steps: [{ after: 0, channels: ['ntfy'] }] })
    await t.runTo('2026-10-20T09:00:30')
    const [nag] = t.insistent.openNags('u')
    expect(nag?.ruleId).toBe(rule.id)
    expect(nag?.occurrence).toContain(':dodate:')
    expect(t.insistent.tasks(t.user, 's')).toEqual([{ id: 'rent', title: 'Pay rent', due: '2026-10-20T18:00:00.000Z' }])
    await t.insistent.answer(t.user, nag!.id, { answer: 'done' })
    expect(t.store.getObject('rent')!.props).toMatchObject({ status: { value: ['todo'] }, reviewed: { value: { start: '2026-10-20T00:00:00.000Z' } }, 'finish-by': { value: { start: '2026-10-21T18:00:00.000Z' } } })
    expect(t.store.getObject('rent')!.props.dodate).toBeUndefined()
    // Nonrecurring completion uses the same review date.
    const plain = t.store.putObject(newObject(custom, { title: 'Plain', props: { status: { kind: 'select', value: ['todo'] } } }, 'plain', AT))
    const other = t.insistent.create(t.user, { objectId: plain.id, when: { kind: 'daily', at: '10:00' } })
    const started = await t.insistent.startNow(t.user, other.id)
    await t.insistent.answer(t.user, started.id, { answer: 'done' })
    expect(t.store.getObject('plain')!.props).toMatchObject({ status: { value: ['done'] }, reviewed: { value: { start: '2026-10-20T00:00:00.000Z' } } })
  })

  it('closes a recurring reminder when its custom deadline advances elsewhere', async () => {
    const t = setup()
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    t.store.putType({ ...type, properties: type.properties.map((p) => p.id === 'due' ? { ...p, id: 'finish' } : p) })
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { status: rent.props.status!, finish: { kind: 'date', value: { start: '2026-10-20T14:00:00.000Z', resolution: 'time', rrule: 'FREQ=DAILY' } } } })
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { objectId: 'rent', steps: [{ after: 0, channels: ['ntfy'] }] })
    await t.runTo('2026-10-20T11:00:30')
    const [nag] = t.insistent.openNags('u')
    expect(nag?.occurrence).toContain(':finish:')
    const current = t.store.getObject('rent')!
    t.store.putObject({ ...current, props: { ...current.props, finish: { kind: 'date', value: { start: '2026-10-21T14:00:00.000Z', resolution: 'time', rrule: 'FREQ=DAILY' } } } })
    await t.runTo('2026-10-20T11:01:00')
    expect(t.insistent.nag(nag!.id)?.outcome).toBe('done')
  })

  it('settles a plan-time reminder when completing elsewhere advances the deadline and clears the plan', async () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { ...rent.props, due: { kind: 'date', value: { start: '2026-10-20T18:00:00.000Z', resolution: 'time', rrule: 'FREQ=DAILY' } }, dodate: { kind: 'date', value: { start: '2026-10-20T12:00:00.000Z', resolution: 'time' } } } })
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { objectId: rent.id, steps: [{ after: 0, channels: ['ntfy'] }] })
    await t.runTo('2026-10-20T09:00:30')
    const [nag] = t.insistent.openNags('u')
    expect(nag?.occurrence).toContain(':dodate:')
    const current = t.store.getObject('rent')!
    const { dodate: _plan, ...props } = current.props
    t.store.putObject({ ...current, props: { ...props, due: { kind: 'date', value: { start: '2026-10-21T18:00:00.000Z', resolution: 'time', rrule: 'FREQ=DAILY' } } } })
    await t.runTo('2026-10-20T09:01:00')
    expect(t.insistent.nag(nag!.id)?.outcome).toBe('done')
  })

  it('does not digest work plans as deadlines', () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { status: rent.props.status!, due: { kind: 'date', value: { start: '2026-10-21T00:00:00.000Z', resolution: 'day' } }, dodate: { kind: 'date', value: { start: '2026-10-19T00:00:00.000Z', resolution: 'day' } } } })
    expect(t.insistent.tasks(t.user, 's')).toEqual([])
  })

  it('respects dated pauses and a weekly goal met from imports', async () => {
    const t = setup()
    const habit = t.store.getObject('ritual')!
    t.store.putObject({ ...habit, props: { ...habit.props, [habitPauseKey('2026-10-20')]: { kind: 'text', value: '2026-10-20' }, perweek: { kind: 'number', value: 1 }, [habitSparkyKey('2026-10-21')]: DONE_VALUE } })
    const rule = t.insistent.create(t.user, { objectId: habit.id, steps: [{ after: 0, channels: ['ntfy'] }] })
    await t.insistent.tick(t.user, local('2026-10-20T08:59:00'), local('2026-10-20T09:01:00'))
    expect(t.insistent.openNags('u')).toEqual([])
    t.setNow('2026-10-22T09:01:00')
    await t.insistent.tick(t.user, local('2026-10-22T08:59:00'), t.now)
    expect(t.insistent.openNags('u')).toEqual([])
    t.setNow('2026-10-26T09:01:00')
    await t.insistent.tick(t.user, local('2026-10-26T08:59:00'), t.now)
    expect(t.insistent.openNags('u')[0]?.ruleId).toBe(rule.id)
  })

  it('stops an open nag when its week is completed elsewhere or a dated pause starts', async () => {
    const t = setup()
    const habit = t.store.getObject('ritual')!
    t.store.putObject({ ...habit, props: { ...habit.props, perweek: { kind: 'number', value: 1 } } })
    const rule = t.insistent.create(t.user, { objectId: habit.id, steps: [{ after: 0, channels: ['ntfy'] }] })
    t.setNow('2026-10-20T09:00:00')
    await t.insistent.tick(t.user, t.now - 60_000, t.now)
    const nag = t.insistent.openNags('u')[0]!
    expect(nag.ruleId).toBe(rule.id)
    const current = t.store.getObject(habit.id)!
    t.store.putObject({ ...current, props: { ...current.props, [habitSparkyKey('2026-10-19')]: DONE_VALUE } })
    await t.insistent.tick(t.user, t.now - 1, t.now)
    expect(t.insistent.nag(nag.id)?.outcome).toBe('done')
    expect(t.store.getObject(habit.id)!.props[habitDoneKey('2026-10-20')]).toBeUndefined()
    t.setNow('2026-10-26T09:00:00')
    await t.insistent.tick(t.user, t.now - 60_000, t.now)
    const next = t.insistent.openNags('u')[0]!
    const beforePause = t.store.getObject(habit.id)!
    t.store.putObject({ ...beforePause, props: { ...beforePause.props, [habitPauseKey('2026-10-26')]: { kind: 'text', value: '' } } })
    await t.insistent.tick(t.user, t.now - 1, t.now)
    expect(t.insistent.nag(next.id)).toMatchObject({ outcome: 'skipped', reason: 'The habit is no longer scheduled for this day' })
  })

  it.each(['done', 'typed', 'said'] as const)('acknowledges imported habits on %s without masking future source values', async (answer) => {
    const t = setup()
    const habit = t.store.getObject('ritual')!
    const props = { ...habit.props, target: { kind: 'number' as const, value: 10000 }, sparkyfitness: { kind: 'select' as const, value: ['steps'] }, [habitSparkyKey('2026-10-20')]: { kind: 'number' as const, value: 4000 } }
    t.store.putObject({ ...habit, props })
    const rule = t.insistent.create(t.user, { objectId: habit.id, ack: answer === 'done' ? 'done' : answer === 'typed' ? 'type' : 'say', steps: [{ after: 0, channels: ['ntfy'] }] })
    const view = await t.insistent.startNow(t.user, rule.id)
    expect(view).toMatchObject({ acknowledgementOnly: true })
    await t.insistent.answer(t.user, view.id, { answer, texts: view.expected })
    expect(t.store.getObject(habit.id)!.props).toEqual(props)
    expect(t.ntfy[0]!.message).toContain('Acknowledges this reminder only')
    t.store.putObject({ ...habit, props: { ...props, [habitSparkyKey('2026-10-20')]: { kind: 'number', value: 7000 } } })
    expect(habitValue(t.store.getObject(habit.id)!, '2026-10-20')).toBe(7000)
  })

  it('leaves a parent with open steps for an explicit decision on its task page', async () => {
    const t = setup()
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    t.store.putType({ ...type, subtasks: { parentField: 'parent' }, properties: [...type.properties, { id: 'parent', name: 'Part of', kind: 'relation', targetTypeIds: [type.id], multiple: false }] })
    t.store.putObject(newObject(type, { title: 'Step', props: { parent: { kind: 'relation', value: ['rent'] } } }, 'step', AT))
    const rule = t.insistent.create(t.user, { objectId: 'rent' })
    const view = await t.insistent.startNow(t.user, rule.id)
    await expect(t.insistent.answer(t.user, view.id, { answer: 'done' })).rejects.toThrow('open steps')
    expect(t.store.getObject('rent')!.props.status).toEqual({ kind: 'select', value: ['todo'] })
    expect(t.insistent.nag(view.id)!.outcome).toBeUndefined()
  })

  it('tells Telegram a typed completion was refused for open steps, and keeps asking', async () => {
    const t = setup()
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    t.store.putType({ ...type, subtasks: { parentField: 'parent' }, properties: [...type.properties, { id: 'parent', name: 'Part of', kind: 'relation', targetTypeIds: [type.id], multiple: false }] })
    t.store.putObject(newObject(type, { title: 'Step', props: { parent: { kind: 'relation', value: ['rent'] } } }, 'step', AT))
    const rule = t.insistent.create(t.user, { objectId: 'rent', ack: 'type' })
    const view = await t.insistent.startNow(t.user, rule.id)
    t.insistent.sentTelegram(view.id, 42, 700)
    expect(await t.insistent.telegramReply(t.user, 700, 'Pay rent')).toMatch(/^Not done\. .*open steps/)
    expect(t.store.getObject('rent')!.props.status).toEqual({ kind: 'select', value: ['todo'] })
    expect(t.insistent.nag(view.id)!.outcome).toBeUndefined()
  })

  it('ends a task reminder when its time is moved, and starts one at the new time', async () => {
    const t = setup()
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { objectId: 'rent', steps: [{ after: 0, channels: ['ntfy'] }], repeat: 10 })
    await t.runTo('2026-10-20T11:00:30')
    const [nag] = t.insistent.openNags('u')
    expect(nag?.occurrence).toContain(':due:2026-10-20T14:00:00.000Z')
    const sent = t.ntfy.length
    // Put off to the afternoon: the 11:00 reminder stops asking.
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { ...rent.props, dodate: { kind: 'date', value: { start: '2026-10-20T18:00:00.000Z', resolution: 'time' } } } })
    await t.runTo('2026-10-20T11:30:00')
    expect(t.insistent.nag(nag!.id)).toMatchObject({ outcome: 'skipped', reason: 'The task was moved to another time' })
    expect(t.ntfy).toHaveLength(sent)
    // It reminds again at the new time.
    await t.runTo('2026-10-20T15:00:30')
    expect(t.insistent.openNags('u')[0]?.occurrence).toContain(':dodate:2026-10-20T18:00:00.000Z')
  })

  it('acknowledges only the habits linked to SparkyFitness now, not ones unlinked since', async () => {
    const t = setup()
    const habit = t.store.getObject('ritual')!
    const rule = t.insistent.create(t.user, { objectId: habit.id, ack: 'done', steps: [{ after: 0, channels: ['ntfy'] }] })
    t.store.putObject({ ...habit, props: { ...habit.props, [habitSparkyKey('2026-10-19')]: DONE_VALUE } })
    const view = await t.insistent.startNow(t.user, rule.id)
    expect(view).not.toHaveProperty('acknowledgementOnly')
    await t.insistent.answer(t.user, view.id, { answer: 'done' })
    expect(isHabitDone(t.store.getObject(habit.id)!, '2026-10-20')).toBe(true)
  })

  it('lists tasks planned for today or earlier under their own heading, once', async () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    const day = (d: string) => ({ kind: 'date' as const, value: { start: `${d}T00:00:00.000Z`, resolution: 'day' as const } })
    const status = { kind: 'select' as const, value: ['todo'] }
    // Due and planned (once, under Due), planned only (late and today), planned later, planned but done.
    t.store.putObject({ ...rent, props: { status, due: day('2026-10-20'), dodate: day('2026-10-19') } })
    t.store.putObject(newObject(type, { title: 'Late plan', props: { status, dodate: day('2026-10-18') } }, 'late', AT))
    t.store.putObject(newObject(type, { title: 'Plan today', props: { status, dodate: day('2026-10-20') } }, 'today', AT))
    t.store.putObject(newObject(type, { title: 'Plan later', props: { status, dodate: day('2026-10-21') } }, 'later', AT))
    t.store.putObject(newObject(type, { title: 'Plan done', props: { status: { kind: 'select', value: ['done'] }, dodate: day('2026-10-20') } }, 'finished', AT))
    expect(t.insistent.tasks(t.user, 's').map((x) => x.id)).toEqual(['rent'])
    expect(t.insistent.planned(t.user, 's')).toEqual([{ id: 'late', title: 'Late plan', day: '2026-10-18' }, { id: 'today', title: 'Plan today', day: '2026-10-20' }])
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { title: 'Digest', content: { kind: 'tasks' }, when: { kind: 'daily', at: '07:30' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    await t.runTo('2026-10-20T07:30:30')
    expect(t.ntfy[0]!.message.split('\n').slice(0, 5)).toEqual(['Due', '• Pay rent', 'Planned today', '• Late plan (planned 2026-10-18)', '• Plan today'])
    const [nag] = t.insistent.openNags('u')
    expect(t.insistent.view(t.user, nag!.id)).toMatchObject({
      tasks: [{ id: 'rent', title: 'Pay rent', typeId: type.id, due: '2026-10-20T00:00:00.000Z' }],
      planned: [
        { id: 'late', title: 'Late plan', typeId: type.id, day: '2026-10-18' },
        { id: 'today', title: 'Plan today', typeId: type.id, day: '2026-10-20' },
      ],
    })
  })

  it('keeps empty task groups in the reminder view, but not on other reminders', async () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { status: { kind: 'select', value: ['done'] } } })
    await t.reminders.tick(t.now)
    // Empty days are skipped by default (skipIfEmpty); this rule opts out to show its empty groups.
    t.insistent.create(t.user, { title: 'Digest', content: { kind: 'tasks' }, skipIfEmpty: false, when: { kind: 'daily', at: '07:30' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    t.insistent.create(t.user, { title: 'Read', content: { kind: 'target' }, objectId: 'p1', when: { kind: 'daily', at: '07:30' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    await t.runTo('2026-10-20T07:30:30')
    const views = t.insistent.openNags('u').map((nag) => t.insistent.view(t.user, nag.id))
    expect(views.find((view) => view.title === 'Digest')).toMatchObject({ tasks: [], planned: [] })
    expect(views.find((view) => view.title !== 'Digest')).not.toHaveProperty('planned')
  })

  it('checks its rules', () => {
    const t = setup()
    expect(() => t.insistent.create(t.user, { content: { kind: 'tasks' } })).toThrow('title')
    expect(() => t.insistent.create(t.user, { objectId: 'p1', when: { kind: 'object' } })).toThrow('no time of its own')
    expect(() => t.insistent.create(t.user, { objectId: 'p1', ack: 'done' })).toThrow('habit or a task')
    expect(() => t.insistent.create(t.user, { objectId: 'ritual', when: { kind: 'daily', at: '25:00' } })).toThrow('HH:MM')
    expect(() => t.insistent.create(t.user, { objectId: 'ritual', repeat: 7 })).toThrow('repeat')
    expect(() => t.insistent.create(t.user, { objectId: 'ritual', steps: [{ after: 0, channels: ['ntfy'] }, { after: 0, channels: ['telegram'] }] })).toThrow('later')
    expect(() => t.insistent.create(t.user, { objectId: 'ritual', steps: [{ after: 0, channels: ['pigeon' as never] }] })).toThrow('each step')
    expect(() => t.insistent.create(t.user, { title: 'X', content: { kind: 'tasks' }, ack: 'say' })).toThrow('type or say')
    expect(() => t.insistent.create(t.user, { title: 'X', content: { kind: 'tag', tagId: 'p1' } })).toThrow('no such tag')
    const rule = t.insistent.create(t.user, { objectId: 'p1' })
    expect(rule).toMatchObject({ when: { kind: 'daily', at: '09:00' }, ack: 'ok', spaceId: 's' })
    expect(t.insistent.update(t.user, rule.id, { when: { kind: 'daily', at: '7:05', days: [0, 1, 2, 3, 4, 5, 6] } }).when).toEqual({ kind: 'daily', at: '07:05' })
    t.insistent.remove('u', rule.id)
    expect(t.insistent.rules('u').map((r) => r.id)).not.toContain(rule.id)
  })

  it('skips Today’s tasks when empty by default, lets rules opt out, and scopes rules and open nags by space', async () => {
    const t = setup()
    // Mark the only task in space 's' done so today has no due tasks.
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { ...rent.props, status: { kind: 'select', value: ['done'] } } })
    // Add a second space with its own tag and pending task.
    t.store.putSpace({ id: 'work', name: 'Work', sidebar: [], createdAt: AT })
    for (const type of createBuiltinTypes('work', AT)) t.store.putType(type)
    t.store.putMember({ spaceId: 'work', userId: 'u', role: 'owner', createdAt: AT })
    const workTaskType = t.store.getType(builtinTypeId('work', 'task'))!
    t.store.putObject(newObject(workTaskType, { title: 'Ship PR', props: { status: { kind: 'select', value: ['todo'] }, due: { kind: 'date', value: { start: '2026-10-20', resolution: 'day' } } } }, 'ship', AT))
    const emptyTag = t.store.getType(builtinTypeId('s', 'tag'))!
    t.store.putObject(newObject(emptyTag, { title: 'EmptyTag' }, 'empty-tag', AT))

    t.reminders.save('u', { habits: false, eventsBefore: null })
    await t.reminders.tick(t.now)

    // Default for tasks: skipIfEmpty = true -> does NOT fire when space 's' has 0 tasks.
    const skippedTasks = t.insistent.create(t.user, { spaceId: 's', title: 'Empty tasks', content: { kind: 'tasks' }, when: { kind: 'daily', at: '08:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    expect(skippedTasks.skipIfEmpty).toBe(true)
    // Explicit skipIfEmpty: false -> DOES fire even with 0 tasks.
    const alwaysTasks = t.insistent.create(t.user, { spaceId: 's', title: 'Always tasks', content: { kind: 'tasks' }, skipIfEmpty: false, when: { kind: 'daily', at: '08:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    expect(alwaysTasks.skipIfEmpty).toBe(false)
    // Tag with skipIfEmpty: true -> does NOT fire when empty.
    t.insistent.create(t.user, { spaceId: 's', title: 'Empty tag', content: { kind: 'tag', tagId: 'empty-tag' }, skipIfEmpty: true, when: { kind: 'daily', at: '08:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })
    // Space 'work' has a pending task -> DOES fire.
    const workTasks = t.insistent.create(t.user, { spaceId: 'work', title: 'Work tasks', content: { kind: 'tasks' }, when: { kind: 'daily', at: '08:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: null })

    await t.runTo('2026-10-20T08:00:30')
    expect(t.ntfy.map((n) => n.title)).toEqual(['Always tasks', 'Work tasks'])

    // Space scoping for rules and open nags:
    expect(t.insistent.rules('u', 'work').map((r) => r.id)).toEqual([workTasks.id])
    expect(t.insistent.rules('u', 's').map((r) => r.id)).not.toContain(workTasks.id)
    expect(t.insistent.openNags('u', 's').map((n) => n.ruleId)).toEqual([alwaysTasks.id])
    expect(t.insistent.openNags('u', 'work').map((n) => n.ruleId)).toEqual([workTasks.id])

    // Completing the last task in 'work' auto-closes its open tasks nag on the next tick.
    const ship = t.store.getObject('ship')!
    t.store.putObject({ ...ship, props: { ...ship.props, status: { kind: 'select', value: ['done'] } } })
    await t.runTo('2026-10-20T08:01:00')
    expect(t.insistent.openNags('u', 'work')).toEqual([])
  })
})

describe('today’s tasks and timed tasks after 0.13', () => {
  it('does not skip Today’s tasks while a task is planned for today, though nothing is due', async () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { ...rent.props, status: { kind: 'select', value: ['done'] } } })
    const type = t.store.getType(builtinTypeId('s', 'task'))!
    t.store.putObject(newObject(type, { title: 'Plan today', props: { status: { kind: 'select', value: ['todo'] }, dodate: { kind: 'date', value: { start: '2026-10-20T00:00:00.000Z', resolution: 'day' } } } }, 'today', AT))
    t.reminders.save('u', { habits: false, eventsBefore: null })
    await t.reminders.tick(t.now)
    t.insistent.create(t.user, { spaceId: 's', title: 'Today', content: { kind: 'tasks' }, when: { kind: 'daily', at: '08:00' }, steps: [{ after: 0, channels: ['ntfy'] }], repeat: 10 })
    await t.runTo('2026-10-20T08:00:30')
    expect(t.ntfy.map((n) => n.title)).toEqual(['Today'])
    await t.runTo('2026-10-20T08:15:00')
    expect(t.insistent.openNags('u', 's')).toHaveLength(1)
  })

  it('keeps an automatic reminder at a task’s Due time when the task also has a timed Do date', async () => {
    const t = setup()
    const rent = t.store.getObject('rent')!
    t.store.putObject({ ...rent, props: { ...rent.props, dodate: { kind: 'date', value: { start: '2026-10-20T18:00:00.000Z', resolution: 'time' } } } })
    t.reminders.save('u', { spaceId: 's', habits: false, eventsBefore: null, tasksBefore: 10, tasksStyle: 'popup' })
    await t.runTo('2026-10-20T13:50:30')
    const open = t.insistent.openNags('u').filter((n) => n.occurrence.includes(':due:'))
    expect(open).toHaveLength(1)
    await t.runTo('2026-10-20T13:52:00')
    expect(t.insistent.nag(open[0]!.id)).not.toMatchObject({ outcome: 'skipped' })
  })
})

describe('matching typed and heard text', () => {
  it('forgives case, accents, punctuation and a slip in a long word', () => {
    expect(textMatch('Você é o amor da sua vida.', 'voce e o amor da sua vida')).toBe(1)
    expect(textMatch('Você não deve beleza a ninguém.', 'você não deve beleza a ninguem')).toBe(1)
    expect(textMatch('Você não deve beleza a ninguém.', 'você não deve belesa a ninguém')).toBe(1)
    expect(textMatch('Você é o amor da sua vida.', 'você é o amor')).toBeLessThan(0.7)
    expect(textMatch('Use o que quiser. Faça o que quiser.', 'use o que quiser faça o que quiser obrigada')).toBe(1)
  })
})
