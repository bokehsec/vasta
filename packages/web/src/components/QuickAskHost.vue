<script setup lang="ts">
// The question a quick action asks before it runs (lib/quick-actions.ts, QuickAskForm): under the
// element pressed, or centred over a dimmed page when there is none (a menu, a swipe) or on a phone.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { quickAsk } from '../lib/quick-actions.ts'
import { isPhone } from '../lib/viewport.ts'
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
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" data-overlay @click.self="open = false">
      <div class="w-full rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/10" :style="{ maxWidth: isDate ? '19rem' : '22rem' }" role="dialog" :aria-label="quickAsk.action.name">
        <p class="px-2 pt-1.5 text-xs font-medium text-ink-faint">{{ quickAsk.action.name }}</p>
        <QuickAskForm :key="quickAsk.id" :ask="quickAsk" />
      </div>
    </div>
  </Teleport>
</template>
