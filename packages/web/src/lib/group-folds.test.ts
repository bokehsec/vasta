import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { groupFoldKey, useGroupFolds } from './group-folds.ts'

afterEach(() => vi.unstubAllGlobals())

function storage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
  return data
}

describe('personal group folds', () => {
  it('remembers folds while keeping accounts, spaces, views, embeds and grouping fields independent', () => {
    const data = storage()
    const scope = effectScope()
    scope.run(() => {
      const context = ref(['a', 'main', 'view-a', 'status'])
      const key = () => groupFoldKey(context.value[0], context.value[1], context.value[2], context.value[3]!)
      const folds = useGroupFolds(key)
      expect(folds.folded.value.size).toBe(0)
      folds.toggle('next')
      const savedKey = key()!
      expect(JSON.parse(data.get(savedKey)!)).toEqual(['next'])
      for (let index = 0; index < 4; index++) {
        const other = ['a', 'main', 'view-a', 'status']
        other[index] = 'other'
        context.value = other
        expect(folds.folded.value.size).toBe(0)
        // Loading another context must never overwrite the first one's choices.
        expect(JSON.parse(data.get(savedKey)!)).toEqual(['next'])
      }
      context.value = ['a', 'main', 'view-a', 'status']
      expect(folds.folded.value.has('next')).toBe(true)
      expect(useGroupFolds(key).folded.value.has('next')).toBe(true)
      folds.collapseAll(['waiting', '__none'])
      expect([...folds.folded.value]).toEqual(['next', 'waiting', '__none'])
      folds.expandAll()
      expect(data.has(savedKey)).toBe(false)
    })
    scope.stop()
  })

  it('recovers from damaged or unavailable storage and stays usable in memory', () => {
    const data = storage()
    const scope = effectScope()
    scope.run(() => {
      for (const value of ['{bad', '{}', 'null', '["next",1,null,"next"]']) {
        data.set('broken', value)
        const folds = useGroupFolds(() => 'broken')
        expect([...folds.folded.value]).toEqual(value.startsWith('[') ? ['next'] : [])
      }
      vi.stubGlobal('localStorage', {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
        removeItem: () => { throw new Error('denied') },
      })
      const folds = useGroupFolds(() => 'denied')
      folds.toggle('next')
      expect(folds.folded.value.has('next')).toBe(true)
      folds.expandAll()
      expect(folds.folded.value.size).toBe(0)
    })
    scope.stop()
  })

  it('does not share unidentified instances or save until all identity parts are known', () => {
    const data = storage()
    for (let i = 0; i < 4; i++) {
      const parts = ['user', 'space', 'view', 'field']
      parts[i] = ''
      expect(groupFoldKey(parts[0], parts[1], parts[2], parts[3]!)).toBeUndefined()
    }
    const scope = effectScope()
    scope.run(() => {
      const one = useGroupFolds(() => undefined)
      const two = useGroupFolds(() => undefined)
      one.toggle('next')
      expect(one.folded.value.has('next')).toBe(true)
      expect(two.folded.value.size).toBe(0)
      expect(data.size).toBe(0)
    })
    scope.stop()
  })
})
