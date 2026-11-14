// Asking for one object from anywhere (a menu's "Make subtask of…"): PickObjectHost, mounted in
// App.vue, shows a search box over the page (a sheet from the bottom on a phone) and answers with
// the object picked, or null when closed.
import { shallowRef } from 'vue'
import type { Id, ObjectSummary } from '@vasta/core'

export interface PickRequest {
  title: string
  typeIds?: Id[]
  exclude?: Id[]
  resolve: (object: ObjectSummary | null) => void
}

export const pickRequest = shallowRef<PickRequest | null>(null)

export function pickObject(options: Omit<PickRequest, 'resolve'>): Promise<ObjectSummary | null> {
  pickRequest.value?.resolve(null)
  return new Promise((resolve) => {
    pickRequest.value = {
      ...options,
      resolve: (object) => {
        pickRequest.value = null
        resolve(object)
      },
    }
  })
}
