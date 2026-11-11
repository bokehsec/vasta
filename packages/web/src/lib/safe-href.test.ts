import { describe, expect, it } from 'vitest'
import { safeHref } from './safe-href.ts'

describe('safeHref', () => {
  it('allows web, mail and Apple Mail links', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:a@b.c', 'message://%3Cabc123@mail.example.com%3E']) expect(safeHref(href)).toBe(href)
  })

  it('rejects other schemes', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', ' message://x', 'xmessage://x', 'file:///etc/passwd']) expect(safeHref(href)).toBeUndefined()
  })
})
