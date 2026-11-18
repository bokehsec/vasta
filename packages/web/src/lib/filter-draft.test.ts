import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useFilterDraft } from './filter-draft.ts'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})
function editor(value = 'gamma') {
  const source = ref({ value })
  const scope = effectScope()
  scopes.push(scope)
  const draft = scope.run(() => useFilterDraft(() => source.value.value))!
  return { source, draft }
}

describe('filter input drafts', () => {
  it('keeps uncommitted typing through both a save echo and a changed incoming filter', async () => {
    const { source, draft } = editor()
    draft.focus()
    draft.input('beta')
    source.value = { value: 'gamma' }
    await nextTick()
    expect(draft.value).toBe('beta')
    source.value = { value: 'elsewhere' }
    await nextTick()
    expect(draft.value).toBe('beta')
    source.value = { value: draft.value }
    draft.commit()
    await draft.blur()
    expect(source.value.value).toBe('beta')
    expect(draft.value).toBe('beta')
  })

  it('defers remote changes while focused, then shows the latest on blur', async () => {
    const { source, draft } = editor()
    draft.focus()
    for (const value of ['first', 'latest']) {
      source.value = { value }
      await nextTick()
      expect(draft.value).toBe('gamma')
    }
    await draft.blur()
    expect(draft.value).toBe('latest')
  })

  it('keeps an uncommitted value even after focus leaves', async () => {
    const { source, draft } = editor()
    draft.input('unfinished')
    await draft.blur()
    source.value = { value: 'elsewhere' }
    await nextTick()
    expect(draft.value).toBe('unfinished')
  })

  it('shows incoming changes immediately when idle', async () => {
    const { source, draft } = editor()
    source.value = { value: 'elsewhere' }
    await nextTick()
    expect(draft.value).toBe('elsewhere')
  })

  it('waits for committed props before ending the edit, including number normalization', async () => {
    const { source, draft } = editor('0')
    draft.focus()
    draft.input('02')
    draft.commit()
    const blurred = draft.blur()
    source.value = { value: '2' }
    await blurred
    expect(draft.value).toBe('2')
  })

  it('does not replace a new edit started before blur finishes', async () => {
    const { draft } = editor()
    const blurred = draft.blur()
    draft.focus()
    draft.input('new edit')
    await blurred
    expect(draft.value).toBe('new edit')
  })
})
