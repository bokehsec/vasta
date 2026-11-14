<script setup lang="ts">
// The inside of a quick action's question (QuickAskHost): a day (tomorrow, next week or one picked
// on a calendar, with the due date shown when it sets another date) or a line of text; an empty line
// clears the field.
import { computed, nextTick, onMounted, ref } from 'vue'
import { addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { nextWeekStart } from '../lib/calendar.ts'
import { longDay, textAnswer, type QuickAsk } from '../lib/quick-actions.ts'
import AppIcon from './AppIcon.vue'
import MiniMonth from './calendar/MiniMonth.vue'

const props = defineProps<{ ask: QuickAsk }>()

const text = ref(props.ask.text)
const textInput = ref<HTMLInputElement | null>(null)
onMounted(async () => {
  await nextTick()
  textInput.value?.select()
})

const tomorrow = computed(() => addDays(dayKey(), 1))
const nextWeek = computed(() => nextWeekStart())

const answerDay = (day: string) => props.ask.answer({ kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } })
const answerText = () => props.ask.answer(textAnswer(props.ask.def, text.value, props.ask.text, props.ask.action.changes.length === 1))
</script>

<template>
  <div v-if="ask.def.kind === 'date'" class="space-y-3 p-2 text-sm" data-defer-menu>
    <div class="flex gap-2">
      <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="answerDay(tomorrow)">Tomorrow</button>
      <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="answerDay(nextWeek)">Next week</button>
    </div>
    <MiniMonth :selected="ask.day" @pick="answerDay" />
    <p v-if="ask.due" class="flex items-center gap-1.5 text-xs text-ink-faint">
      <AppIcon fallback="ph:flag" :size="12" /> Due {{ longDay(ask.due) }}
    </p>
  </div>
  <form v-else class="p-2" data-next-step @submit.prevent="answerText">
    <label class="mb-1 block text-xs text-ink-faint" for="quick-ask-text">{{ ask.def.name }}</label>
    <input
      id="quick-ask-text"
      ref="textInput"
      v-model="text"
      :inputmode="ask.def.kind === 'number' ? 'decimal' : ask.def.kind === 'url' ? 'url' : 'text'"
      class="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong"
      :placeholder="ask.def.kind === 'text' ? 'What happens next' : ''"
      @keydown.escape.stop="ask.answer(null)"
    />
  </form>
</template>
