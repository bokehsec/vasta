// Which groups of a list and which columns and swimlanes of a board this person folded: their own choice, on every
// device of theirs (an account preference, lib/preferences.ts), never the view's. `scope` names the
// view or embedded query (`type/<id>/view/<id>`), so deleting it drops its folds. An embed without
// an identity keeps its folds for the instance that is mounted rather than sharing another's.
import { computed, ref } from 'vue'
import { preference } from './preferences.ts'

/** The preference holding the folds of `field`'s groups (`folds`) or of a board's columns (`columns`) or swimlanes (`lanes`) in `scope`; undefined until both are known. */
export function foldKey(kind: 'folds' | 'columns' | 'lanes', scope: string | undefined, field: string): string | undefined {
  return scope && field ? `${scope}/${kind}/${field}` : undefined
}

const parse = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined)

/** `starting`: what is folded until the person folds or unfolds something (a board's saved `collapsed`). */
export function useGroupFolds(key: () => string | undefined, starting?: () => string[] | undefined) {
  const stored = preference<string[] | undefined>(key, undefined, { scope: 'account', parse })
  const local = ref<string[]>()
  const folded = computed(() => new Set((key() ? stored.value : local.value) ?? starting?.() ?? []))

  function save(next: Set<string>) {
    if (key()) stored.value = [...next]
    else local.value = [...next]
  }
  function toggle(group: string) {
    const next = new Set(folded.value)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    save(next)
  }
  function collapseAll(groups: string[]) { save(new Set([...folded.value, ...groups])) }
  function expandAll() { save(new Set()) }
  return { folded, toggle, collapseAll, expandAll }
}
