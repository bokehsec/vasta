import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { foldKey, useGroupFolds } from './group-folds.ts'
import { flush, getPreference, startPreferences, stopPreferences } from './preferences.ts'

vi.mock('./api.ts', () => ({ authApi: { updateProfile: async () => ({}) }, NetworkError: class extends Error {} }))

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
  })
  startPreferences({ id: 'a' })
})
afterEach(() => {
  stopPreferences()
  vi.unstubAllGlobals()
})

describe('personal group folds', () => {
  it('remembers folds while keeping views, embeds and grouping fields independent', () => {
    const scope = effectScope()
    scope.run(() => {
      const context = ref(['type/t/view/v1', 'status'])
      const key = () => foldKey('folds', context.value[0], context.value[1]!)
      const folds = useGroupFolds(key)
      expect(folds.folded.value.size).toBe(0)
      folds.toggle('next')
      expect(getPreference('account', 'type/t/view/v1/folds/status')).toEqual(['next'])
      for (const other of [['type/t/view/v2', 'status'], ['type/t/view/v1', 'priority'], ['object/p/embed/i/o', 'status']]) {
        context.value = other
        expect(folds.folded.value.size).toBe(0)
        // Reading another context never overwrites the first one's choices.
        expect(getPreference('account', 'type/t/view/v1/folds/status')).toEqual(['next'])
      }
      context.value = ['type/t/view/v1', 'status']
      expect(folds.folded.value.has('next')).toBe(true)
      expect(useGroupFolds(key).folded.value.has('next')).toBe(true)
      folds.collapseAll(['waiting', '__none'])
      expect([...folds.folded.value]).toEqual(['next', 'waiting', '__none'])
      folds.expandAll()
      expect(folds.folded.value.size).toBe(0)
    })
    scope.stop()
  })

  it('belongs to the account: another account does not see them, and the same one does anywhere', async () => {
    const key = () => foldKey('folds', 'type/t/view/v1', 'status')
    const folds = useGroupFolds(key)
    folds.toggle('next')
    await flush()
    stopPreferences()
    startPreferences({ id: 'b' })
    expect(folds.folded.value.size).toBe(0)
    stopPreferences()
    startPreferences({ id: 'a', preferences: { 'type/t/view/v1/folds/status': ['next', 'later'] } })
    expect([...folds.folded.value]).toEqual(['next', 'later'])
  })

  it('ignores damaged values', () => {
    startPreferences({ id: 'a', preferences: { broken: '{}', mixed: ['next', 1, null, 'next'] } })
    const scope = effectScope()
    scope.run(() => {
      expect([...useGroupFolds(() => 'broken').folded.value]).toEqual([])
      expect([...useGroupFolds(() => 'mixed').folded.value]).toEqual(['next'])
    })
    scope.stop()
  })

  it('starts from the view\'s own value (a board\'s collapsed columns) until the person folds one', () => {
    const scope = effectScope()
    scope.run(() => {
      const folds = useGroupFolds(() => foldKey('columns', 'type/t/view/v1', 'status'), () => ['done'])
      expect([...folds.folded.value]).toEqual(['done'])
      folds.toggle('next')
      expect([...folds.folded.value]).toEqual(['done', 'next'])
      folds.toggle('done')
      folds.toggle('next')
      // Everything unfolded is a choice too: the view's starting value does not come back.
      expect(folds.folded.value.size).toBe(0)
      expect(getPreference('account', 'type/t/view/v1/columns/status')).toEqual([])
    })
    scope.stop()
  })

  it('does not share unidentified instances or save until all identity parts are known', () => {
    for (const [scopeId, field] of [['', 'status'], ['type/t/view/v1', '']] as const) expect(foldKey('folds', scopeId, field)).toBeUndefined()
    const scope = effectScope()
    scope.run(() => {
      const one = useGroupFolds(() => undefined)
      const two = useGroupFolds(() => undefined)
      one.toggle('next')
      expect(one.folded.value.has('next')).toBe(true)
      expect(two.folded.value.size).toBe(0)
    })
    scope.stop()
  })
})
