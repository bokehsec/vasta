import { describe, expect, it } from 'vitest'
import { addComment, commentProp, commentsOf } from '../src/comments.ts'

describe('comments', () => {
  it('a comment as a prop is the one addComment writes, trimmed, and needs text', () => {
    const { key, value } = commentProp('u1', '  Called Sam  ', '2026-11-24T15:00:00.000Z', 'c1')
    expect(key).toBe('comment:c1')
    expect(value).toEqual({ kind: 'comment', value: { author: 'u1', at: '2026-11-24T15:00:00.000Z', text: 'Called Sam' } })
    const object = { props: {} }
    addComment(object, 'u1', 'Called Sam', '2026-11-24T15:00:00.000Z', 'c1')
    expect(object.props).toEqual({ [key]: { kind: 'comment', value: { author: 'u1', at: '2026-11-24T15:00:00.000Z', text: 'Called Sam' } } })
    expect(() => commentProp('u1', '   ', '2026-11-24T15:00:00.000Z')).toThrow('a comment needs text')
  })

  it('lists comments oldest first', () => {
    const object = { props: {} }
    addComment(object, 'u1', 'second', '2026-11-25T10:00:00.000Z', 'b')
    addComment(object, 'u1', 'first', '2026-11-24T10:00:00.000Z', 'a')
    expect(commentsOf(object).map((c) => c.text)).toEqual(['first', 'second'])
  })
})
