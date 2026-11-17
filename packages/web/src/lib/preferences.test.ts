import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updateProfile } = vi.hoisted(() => ({ updateProfile: vi.fn<(changes: { preferences?: Record<string, unknown> }) => Promise<unknown>>() }))
vi.mock('./api.ts', () => {
  class NetworkError extends Error {}
  return { authApi: { updateProfile }, NetworkError }
})

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    data,
  }
}

/** A fresh copy of the module over `storage`, as a page load would see it. */
async function load(storage = fakeStorage()) {
  vi.resetModules()
  vi.stubGlobal('localStorage', storage)
  const module = await import('./preferences.ts')
  const api = await import('./api.ts')
  return { ...module, storage, NetworkError: api.NetworkError as new () => Error }
}

beforeEach(() => updateProfile.mockReset().mockResolvedValue({}))
afterEach(() => vi.unstubAllGlobals())

describe('device preferences', () => {
  it('are stored on this device for the person logged in, and not shared with another account', async () => {
    const { preference, startPreferences, stopPreferences, storage } = await load()
    const width = preference<string>('page-width', 'standard', { scope: 'device' })
    // Nobody is logged in: the default shows and nothing is written.
    width.value = 'wide'
    expect(width.value).toBe('standard')
    expect(storage.data.size).toBe(0)
    startPreferences({ id: 'u1' })
    width.value = 'wide'
    expect(width.value).toBe('wide')
    expect(JSON.parse(storage.data.get('vasta.device.u1.page-width')!)).toBe('wide')
    stopPreferences()
    startPreferences({ id: 'u2' })
    expect(width.value).toBe('standard')
    stopPreferences()
    startPreferences({ id: 'u1' })
    expect(width.value).toBe('wide')
  })

  it('read a damaged value as the default, and keep working when storage is denied', async () => {
    const { preference, startPreferences } = await load(fakeStorage({ 'vasta.device.u1.page-width': '{bad' }))
    startPreferences({ id: 'u1' })
    const width = preference<string>('page-width', 'standard', { scope: 'device', parse: (value) => (value === 'wide' ? value : undefined) })
    expect(width.value).toBe('standard')
    const denied = () => { throw new Error('denied') }
    const second = await load({ getItem: denied, setItem: denied, removeItem: denied, length: 0, key: () => null } as unknown as ReturnType<typeof fakeStorage>)
    second.startPreferences({ id: 'u1' })
    const other = second.preference<string>('page-width', 'standard', { scope: 'device' })
    other.value = 'full'
    expect(other.value).toBe('full')
  })
})

describe('browser preferences', () => {
  it('are there before anyone has logged in and the same for every account', async () => {
    const { preference, startPreferences, storage } = await load()
    const theme = preference<string>('theme', 'system', { scope: 'browser' })
    theme.value = 'dark'
    expect(storage.data.get('vasta.browser.theme')).toBe('"dark"')
    startPreferences({ id: 'u1' })
    expect(theme.value).toBe('dark')
  })
})

describe('account preferences', () => {
  it('start as the server has them, and send only what changes', async () => {
    const { preference, startPreferences, flush } = await load()
    startPreferences({ id: 'u1', preferences: { 'type/t/mine': true, 'phone-menu': ['home'] } })
    const mine = preference<boolean>('type/t/mine', false, { scope: 'account' })
    expect(mine.value).toBe(true)
    mine.value = false
    expect(mine.value).toBe(false)
    const lastView = preference<string>(() => 'type/t/last-view', '', { scope: 'account' })
    lastView.value = 'v1'
    await flush()
    expect(updateProfile).toHaveBeenCalledTimes(1)
    expect(updateProfile).toHaveBeenCalledWith({ preferences: { 'type/t/mine': false, 'type/t/last-view': 'v1' } })
  })

  it('a key that is not known yet (a view still loading) reads the default and writes nothing', async () => {
    const { preference, startPreferences, flush } = await load()
    startPreferences({ id: 'u1' })
    const key = { value: undefined as string | undefined }
    const folds = preference<string[]>(() => key.value, [], { scope: 'account' })
    folds.value = ['a']
    await flush()
    expect(updateProfile).not.toHaveBeenCalled()
    expect(folds.value).toEqual([])
  })

  it('is kept and sent later when the server cannot be reached, also across a reload', async () => {
    const first = await load()
    const { NetworkError } = first
    updateProfile.mockRejectedValueOnce(new NetworkError())
    first.startPreferences({ id: 'u1', preferences: { a: 1 } })
    const mine = first.preference<boolean>('type/t/mine', false, { scope: 'account' })
    mine.value = true
    await first.flush()
    expect(mine.value).toBe(true)
    expect(JSON.parse(first.storage.data.get('vasta.account.u1')!).pending).toEqual({ 'type/t/mine': true })

    // The page reloads while still offline: the server's older copy lacks the change, the cache has it.
    const second = await load(first.storage)
    updateProfile.mockResolvedValue({})
    second.startPreferences({ id: 'u1', preferences: { a: 1 } })
    const again = second.preference<boolean>('type/t/mine', false, { scope: 'account' })
    expect(again.value).toBe(true)
    await vi.waitFor(() => expect(updateProfile).toHaveBeenLastCalledWith({ preferences: { 'type/t/mine': true } }))
    await second.flush()
    expect(JSON.parse(second.storage.data.get('vasta.account.u1')!).pending).toEqual({})
  })

  it('removing a value sends null so the server drops it', async () => {
    const { preference, startPreferences, flush } = await load()
    startPreferences({ id: 'u1', preferences: { 'tips/hidden': true } })
    const hidden = preference<boolean>('tips/hidden', false, { scope: 'account' })
    hidden.value = undefined as unknown as boolean
    expect(hidden.value).toBe(false)
    await flush()
    expect(updateProfile).toHaveBeenCalledWith({ preferences: { 'tips/hidden': null } })
  })

  it('does not carry one account to the next on the same device', async () => {
    const { preference, startPreferences, stopPreferences } = await load()
    startPreferences({ id: 'u1', preferences: { 'tips/hidden': true } })
    const hidden = preference<boolean>('tips/hidden', false, { scope: 'account' })
    expect(hidden.value).toBe(true)
    stopPreferences()
    expect(hidden.value).toBe(false)
    startPreferences({ id: 'u2' })
    expect(hidden.value).toBe(false)
  })
})

