import { onScopeDispose, watch } from 'vue'
import type { NagView } from './api.ts'

export interface ReminderTask {
  id: string
  title: string
  typeId: string
  group: 'due' | 'planned'
  done: boolean
  movedTo?: string
  busy: boolean
  error: string
}

export function mergeReminderTasks(rows: ReminderTask[], view: Pick<NagView, 'tasks' | 'planned'>): ReminderTask[] {
  const next = [...rows]
  for (const group of ['due', 'planned'] as const) {
    for (const task of (group === 'due' ? view.tasks : view.planned) ?? []) {
      const existing = next.find((row) => row.id === task.id)
      if (existing) Object.assign(existing, { title: task.title, typeId: task.typeId })
      else next.push({ id: task.id, title: task.title, typeId: task.typeId, group, done: false, busy: false, error: '' })
    }
  }
  return next
}

export const allReminderTasksHandled = (rows: ReminderTask[]) => rows.length > 0 && rows.every((row) => !row.busy && !row.error && (row.done || !!row.movedTo))

export function useHandledReminderTasks(rows: () => ReminderTask[], enabled: () => boolean, answer: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempted = false
  const cancel = () => clearTimeout(timer)
  watch(
    () => [enabled(), allReminderTasksHandled(rows())] as const,
    ([active, handled]) => {
      cancel()
      if (!handled) attempted = false
      if (active && handled && !attempted) timer = setTimeout(() => {
        if (enabled() && allReminderTasksHandled(rows())) {
          attempted = true
          answer()
        }
      }, 1000)
    },
    { immediate: true, flush: 'sync' }
  )
  onScopeDispose(cancel)
}
