import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

vi.mock('./api.ts', () => ({ authApi: { updateProfile: async () => ({}) }, NetworkError: class extends Error {} }))

const key = 'vasta.device.u1.page-width'
function storage(value?: string) {
  const data = new Map(value === undefined ? [] : [[key, JSON.stringify(value)]])
  return {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, text: string) => { data.set(name, text) },
    removeItem: (name: string) => { data.delete(name) },
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    data,
  }
}
async function load(saved: unknown) {
  vi.resetModules()
  vi.stubGlobal('localStorage', saved)
  const module = await import('./page-width.ts')
  const { startPreferences } = await import('./preferences.ts')
  startPreferences({ id: 'u1' })
  return module
}
afterEach(() => vi.unstubAllGlobals())

describe('page width on this device', () => {
  it.each([undefined, '', 'broken', 'Wide'])('defaults to Standard for missing or invalid storage (%s)', async (value) => {
    const { pageWidth } = await load(storage(value))
    expect(pageWidth.value).toBe('standard')
  })

  it.each(['wide', 'full'] as const)('restores %s after a fresh load', async (value) => {
    const { pageWidth } = await load(storage(value))
    expect(pageWidth.value).toBe(value)
  })

  it('reads the width an older build kept, once', async () => {
    const saved = storage()
    saved.data.set('vasta.page-width', 'full')
    const { pageWidth } = await load(saved)
    expect(pageWidth.value).toBe('full')
    expect(saved.data.has('vasta.page-width')).toBe(false)
  })

  it('remembers changes on this device', async () => {
    const saved = storage()
    const { pageWidth, pageWidthClass } = await load(saved)
    const rendered = computed(() => pageWidthClass(false))
    expect(rendered.value).toBe('max-w-3xl')
    pageWidth.value = 'wide'
    expect(JSON.parse(saved.data.get(key)!)).toBe('wide')
    expect(rendered.value).toBe('max-w-6xl')
    pageWidth.value = 'full'
    expect(JSON.parse(saved.data.get(key)!)).toBe('full')
    expect(rendered.value).toBe('max-w-none')
    pageWidth.value = 'standard'
    expect(rendered.value).toBe('max-w-3xl')
  })

  it('starts at Standard when storage is unavailable and still lets this session change width', async () => {
    const denied = () => { throw new Error('storage denied') }
    const { pageWidth } = await load({ getItem: denied, setItem: denied, removeItem: denied, length: 0, key: () => null })
    expect(pageWidth.value).toBe('standard')
    pageWidth.value = 'full'
    expect(pageWidth.value).toBe('full')
  })
  it.each([
    ['standard', 'max-w-3xl', 'max-w-6xl'],
    ['wide', 'max-w-6xl', 'max-w-6xl'],
    ['full', 'max-w-none', 'max-w-none'],
  ] as const)('uses %s for prose and columns', async (value, prose, columns) => {
    const { pageWidth, pageWidthClass } = await load(storage())
    pageWidth.value = value
    expect(pageWidthClass(false)).toBe(prose)
    expect(pageWidthClass(true)).toBe(columns)
  })
})
