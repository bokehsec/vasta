<script setup lang="ts">
// Review's Waiting… question: the task waits on someone, so when to check back (a week unless
// changed: Tomorrow, In 3 days, In a week, In 2 weeks, or any day on the calendar) and a line to
// remember it by (a div, not a form: the calendar's day buttons would submit one). Wait (or Enter in the note) hands the day and the note to the review; Cancel, Escape or a tap
// outside close it with nothing changed. Under the button pressed; on a phone a sheet from the bottom.
import { computed, nextTick, onMounted, ref, type Component } from 'vue'
import { addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
import { longDay } from '../lib/quick-actions.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'
import PopoverMenu from './PopoverMenu.vue'
import MiniMonth from './calendar/MiniMonth.vue'

const props = defineProps<{ anchor: HTMLElement | null; scope?: string }>()
const emit = defineEmits<{ submit: [day: string, note: string]; close: [] }>()

const PRESETS = [{ label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'In a week', days: 7 }, { label: 'In 2 weeks', days: 14 }]
const today = dayKey()
const picked = ref(addDays(today, 7))
const calendar = ref(false)
const note = ref('')
const noteInput = ref<HTMLInputElement | null>(null)
onMounted(async () => {
  await nextTick()
  noteInput.value?.focus({ preventScroll: true })
})

const anchored = computed(() => !!props.anchor && !isPhone.value)
const frame = computed<Component>(() => (anchored.value ? PopoverMenu : BottomSheet))
const frameProps = computed<Record<string, unknown>>(() => (anchored.value ? { open: true, anchor: props.anchor, placement: 'bottom-start', width: '19rem', label: 'Waiting', 'onUpdate:open': (value: boolean) => !value && emit('close') } : { label: 'Waiting', desktop: 'center', width: '22rem', 'data-waiting-sheet': '', onClose: () => emit('close') }))
const submit = () => emit('submit', picked.value, note.value.trim())
const preset = (days: number) => {
  picked.value = addDays(today, days)
  calendar.value = false
}
const presetClass = (days: number) => ['min-w-0 flex-1 rounded-lg px-2 py-1.5 max-md:py-3 max-md:text-base', picked.value === addDays(today, days) && !calendar.value ? 'bg-ink text-surface' : 'bg-hover hover:bg-line']
</script>

<template>
  <component :is="frame" v-bind="frameProps">
    <div class="space-y-3 p-2 text-sm" data-waiting-ask>
      <p class="font-medium max-md:text-base" data-waiting-title>Waiting — check back on</p>
      <p v-if="scope" class="line-clamp-2 text-xs text-ink-soft max-md:text-sm">{{ scope }}</p>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Check back on">
        <button v-for="p in PRESETS" :key="p.days" type="button" :class="[presetClass(p.days), 'basis-[7rem]']" :aria-pressed="picked === addDays(today, p.days) && !calendar" :data-waiting-preset="p.days" @click="preset(p.days)">{{ p.label }}</button>
      </div>
      <button type="button" class="flex min-h-8 items-center gap-1.5 rounded-md px-1 text-ink-soft hover:text-ink max-md:min-h-11" :aria-expanded="calendar" data-waiting-calendar @click="calendar = !calendar">
        <AppIcon fallback="ph:calendar-blank" :size="16" />Another day…
      </button>
      <MiniMonth v-if="calendar" :selected="picked" @pick="picked = $event" />
      <!-- The day and the note stay together just above Cancel and Wait, the calendar open or not. -->
      <div class="sticky bottom-0 -mx-2 space-y-3 bg-surface px-2 pt-2">
        <p class="font-medium" data-waiting-day>Check back: {{ longDay(picked) }}</p>
        <label class="block space-y-1">
          <span class="text-xs text-ink-faint max-md:text-sm">Note (optional)</span>
          <input ref="noteInput" v-model="note" type="text" enterkeyhint="done" class="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong max-md:py-2.5 max-md:text-base" placeholder="What you're waiting for — e.g. emailed Sam for the documents" data-waiting-note @keydown.enter.prevent="submit" />
        </label>
        <div class="flex gap-2">
          <button type="button" :class="[greyButton, 'flex-1']" data-waiting-cancel @click="emit('close')">Cancel</button>
          <button type="button" :class="[mainButton, 'flex-1']" data-waiting-save @click="submit">Wait</button>
        </div>
      </div>
    </div>
  </component>
</template>
