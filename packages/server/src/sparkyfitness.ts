// SparkyFitness is read-only. Its values live beside hand check-ins, which always take priority.
// A habit linked to steps, water or sleep needs a daily goal (any amount counting as done made fifty
// steps a success), and sleep and water are stored in the habit's unit.
import { addDays, dayIn, habitDoneKey, habitSparkyKey, habitSparkyProperties, habitSparkyRule, habitTarget, habitUnit, sparkyRules, HABIT_SPARKY_PROPERTY_ID, HABIT_SPARKY_WORKOUTS_PROPERTY_ID, HABIT_TARGET_PROPERTY_ID, HABIT_UNIT_PROPERTY_ID, type ObjectSummary, type PropertyValue } from '@vasta/core'
import type { NodeStore } from '@vasta/core/node'
import { outsideActor } from './actor.ts'
import type { ChangeFeed } from './events.ts'
import { PrivateAddressError, safeFetch } from './safe-fetch.ts'

export const sparkyHistory = [0, 7, 30, 90, 365] as const
/** The days before the last successful sync a routine sync reads again, for what changed after it was read. */
const OVERLAP_DAYS = 2
/** The rules that count an amount, and so need a daily goal to say when a day is done. */
const AMOUNT_RULES = ['steps', 'water', 'sleep']
interface Connection {
  space_id: string
  base_url: string
  api_key: string
  history: number
  time_zone: string
  synced_at: string | null
  error: string | null
  created_at: string
  signatures: string
  workouts: string
}
interface Workout { name: string }
interface Measurement { entry_date: string; steps: number | string }
interface Sleep { entry_date: string; time_asleep_in_seconds?: number; duration_in_seconds: number }
interface Summary { foodEntries: unknown[]; calorieBalance: { eaten: number; goal: number; remaining: number } }

/** A problem with what the user entered or with SparkyFitness's answer, safe to show as it is. */
export class SparkyError extends Error {}

export function sparkyWater(ml: number, unit: string): number {
  const normalized = unit.trim().toLowerCase()
  if (normalized && !/^(ml|l|litres?|liters?|oz|fl oz|glass|glasses|cups?)$/.test(normalized)) throw new SparkyError('Choose ml, L, oz, glasses or cups as the water habit unit')
  return ml / (/^(l|litres?|liters?)$/.test(normalized) ? 1000 : /^(oz|fl oz)$/.test(normalized) ? 29.5735 : /^(glass|glasses|cups?)$/.test(normalized) ? 250 : 1)
}

/** Seconds asleep in the habit's unit: hours (also when it has none) or minutes. */
export function sparkySleep(seconds: number, unit: string): number {
  const normalized = unit.trim().toLowerCase()
  if (normalized && !/^(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/.test(normalized)) throw new SparkyError('Choose hours or minutes as the sleep habit unit')
  return seconds / (/^(m|min|mins|minute|minutes)$/.test(normalized) ? 60 : 3600)
}

interface DayData { names: string[]; steps: Measurement[]; water?: { water_ml: number }; sleep: Sleep[]; summary?: Summary }
export interface SparkyPreviewDay { day: string; value: PropertyValue | null; manual: PropertyValue | null }

function dayValue(habit: Pick<ObjectSummary, 'props' | 'createdAt'>, day: string, data: DayData): PropertyValue | null {
  const rule = habitSparkyRule(habit)
  // Without a goal there is no telling what a day's amount means: nothing is imported.
  if (AMOUNT_RULES.includes(rule ?? '') && !habitTarget(habit)) return null
  if (rule === 'steps') {
    const values = data.steps.filter((r) => r.entry_date.slice(0, 10) === day && r.steps !== null && r.steps !== undefined).map((r) => Number(r.steps)).filter(Number.isFinite)
    return values.length ? { kind: 'number', value: Math.max(0, ...values) } : null
  }
  if (rule === 'water') return data.water && Number.isFinite(Number(data.water.water_ml)) ? { kind: 'number', value: sparkyWater(Number(data.water.water_ml), habitUnit(habit)) } : null
  if (rule === 'sleep') {
    const rows = data.sleep.filter((r) => r.entry_date.slice(0, 10) === day)
    return rows.length ? { kind: 'number', value: sparkySleep(rows.reduce((n, r) => n + Number(r.time_asleep_in_seconds ?? r.duration_in_seconds), 0), habitUnit(habit)) } : null
  }
  if (rule === 'calories') return data.summary ? { kind: 'checkbox', value: !!data.summary.foodEntries.length && Number.isFinite(data.summary.calorieBalance.remaining) && data.summary.calorieBalance.remaining >= 0 } : null
  const prop = habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID]
  const wanted = prop?.kind === 'text' ? prop.value.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean) : []
  return { kind: 'checkbox', value: data.names.some((name) => wanted.includes(name.toLowerCase())) }
}