describe('dropping what belongs to a deleted view', () => {
  it('removes every preference under the prefix, in every scope, and nothing else', async () => {
    const { dropPreferences, getPreference, setPreference, startPreferences, flush } = await load()
    startPreferences({ id: 'u1', preferences: { 'type/t/view/v/folds/status': ['a'], 'type/t/view/v/phone-table': true, 'type/t/view/w/phone-table': true, 'type/t/mine': true } })
    setPreference('device', 'type/t/view/v/scratch', 1)
    setPreference('device', 'type/t/view/w/scratch', 2)
    dropPreferences('type/t/view/v/')
    expect(getPreference('account', 'type/t/view/v/folds/status')).toBeUndefined()
    expect(getPreference('account', 'type/t/view/v/phone-table')).toBeUndefined()
    expect(getPreference('device', 'type/t/view/v/scratch')).toBeUndefined()
    expect(getPreference('account', 'type/t/view/w/phone-table')).toBe(true)
    expect(getPreference('device', 'type/t/view/w/scratch')).toBe(2)
    expect(getPreference('account', 'type/t/mine')).toBe(true)
    await flush()
    expect(updateProfile).toHaveBeenCalledWith({ preferences: { 'type/t/view/v/folds/status': null, 'type/t/view/v/phone-table': null } })
  })
})

describe('moving the old localStorage keys', () => {
  const legacy = {
    'vasta.theme': 'dark',
    'vasta.page-width': 'wide',
    'vasta.sidebar-collapsed': '1',
    'vasta.view.t1': 'v2',
    'vasta.mine.t1': '1',
    'vasta.phoneTable.t1.v1': '1',
    'vasta.phone-menu:u1': '["home","tasks"]',
    'vasta.phone-menu:u2': '["search"]',
    'vasta.group-folds:["u1","s1","[\\"type\\",\\"t1\\",\\"v1\\"]","status"]': '["done"]',
    'vasta.group-folds:["u2","s1","[\\"type\\",\\"t1\\",\\"v1\\"]","status"]': '["other"]',
    'vasta.capture-draft.u1.s1': 'half a thought',
    'vasta.capture-draft.u2.s1': 'not yours',
    'vasta.tips.hidden': '1',
    'vasta.nutrition-range': '90',
    'vasta.calendar.view': 'week',
    'vasta.calendar.hidden': '["src"]',
    'vasta.replica': 'off',
    'vasta.review': '{"x":1}',
    'unrelated': 'keep',
  }

  it('converts them to preferences once the browser or the account starts, and removes them', async () => {
    const { getPreference, startPreferences, flush, storage } = await load(fakeStorage(legacy))
    // The browser's own keys moved when the module was first read, before anyone logged in.
    expect(getPreference('browser', 'theme')).toBe('dark')
    expect(storage.data.has('vasta.theme')).toBe(false)
    expect(storage.data.has('vasta.page-width')).toBe(true)
    startPreferences({ id: 'u1' })
    expect(getPreference('device', 'page-width')).toBe('wide')
    expect(getPreference('device', 'sidebar-collapsed')).toBe(true)
    expect(getPreference('device', 'capture-draft/s1')).toBe('half a thought')
    expect(getPreference('account', 'type/t1/last-view')).toBe('v2')
    expect(getPreference('account', 'type/t1/mine')).toBe(true)
    expect(getPreference('account', 'type/t1/view/v1/phone-table')).toBe(true)
    expect(getPreference('account', 'phone-menu')).toEqual(['home', 'tasks'])
    expect(getPreference('account', 'type/t1/view/v1/folds/status')).toEqual(['done'])
    expect(getPreference('account', 'tips/hidden')).toBe(true)
    expect(getPreference('account', 'nutrition/range')).toBe(90)
    expect(getPreference('account', 'calendar/view')).toBe('week')
    expect(getPreference('account', 'calendar/hidden')).toEqual(['src'])
    await flush()
    // What moved to the account is on its way to the server.
    expect(updateProfile.mock.calls[0]![0].preferences).toMatchObject({ 'type/t1/mine': true, 'phone-menu': ['home', 'tasks'], 'type/t1/view/v1/folds/status': ['done'] })
    // Only the migrated keys are gone: another account's, the technical switches and strangers stay.
    expect([...storage.data.keys()].filter((key) => !key.startsWith('vasta.device.') && !key.startsWith('vasta.account.') && !key.startsWith('vasta.browser.')).sort()).toEqual([
      'unrelated', 'vasta.capture-draft.u2.s1', 'vasta.group-folds:["u2","s1","[\\"type\\",\\"t1\\",\\"v1\\"]","status"]', 'vasta.phone-menu:u2', 'vasta.replica', 'vasta.review',
    ])
  })

  it('leaves a value already set alone', async () => {
    const { getPreference, startPreferences } = await load(fakeStorage({ 'vasta.device.u1.page-width': '"full"', 'vasta.page-width': 'wide' }))
    startPreferences({ id: 'u1', preferences: { 'phone-menu': ['search'] } })
    expect(getPreference('device', 'page-width')).toBe('full')
    expect(getPreference('account', 'phone-menu')).toEqual(['search'])
  })
})
