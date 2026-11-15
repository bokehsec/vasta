import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

afterEach(() => vi.unstubAllGlobals())

async function load(data = new Map<string, string>()) {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  })
  return import('./phone-menu.ts')
}

describe('phone menu preferences', () => {
  it('recovers from invalid storage and limits unique, recognised choices to five', async () => {
    const { normalizePhoneMenu, DEFAULT_PHONE_MENU } = await load()
    for (const value of [null, {}, [], ['broken', 1]]) expect(normalizePhoneMenu(value)).toEqual(DEFAULT_PHONE_MENU)
    expect(normalizePhoneMenu(['search', 'type:book', 'search', false, 'settings', 'today', 'home', 'calendar'])).toEqual(['search', 'type:book', 'settings', 'today', 'home'])
    expect(normalizePhoneMenu(['type:'])).toEqual(DEFAULT_PHONE_MENU)
  })

  it('saves order, reloads it, and keeps accounts/spaces separate', async () => {
    const data = new Map<string, string>()
    const { usePhoneMenu, DEFAULT_PHONE_MENU } = await load(data)
    const scope = ref('user-a:space-a')
    const menu = usePhoneMenu(scope)
    const otherReader = usePhoneMenu('user-a:space-a')
    expect(otherReader.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['today', 'search', 'type:book']
    expect(otherReader.value).toEqual(menu.value)
    scope.value = 'user-a:space-b'
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['settings']
    scope.value = 'user-b:space-a'
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    const reloaded = await load(data)
    expect(reloaded.usePhoneMenu('user-a:space-a').value).toEqual(['today', 'search', 'type:book'])
    expect(reloaded.usePhoneMenu('user-a:space-b').value).toEqual(['settings'])
  })

  it('works for the current session when storage is denied or damaged', async () => {
    const { usePhoneMenu, DEFAULT_PHONE_MENU } = await load(new Map([['vasta.phone-menu:broken', '{invalid']]))
    expect(usePhoneMenu('broken').value).toEqual(DEFAULT_PHONE_MENU)
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    const menu = usePhoneMenu('denied')
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['search']
    expect(menu.value).toEqual(['search'])
  })

  it('waits for an account and space before reading or saving preferences', async () => {
    const data = new Map<string, string>()
    const { usePhoneMenu, DEFAULT_PHONE_MENU } = await load(data)
    const scope = ref('')
    const menu = usePhoneMenu(scope)
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['today']
    expect(data.size).toBe(0)
    scope.value = 'ready'
    expect(menu.value).toEqual(DEFAULT_PHONE_MENU)
    menu.value = ['today']
    expect(data.size).toBe(1)
  })
})
