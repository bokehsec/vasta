// Personal display choices, like the phone menu: this account and device only. An unidentified
// legacy embed keeps its folds for its mounted instance rather than sharing another's choices.
import { ref, watch } from 'vue'

export function groupFoldKey(user: string | undefined, space: string | undefined, scope: string | undefined, field: string): string | undefined {
  return user && space && scope && field ? `vasta.group-folds:${JSON.stringify([user, space, scope, field])}` : undefined
}

export function useGroupFolds(key: () => string | undefined) {
  const folded = ref(new Set<string>())
  watch(key, (id) => {
    let value: unknown
    try { value = id ? JSON.parse(localStorage.getItem(id) ?? 'null') : undefined } catch {}
    folded.value = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  }, { immediate: true, flush: 'sync' })

  function save(next: Set<string>) {
    folded.value = next
    const id = key()
    if (!id) return
    try {
      if (next.size) localStorage.setItem(id, JSON.stringify([...next]))
      else localStorage.removeItem(id)
    } catch {}
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
