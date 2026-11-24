// A comment typed in Review (the box under the task, or Waiting…'s comment) is saved in the same
// save as the decision it goes with, so one Undo takes both back: the first save of the decision
// carries the comment prop (`comment:<id>`), and what saves after it (Undo puts the old values back)
// removes it again. A save that failed carries nothing yet, so a retry still has it.
import type { Id, PropertyValue } from '@vasta/core'
import type { QuickSave } from './quick-actions.ts'

export function savingWithComment(save: QuickSave, key: Id, value: PropertyValue): QuickSave {
  let carried = false
  return async (id, values) => {
    if (carried) return save(id, { ...values, [key]: undefined })
    const saved = await save(id, { ...values, [key]: value })
    carried = true
    return saved
  }
}
