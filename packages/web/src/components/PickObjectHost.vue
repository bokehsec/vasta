<script setup lang="ts">
// The box lib/pick.ts asks with: a title and a search over objects (ObjectPicker, nothing created),
// centred over a dimmed page, or a sheet from the bottom on a phone. Escape or a tap outside closes it.
import { onBeforeUnmount, onMounted } from 'vue'
import { pickRequest } from '../lib/pick.ts'
import { isPhone, keyboardInset } from '../lib/viewport.ts'
import ObjectPicker from './ObjectPicker.vue'

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !pickRequest.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  pickRequest.value.resolve(null)
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport v-if="pickRequest" to="body">
    <div class="fixed inset-0 z-50 grid bg-black/30" :class="isPhone ? 'items-end' : 'place-items-center p-4'" data-overlay @click.self="pickRequest.resolve(null)">
      <div
        class="w-full border border-line bg-surface p-2 shadow-xl shadow-black/10"
        :class="isPhone ? 'max-h-[80vh] overflow-y-auto rounded-t-2xl border-b-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'max-h-[70vh] max-w-sm overflow-y-auto rounded-xl'"
        :style="isPhone ? { marginBottom: `${keyboardInset}px` } : undefined"
        role="dialog"
        :aria-label="pickRequest.title"
        data-pick-object
      >
        <div v-if="isPhone" class="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <p class="px-1 pb-2 font-medium" :class="isPhone ? 'text-base' : 'text-sm'">{{ pickRequest.title }}</p>
        <ObjectPicker :type-ids="pickRequest.typeIds" :exclude="pickRequest.exclude" no-create @pick="pickRequest.resolve($event)" />
      </div>
    </div>
  </Teleport>
</template>
