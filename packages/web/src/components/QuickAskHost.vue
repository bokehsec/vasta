<script setup lang="ts">
// The question a quick action asks before it runs (lib/quick-actions.ts, QuickAskForm): under the
// element pressed; centred over a dimmed page when there is none (a menu); on a phone a sheet from
// the bottom, where the thumb is (BottomSheet). It closes by Cancel, Escape, Back or a tap outside,
// and only once saved (QuickAskForm shows Saving, and a failed save stays open to retry).
import { computed } from 'vue'
import { quickAsk } from '../lib/quick-actions.ts'
import { isPhone } from '../lib/viewport.ts'
import BottomSheet from './BottomSheet.vue'
import PopoverMenu from './PopoverMenu.vue'
import QuickAskForm from './QuickAskForm.vue'

const anchored = computed(() => !!quickAsk.value?.anchor && !isPhone.value)
const open = computed({ get: () => !!quickAsk.value, set: (value) => !value && quickAsk.value?.answer(null) })
const isDate = computed(() => quickAsk.value?.def.kind === 'date')
</script>

<template>
  <PopoverMenu v-if="quickAsk && anchored" v-model:open="open" :anchor="quickAsk.anchor" :placement="isDate ? 'bottom-start' : 'bottom-end'" :width="isDate ? '17rem' : '20rem'">
    <QuickAskForm :key="quickAsk.id" :ask="quickAsk" />
  </PopoverMenu>
  <BottomSheet
    v-else-if="quickAsk"
    :label="quickAsk.action.name"
    desktop="center"
    :width="isDate ? '19rem' : '22rem'"
    :aria-busy="quickAsk.state.saving || undefined"
    data-quick-ask-sheet
    @close="open = false"
  >
    <p class="px-2 pt-1.5 font-medium" :class="isPhone ? 'text-base text-ink' : 'text-xs text-ink-faint'">{{ quickAsk.action.name }}</p>
    <QuickAskForm :key="quickAsk.id" :ask="quickAsk" />
  </BottomSheet>
</template>
