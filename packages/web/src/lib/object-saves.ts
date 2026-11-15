import type { ObjectRecord } from '@vasta/core'

export interface ObjectSaveObserver {
  saved?: (object: ObjectRecord) => void
  failed?: (retry: () => Promise<ObjectRecord>) => void
}

const listeners = new Set<(object: ObjectRecord, base?: ObjectRecord) => ObjectSaveObserver | undefined>()

export function onObjectSave(listener: (object: ObjectRecord, base?: ObjectRecord) => ObjectSaveObserver | undefined) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function observeObjectSave(object: ObjectRecord, base: ObjectRecord | undefined, save: () => Promise<ObjectRecord>): Promise<ObjectRecord> {
  const observers = [...listeners].flatMap((listener) => listener(object, base) ?? [])
  try {
    const saved = await save()
    for (const observer of observers) observer.saved?.(saved)
    return saved
  } catch (error) {
    for (const observer of observers) observer.failed?.(() => observeObjectSave(object, base, save))
    throw error
  }
}
