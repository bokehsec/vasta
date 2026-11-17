import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.ts', () => ({ authApi: { updateProfile: async () => ({}) }, NetworkError: class extends Error {} }))

afterEach(() => vi.unstubAllGlobals())

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

async function load(storage = fakeStorage()) {
  vi.resetModules()
  vi.stubGlobal('localStorage', storage)
  const menu = await import('./phone-menu.ts')
  const preferences = await import('./preferences.ts')
  return { ...menu, ...preferences, storage }
}

describe('phone menu preferences', () => {
  it('recovers from invalid storage and limits unique, recognised choices to five', async () => {
    const { normalizePhoneMenu, DEFAULT_PHONE_MENU } = await load()
    for (const value of [null, {}, [], ['broken', 1]]) expect(normalizePhoneMenu(value)).toEqual(DEFAULT_PHONE_MENU)
    expect(normalizePhoneMenu(['search', 'type:book', 'search', false, 'settings', 'today', 'home', 'calendar'])).toEqual(['search', 'type:book', 'settings', 'today', 'home'])
    expect(normalizePhoneMenu(['type:'])).toEqual(DEFAULT_PHONE_MENU)
    expect(normalizePhoneMenu(['menu', 'home'])).toEqual(['menu', 'home'])
  })

  it('is the account\'s: the same for everyone reading it, kept apart per person, and sent to the server', async () => {
    const { usePhoneMenu, DEFAULT_PHONE_MENU, startPreferences, stopPreferences, flush } = await load()
    startPreferences({ id: 'user-a' })
    const menu = usePhoneMenu()
    const otherReader = usePhoneMenu()
    expect(otherReader.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['today', 'search', 'type:book']
    expect(otherReader.value).toEqual(['today', 'search', 'type:book'])
    await flush()
    stopPreferences()
    startPreferences({ id: 'user-b' })
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    // Another device of user-a gets what the server has.
    stopPreferences()
    startPreferences({ id: 'user-a', preferences: { 'phone-menu': ['settings'] } })
    expect(menu.value).toEqual(['settings'])
  })

  it('reads the choice an older build kept on this device', async () => {
    const { usePhoneMenu, startPreferences, storage } = await load(fakeStorage({ 'vasta.phone-menu:user-a': '["today","search"]', 'vasta.phone-menu:user-b': '["home"]' }))
    startPreferences({ id: 'user-a' })
    expect(usePhoneMenu().value).toEqual(['today', 'search'])
    expect(storage.data.has('vasta.phone-menu:user-a')).toBe(false)
    expect(storage.data.has('vasta.phone-menu:user-b')).toBe(true)
  })

  it('shows the default for damaged data and waits for an account before saving', async () => {
    const { usePhoneMenu, DEFAULT_PHONE_MENU, startPreferences } = await load(fakeStorage({ 'vasta.phone-menu:broken': '{invalid' }))
    const menu = usePhoneMenu()
    menu.value = ['today']
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    startPreferences({ id: 'broken', preferences: { 'phone-menu': 'nonsense' } })
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['today']
    expect(menu.value).toEqual(['today'])
  })
})
