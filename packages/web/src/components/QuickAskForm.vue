<script setup lang="ts">
// The inside of a quick action's question (QuickAskHost): a day (tomorrow, next week or one picked
// on a calendar, with the due date shown when it sets another date, and a box to move the due date
// along when the day is after it) or a line of text; an empty line clears the field.
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

// "Move the due date too": on at first, since a task put off past its due date is otherwise left
// overdue; off keeps a real deadline where it is.
const moveDue = ref(true)
const answerDay = (day: string) => props.ask.answer({ kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } }, props.ask.dueMovable > 0 && moveDue.value)
const answerText = () => props.ask.answer(textAnswer(props.ask.def, text.value, props.ask.text, props.ask.action.changes.length === 1))
</script>

<template>
  <div v-if="ask.def.kind === 'date'" class="space-y-3 p-2 text-sm" data-defer-menu>
    <div class="flex gap-2">
      <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line max-md:py-3 max-md:text-base" @click="answerDay(tomorrow)">Tomorrow</button>
      <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line max-md:py-3 max-md:text-base" @click="answerDay(nextWeek)">Next week</button>
    </div>
    <MiniMonth :selected="ask.day" @pick="answerDay" />
    <p v-if="ask.due" class="flex items-center gap-1.5 text-xs text-ink-faint">
      <AppIcon fallback="ph:flag" :size="12" /> Due {{ longDay(ask.due) }}
    </p>
    <label v-if="ask.dueMovable" class="flex items-start gap-2 text-xs text-ink-soft max-md:min-h-11 max-md:items-center max-md:text-sm" data-move-due>
      <input v-model="moveDue" type="checkbox" class="mt-px shrink-0 accent-[var(--color-accent)] max-md:h-5 max-md:w-5" />
      <span>{{ ask.due ? 'Move the due date too, if the new day is after it' : 'Move due dates too, where the new day is after them' }}</span>
    </label>
  </div>
  <form v-else class="p-2" data-next-step @submit.prevent="answerText">
    <label class="mb-1 block text-xs text-ink-faint" for="quick-ask-text">{{ ask.def.name }}</label>
    <input
      id="quick-ask-text"
      ref="textInput"
      v-model="text"
      :inputmode="ask.def.kind === 'number' ? 'decimal' : ask.def.kind === 'url' ? 'url' : 'text'"
      class="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong max-md:py-2.5 max-md:text-base"
      :placeholder="ask.def.kind === 'text' ? 'What happens next' : ''"
      @keydown.escape.stop="ask.answer(null)"
    />
  </form>
</template>
