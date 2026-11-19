import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const arbitrarySizes = (source: string) => source.match(/\btext-\[(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)\]/g) ?? []
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(vue|ts)$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name))

// Heatmap labels must fit 11px cells; notification counts and calendar badges sit in tiny chips.
// Values count uses outside the import, so extra tiny text in these files also needs review.
const tinyAllowlist = new Map([
  ['components/HabitStats.vue', 1],
  ['components/NotificationBell.vue', 1],
  ['components/calendar/CalendarEntryItem.vue', 1],
])

describe('the UI type scale', () => {
  it('recognises arbitrary sizes, including responsive utilities', () => {
    const sizes = ['11px', '1.8rem', '.75rem'].map((size) => `text-[${size}]`)
    expect(arbitrarySizes(`${sizes[0]} md:${sizes[1]} max-md:${sizes[2]} text-sm text-ink-soft`)).toEqual(sizes)
  })

  it('keeps arbitrary font sizes in the named scale only', () => {
    const drift = files.flatMap((file) => {
      if (relative(root, file) === 'lib/type-scale.ts') return []
      return readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
        arbitrarySizes(line).map((size) => `${relative(root, file)}:${index + 1}: ${size}`)
      )
    })
    expect(drift, 'Use a named role from lib/type-scale.ts').toEqual([])
  })

  it('keeps the scale exceptions small and explicit', () => {
    // Page titles, the review sheet title, intentional phone controls, and dense-surface text.
    const allowed = ['1.8rem', '2.1rem', '1.4rem', '1.75rem', '15px', '15px', '10px']
    const scale = readFileSync(join(root, 'lib/type-scale.ts'), 'utf8')
    expect(arbitrarySizes(scale).sort()).toEqual(allowed.map((size) => `text-[${size}]`).sort())
  })

  it('limits tiny text to dense surfaces', () => {
    const uses = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      if (!/^import \{[^}]*\btinyText\b[^}]*\} from ['"][^'"]*\/type-scale\.ts['"]/m.test(source)) return []
      const withoutImport = source.replace(/^import .*type-scale\.ts['"]\n/gm, '')
      return [[relative(root, file), (withoutImport.match(/\btinyText\b/g) ?? []).length] as const]
    })
    expect(new Map(uses)).toEqual(tinyAllowlist)
  })
})
