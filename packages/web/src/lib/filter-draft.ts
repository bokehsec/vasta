// Filter inputs commit on change. A type's save response or a live update must not replace what
// is being typed; once editing ends, show the latest value from the filter again.
import { nextTick, reactive, watch } from 'vue'

export function useFilterDraft(read: () => string) {
  const draft = reactive({
    value: read(),
    focused: false,
    dirty: false,
    focus() {
      draft.focused = true
    },
    input(value: string) {
      draft.value = value
      draft.dirty = true
    },
    commit() {
      draft.dirty = false
    },
    async blur() {
      draft.focused = false
      // The change event emits the filter before blur; let its props reach the row first.
      await nextTick()
      if (!draft.focused && !draft.dirty) draft.value = read()
    },
  })
  watch(read, (value) => {
    if (!draft.focused && !draft.dirty) draft.value = value
  })
  return draft
}