function safeError(error: unknown): string {
  return error instanceof PrivateAddressError ? 'Private network blocked; set VASTA_ALLOW_PRIVATE_FETCH on the Vasta server to allow this host' : error instanceof SparkyError ? error.message : 'Could not read SparkyFitness; check the address, read-only key and server availability'
}

export class SparkyFitnessService {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = new Map<string, Promise<void>>()
  private writing = new Set<string>()
  private pending = new Set<string>()
  private generation = new Map<string, number>()
  private progress = new Map<string, { done: number; total: number }>()
  private unsubscribe: (() => void) | undefined

  private options: { store: NodeStore; feed: ChangeFeed; now: () => string; fetch?: (url: string, init?: RequestInit) => Promise<Response> }

  constructor(options: { store: NodeStore; feed: ChangeFeed; now: () => string; fetch?: (url: string, init?: RequestInit) => Promise<Response> }) {
    this.options = options
  }

  private connection(spaceId: string): Connection | undefined {
    return this.options.store.db.prepare('SELECT * FROM sparkyfitness_connections WHERE space_id = ?').get(spaceId) as unknown as Connection | undefined
  }

  status(spaceId: string) {
    const row = this.connection(spaceId)
    return row ? { baseUrl: row.base_url, hasKey: !!row.api_key, history: row.history, syncedAt: row.synced_at, error: row.error, workouts: [...new Set(Object.values(JSON.parse(row.workouts) as Record<string, string[]>).flat())].sort(), importing: this.progress.get(spaceId) } : null
  }

  /**
   * Save a habit's props as the server's own write (no user made it) and tell the app. `keep`
   * says which props stay; a habit that would lose none is not written at all.
   */
  private strip(habit: Pick<ObjectSummary, 'id' | 'props'>, spaceId: string, keep: (key: string) => boolean) {
    const { store, feed, now } = this.options
    if (Object.keys(habit.props).every(keep)) return
    const object = store.getObject(habit.id)!
    const props = Object.fromEntries(Object.entries(object.props).filter(([key]) => keep(key)))
    const saved = outsideActor(() => store.putObject({ ...object, props, updatedAt: now() }))
    this.writing.add(saved.id)
    try { feed.emit({ kind: 'object', id: saved.id, spaceId, typeId: saved.typeId, updatedAt: saved.updatedAt }) } finally { this.writing.delete(saved.id) }
  }

  private habitType(spaceId: string) {
    return this.options.store.listTypes(spaceId).find((t) => t.system === 'habit')
  }

