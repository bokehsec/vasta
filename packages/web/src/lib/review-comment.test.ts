import type { PropertyValue } from '@vasta/core'
import { describe, expect, it } from 'vitest'
import { savingWithComment } from './review-comment.ts'

const comment: PropertyValue = { kind: 'comment', value: { author: 'u', at: '2026-11-24T15:00:00.000Z', text: 'Called Sam' } }

describe('a comment saved with a decision', () => {
  it('rides on the first save and is removed again by the next one (Undo)', async () => {
    const saves: unknown[] = []
    const save = savingWithComment(async (id, values) => void saves.push([id, values]), 'comment:c1', comment)
    await save('t1', { status: { kind: 'select', value: ['done'] } })
    await save('t1', { status: { kind: 'select', value: ['next'] } })
    expect(saves).toEqual([
      ['t1', { status: { kind: 'select', value: ['done'] }, 'comment:c1': comment }],
      ['t1', { status: { kind: 'select', value: ['next'] }, 'comment:c1': undefined }],
    ])
  })

  it('a save that failed carries nothing yet: the retry has the comment', async () => {
    let fail = true
    const saves: unknown[] = []
    const save = savingWithComment(async (_id, values) => {
      if (fail) throw new Error('offline')
      saves.push(values)
    }, 'comment:c1', comment)
    await expect(save('t1', { a: undefined })).rejects.toThrow('offline')
    fail = false
    await save('t1', { a: undefined })
    expect(saves).toEqual([{ a: undefined, 'comment:c1': comment }])
  })
})
