<script setup lang="ts">
// The question a quick action asks before it runs (lib/quick-actions.ts, QuickAskForm): under the
// element pressed; centred over a dimmed page when there is none (a menu); on a phone a sheet from
// the bottom, where the thumb is.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { quickAsk } from '../lib/quick-actions.ts'
import { isPhone, keyboardInset, sheetMaxHeight } from '../lib/viewport.ts'
import PopoverMenu from './PopoverMenu.vue'
import QuickAskForm from './QuickAskForm.vue'

const anchored = computed(() => !!quickAsk.value?.anchor && !isPhone.value)
const open = computed({ get: () => !!quickAsk.value, set: (value) => !value && quickAsk.value?.answer(null) })
const isDate = computed(() => quickAsk.value?.def.kind === 'date')

// Escape closes the centred box wherever the focus is (the popover closes itself).
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !quickAsk.value || anchored.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <PopoverMenu v-if="quickAsk && anchored" v-model:open="open" :anchor="quickAsk.anchor" :placement="isDate ? 'bottom-start' : 'bottom-end'" :width="isDate ? '17rem' : '20rem'">
    <QuickAskForm :key="quickAsk.id" :ask="quickAsk" />
  </PopoverMenu>
  <Teleport v-else-if="quickAsk" to="body">
    <div class="fixed inset-0 z-50 grid bg-black/30" :class="isPhone ? 'items-end' : 'place-items-center p-4'" data-overlay @click.self="open = false">
      <div
        class="w-full border border-line bg-surface p-1 shadow-xl shadow-black/10"
        :class="isPhone ? 'overflow-y-auto rounded-t-2xl border-b-0 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2' : 'rounded-xl'"
        :style="isPhone ? { marginBottom: `${keyboardInset}px`, maxHeight: sheetMaxHeight } : { maxWidth: isDate ? '19rem' : '22rem' }"
        role="dialog"
        :aria-label="quickAsk.action.name"
        data-quick-ask-sheet
      >
        <div v-if="isPhone" class="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <p class="px-2 pt-1.5 font-medium" :class="isPhone ? 'text-base text-ink' : 'text-xs text-ink-faint'">{{ quickAsk.action.name }}</p>
        <QuickAskForm :key="quickAsk.id" :ask="quickAsk" />
      </div>
    </div>
  </Teleport>
</template>