  connect(spaceId: string, input: { baseUrl: string; apiKey?: string; history?: number; timeZone?: string }) {
    let url: URL
    try { url = new URL(input.baseUrl.trim()) } catch { throw new SparkyError('enter a server address starting with https:// or http://') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new SparkyError('enter a server address starting with https:// or http://, without credentials')
    const previous = this.connection(spaceId)
    const baseUrl = url.toString().replace(/\/$/, '').replace(/\/api$/, '')
    if (previous && previous.base_url !== baseUrl && !input.apiKey?.trim()) throw new SparkyError('enter the read-only key for the new server address')
    const apiKey = input.apiKey?.trim() || previous?.api_key
    if (!apiKey) throw new SparkyError('enter a read-only API key')
    const sourceChanged = !!previous && (previous.base_url !== baseUrl || previous.api_key !== apiKey)
    const history = input.history ?? previous?.history ?? 30
    if (!sparkyHistory.includes(history as typeof sparkyHistory[number])) throw new SparkyError('choose a history range')
    const timeZone = input.timeZone ?? previous?.time_zone ?? 'UTC'
    try { dayIn(this.options.now(), timeZone) } catch { throw new SparkyError('choose a valid time zone') }
    this.generation.set(spaceId, (this.generation.get(spaceId) ?? 0) + 1)
    this.options.store.db.prepare(`INSERT INTO sparkyfitness_connections (space_id, base_url, api_key, history, created_at, time_zone) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET base_url=excluded.base_url, api_key=excluded.api_key, history=excluded.history, time_zone=excluded.time_zone, created_at=CASE WHEN history != excluded.history OR base_url != excluded.base_url OR api_key != excluded.api_key THEN excluded.created_at ELSE created_at END, signatures=CASE WHEN history != excluded.history OR base_url != excluded.base_url OR api_key != excluded.api_key THEN '{}' ELSE signatures END, synced_at=CASE WHEN base_url != excluded.base_url OR api_key != excluded.api_key THEN NULL ELSE synced_at END, workouts=CASE WHEN base_url != excluded.base_url OR api_key != excluded.api_key THEN '{}' ELSE workouts END, error=NULL`).run(spaceId, baseUrl, apiKey, history, this.options.now(), timeZone)
    if (this.running.has(spaceId)) this.pending.add(spaceId)
    const type = this.habitType(spaceId)
    if (type && sourceChanged) for (const habit of this.options.store.listObjects(type.id)) this.strip(habit, spaceId, (key) => !key.startsWith('sf:'))
    if (type) {
      const properties = [...type.properties]
      for (const property of habitSparkyProperties()) if (!properties.some((p) => p.id === property.id)) properties.push(property)
      this.options.store.putType({ ...type, properties, updatedAt: this.options.now() })
      this.options.feed.emit({ kind: 'type', id: type.id, spaceId })
    }
  }

  /**
   * Remove the connection. Days already filled stay, unless `remove`: then the imported values go
   * too, from every habit, with each habit's link and the two properties the connection added.
   */
  disconnect(spaceId: string, { remove = false }: { remove?: boolean } = {}) {
    this.generation.set(spaceId, (this.generation.get(spaceId) ?? 0) + 1)
    this.options.store.db.prepare('DELETE FROM sparkyfitness_connections WHERE space_id = ?').run(spaceId)
    const type = this.habitType(spaceId)
    if (!remove || !type) return
    const added = [HABIT_SPARKY_PROPERTY_ID, HABIT_SPARKY_WORKOUTS_PROPERTY_ID]
    for (const habit of this.options.store.listObjects(type.id)) this.strip(habit, spaceId, (key) => !key.startsWith('sf:') && !added.includes(key))
    this.options.store.putType({ ...type, properties: type.properties.filter((p) => !added.includes(p.id)), updatedAt: this.options.now() })
    this.options.feed.emit({ kind: 'type', id: type.id, spaceId })
  }

  private async get<T>(row: Connection, path: string): Promise<T> {
    const response = await (this.options.fetch ?? safeFetch)(`${row.base_url}/api${path}`, { headers: { authorization: `Bearer ${row.api_key}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new SparkyError(`SparkyFitness answered ${response.status}; check the address and read-only key`)
    return await response.json() as T
  }

  private async dayData(row: Connection, day: string, rules: Set<string | undefined>, includeWorkouts = false): Promise<DayData> {
    const entries = includeWorkouts || rules.has('workout') ? await this.get<Workout[]>(row, `/exercise-entries/by-date?selectedDate=${day}`) : []
    return {
      names: entries.map((e) => e.name?.trim()).filter((name) => name && name.toLowerCase() !== 'active calories'),
      steps: rules.has('steps') ? await this.get<Measurement[]>(row, `/measurements/check-in-measurements-range/${day}/${day}`) : [],
      water: rules.has('water') ? await this.get<{ water_ml: number }>(row, `/measurements/water-intake/${day}`) : undefined,
      sleep: rules.has('sleep') ? await this.get<Sleep[]>(row, `/sleep?startDate=${day}&endDate=${day}`) : [],
      summary: rules.has('calories') ? await this.get<Summary>(row, `/daily-summary?date=${day}`) : undefined,
    }
  }

  /** The last seven days of what SparkyFitness would give a habit with this link; `target` and `unit` try a goal and unit not saved yet. */
  async preview(habitId: string, input: { rule: string; workouts?: string; target?: number; unit?: string }): Promise<SparkyPreviewDay[]> {
    const habit = this.options.store.getObject(habitId)
    if (!habit || habit.deletedAt || this.options.store.getType(habit.typeId)?.system !== 'habit') throw new SparkyError('habit not found')
    if (!sparkyRules.some(([rule]) => rule === input.rule) || (input.workouts !== undefined && typeof input.workouts !== 'string')) throw new SparkyError('choose a SparkyFitness rule')
    if (input.target !== undefined && !(typeof input.target === 'number' && input.target > 0)) throw new SparkyError('the daily goal must be more than 0')
    const row = this.connection(habit.spaceId)
    if (!row) throw new SparkyError('connect SparkyFitness in space settings first')
    const props: Record<string, PropertyValue> = { ...habit.props, [HABIT_SPARKY_PROPERTY_ID]: { kind: 'select', value: [input.rule] }, [HABIT_SPARKY_WORKOUTS_PROPERTY_ID]: { kind: 'text', value: input.workouts ?? '' } }
    if (input.target !== undefined) props[HABIT_TARGET_PROPERTY_ID] = { kind: 'number', value: input.target }
    if (input.unit !== undefined) props[HABIT_UNIT_PROPERTY_ID] = { kind: 'text', value: input.unit }
    const candidate = { ...habit, props }
    if (AMOUNT_RULES.includes(input.rule) && !habitTarget(candidate)) throw new SparkyError('Set a daily goal for this habit first, so SparkyFitness days can count as done')
    const today = dayIn(this.options.now(), row.time_zone)
    const days: SparkyPreviewDay[] = []
    try {
      for (let day = addDays(today, -6); day <= today; day = addDays(day, 1)) {
        const data = await this.dayData(row, day, new Set([input.rule]))
        days.push({ day, value: dayValue(candidate, day, data), manual: habit.props[habitDoneKey(day)] ?? null })
      }
    } catch (error) { throw new SparkyError(safeError(error)) }
    return days
  }

  start(intervalMs = 30 * 60_000) {
    const all = () => {
      const rows = this.options.store.db.prepare('SELECT space_id FROM sparkyfitness_connections').all()
      for (const row of rows) void this.sync(row.space_id as string)
    }
    this.unsubscribe = this.options.feed.subscribe((event) => {
      if (event.kind === 'object' && !this.writing.has(event.id) && this.connection(event.spaceId)) {
        const object = this.options.store.getObject(event.id)
        if (object && habitSparkyRule(object) && this.options.store.getType(object.typeId)?.system === 'habit' && this.signature(object) !== this.signatures(event.spaceId)[object.id]) {
          this.pending.add(event.spaceId)
          void this.sync(event.spaceId)
        }
      }
    })
    all()
    this.timer = setInterval(all, intervalMs)
    this.timer.unref?.()
  }

  stop() { clearInterval(this.timer); this.unsubscribe?.() }

  private signature(habit: Pick<ObjectSummary, 'props' | 'createdAt'>) {
    return JSON.stringify([habitSparkyRule(habit), habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID], habitUnit(habit), !!habitTarget(habit)])
  }

  private signatures(spaceId: string): Record<string, string> {
    return JSON.parse(this.connection(spaceId)?.signatures ?? '{}') as Record<string, string>
  }

  /** Import now (or join the import running); whatever started it, a server job: it records no user. */
  sync(spaceId: string): Promise<void> {
    const running = this.running.get(spaceId)
    if (running) return running
    this.pending.delete(spaceId)
    const run = outsideActor(() => this.import(spaceId)).finally(() => {
      this.running.delete(spaceId)
      this.progress.delete(spaceId)
      if (this.pending.delete(spaceId) && this.connection(spaceId)) void this.sync(spaceId)
    })
    this.running.set(spaceId, run)
    return run
  }

  private async import(spaceId: string) {
    const row = this.connection(spaceId)
    if (!row || !this.options.store.getSpace(spaceId)) return
    const generation = this.generation.get(spaceId)
    const { store, feed, now } = this.options
    const signatures = this.signatures(spaceId)
    const today = dayIn(now(), row.time_zone)
    const historyStart = addDays(today, -Math.max(0, row.history - 1))
    // A routine sync reads again from two days before the last good one (so an outage of any length is
    // caught up), but never before the history asked for: None starts the day it was chosen.
    const floor = row.history === 0 ? dayIn(row.created_at, row.time_zone) : historyStart
    const lastSync = row.synced_at ? dayIn(row.synced_at, row.time_zone) : undefined
    const routineStart = lastSync ? [floor, addDays(lastSync, -OVERLAP_DAYS)].sort().at(-1)! : historyStart
    const type = this.habitType(spaceId)
    const habits = type ? store.listObjects(type.id).filter((h) => habitSparkyRule(h)) : []
    // A habit whose link changed starts over: what was imported with the old one goes.
    for (const habit of habits) if (signatures[habit.id] && signatures[habit.id] !== this.signature(habit)) this.strip(habit, spaceId, (key) => !key.startsWith('sf:'))
    const starts = new Map(habits.map((h) => [h.id, signatures[h.id] === this.signature(h) ? routineStart : historyStart]))
    // The workout names of the last month are kept for the link form to suggest.
    const workoutStart = lastSync ? [addDays(today, -29), addDays(lastSync, -OVERLAP_DAYS)].sort().at(-1)! : addDays(today, -29)
    const start = [...starts.values(), workoutStart].sort()[0]!
    const workouts = Object.fromEntries(Object.entries(JSON.parse(row.workouts) as Record<string, string[]>).filter(([day]) => day >= addDays(today, -29)))
    const total = Math.round((Date.parse(today) - Date.parse(start)) / 86400000) + 1
    this.progress.set(spaceId, { done: 0, total })
    try {
      for (let day = start; day <= today; day = addDays(day, 1)) {
        if (this.generation.get(spaceId) !== generation || this.connection(spaceId)?.api_key !== row.api_key || this.connection(spaceId)?.base_url !== row.base_url) return
        const active = habits.filter((h) => day >= starts.get(h.id)!)
        const rules = new Set(active.map(habitSparkyRule))
        const data = await this.dayData(row, day, rules, day >= addDays(today, -29))
        if (day >= addDays(today, -29)) workouts[day] = data.names
        if (this.generation.get(spaceId) !== generation || this.connection(spaceId)?.api_key !== row.api_key || this.connection(spaceId)?.base_url !== row.base_url) return
        for (const habit of active) {
          const value = dayValue(habit, day, data)
          if (!value) continue
          // Re-read after the fetch: a hand check-in may have arrived while waiting for the server.
          const object = store.getObject(habit.id)
          if (!object || object.deletedAt || this.signature(object) !== this.signature(habit)) continue
          const key = habitSparkyKey(day)
          if (JSON.stringify(object.props[key]) === JSON.stringify(value)) continue
          const saved = store.putObject({ ...object, props: { ...object.props, [key]: value }, updatedAt: now() })
          this.writing.add(saved.id)
          try {
            feed.emit({ kind: 'object', id: saved.id, spaceId, typeId: saved.typeId, updatedAt: saved.updatedAt })
          } finally {
            this.writing.delete(saved.id)
          }
        }
        this.progress.set(spaceId, { done: this.progress.get(spaceId)!.done + 1, total })
        // One day at a time, with a short pause even on fast local servers.
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      for (const habit of habits) signatures[habit.id] = this.signature(habit)
      this.options.store.db.prepare('UPDATE sparkyfitness_connections SET synced_at=?, error=NULL, signatures=?, workouts=? WHERE space_id=? AND api_key=? AND base_url=?').run(now(), JSON.stringify(signatures), JSON.stringify(workouts), spaceId, row.api_key, row.base_url)
    } catch (error) {
      if (this.generation.get(spaceId) !== generation) return
      // Never persist upstream bodies, URLs or arbitrary fetch errors: they may contain credentials.
      const message = safeError(error)
      store.db.prepare('UPDATE sparkyfitness_connections SET error=? WHERE space_id=?').run(message, spaceId)
    }
  }
}
