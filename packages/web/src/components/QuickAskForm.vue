<script setup lang="ts">
// The inside of a quick action's question (QuickAskHost): a day (tomorrow, next week or one picked
// on a calendar, which only select it: the day, and what it does to the due date, show before
// Save writes it, with a box to move the due date along when the day is after it) or a line of text
// (a number, a link); an empty line clears the field. Cancel and Save are always on screen. It stays
// open with what was typed or picked while saving, and when nothing could be saved says why and
// offers Retry.
import { computed, nextTick, onMounted, ref } from 'vue'
import { DUE_PROPERTY_ID, addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { nextWeekStart } from '../lib/calendar.ts'
import { longDay, textAnswer, textProblem, type QuickAsk } from '../lib/quick-actions.ts'
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

// The day picked, if any: the one the object has at first. Nothing is written until Save.
const picked = ref<string | undefined>(props.ask.day)
// "Move the due date too": on at first, since a task put off past its due date is otherwise left
// overdue; off keeps a real deadline where it is.
const moveDue = ref(true)

const saving = computed(() => props.ask.state.saving)
const failed = computed(() => props.ask.state.error)
const submitText = computed(() => (saving.value ? 'Saving…' : failed.value ? 'Retry' : props.ask.submitLabel))

// What the picked day does to the due dates, in words: always says where the due date ends up.
const dueLine = computed(() => {
  const { ask } = props
  const day = picked.value
  if (ask.def.id === DUE_PROPERTY_ID) return undefined
  if (ask.count > 1) {
    if (!day || !ask.dueMovable) return undefined
    const { count } = ask.dueMoves(day)
    if (!count) return 'No due dates change'
    return moveDue.value ? `${count} due ${count === 1 ? 'date moves' : 'dates move'} to ${longDay(day)}` : 'Due dates stay where they are'
  }
  if (!ask.due) return undefined
  const due = `Due ${longDay(ask.due)}`
  if (!day || day <= ask.due) return due
  const moves = ask.dueMoves(day)
  if (moves.to && moveDue.value) return `${due} → ${longDay(moves.to)}`
  if (!ask.dueMovable) return `${due} (repeats, so it stays)`
  return `${due} stays; the new day is after it`
})

const problem = computed(() => (props.ask.def.kind === 'date' ? undefined : textProblem(props.ask.def, text.value)))
const stays = computed(() => (props.ask.closes === undefined ? undefined : props.ask.closes ? 'Saving also closes it.' : props.ask.count > 1 ? 'Saving does not mark them done.' : 'Saving does not mark it done.'))

function pick(day: string) {
  if (!saving.value) picked.value = day
}
const canSave = computed(() => !saving.value && (props.ask.def.kind === 'date' ? !!picked.value : !problem.value))

function save() {
  if (!canSave.value) return
  if (props.ask.def.kind === 'date') void props.ask.answer({ kind: 'date', value: { start: `${picked.value}T00:00:00.000Z`, resolution: 'day' } }, props.ask.dueMovable > 0 && moveDue.value)
  else void props.ask.answer(textAnswer(props.ask.def, text.value, props.ask.text, props.ask.action.changes.length === 1))
}
const cancel = () => props.ask.answer(null)

const presetClass = (day: string) => [
  'flex-1 rounded-lg px-2.5 py-1.5 max-md:py-3 max-md:text-base',
  picked.value === day ? 'bg-ink text-surface' : 'bg-hover hover:bg-line',
]
const cancelClass = 'flex-1 rounded-lg bg-hover px-3 py-1.5 hover:bg-line disabled:opacity-50 max-md:min-h-12 max-md:text-base'
const saveClass = 'flex-1 rounded-lg bg-ink px-3 py-1.5 font-medium text-surface disabled:opacity-40 max-md:min-h-12 max-md:text-base'
</script>

<template>
  <div v-if="ask.def.kind === 'date'" class="space-y-3 p-2 text-sm" data-defer-menu :aria-busy="saving || undefined">
    <p v-if="ask.scope" class="text-xs text-ink-faint" data-ask-scope>{{ ask.scope }}</p>
    <div class="flex gap-2">
      <button :class="presetClass(tomorrow)" :aria-pressed="picked === tomorrow" :disabled="saving" @click="pick(tomorrow)">Tomorrow</button>
      <button :class="presetClass(nextWeek)" :aria-pressed="picked === nextWeek" :disabled="saving" @click="pick(nextWeek)">Next week</button>
    </div>
    <MiniMonth :selected="picked ?? dayKey()" @pick="pick" />
    <p class="font-medium" :class="picked ? 'text-ink' : 'text-ink-faint'" data-picked-day>{{ ask.def.name }}: {{ picked ? longDay(picked) : 'choose a day' }}</p>
    <p v-if="dueLine" class="flex items-center gap-1.5 text-xs text-ink-faint" data-due-line>
      <AppIcon fallback="ph:flag" :size="12" /> {{ dueLine }}
    </p>
    <label v-if="ask.dueMovable" class="flex items-start gap-2 text-xs text-ink-soft max-md:min-h-11 max-md:items-center max-md:text-sm" data-move-due>
      <input v-model="moveDue" type="checkbox" :disabled="saving" class="mt-px shrink-0 accent-[var(--color-accent)] max-md:h-5 max-md:w-5" />
      <span>{{ ask.count === 1 ? 'Move the due date too, if the new day is after it' : 'Move due dates too, where the new day is after them' }}</span>
    </label>
    <p v-if="stays" class="text-xs text-ink-faint">{{ stays }}</p>
    <p v-if="failed" class="text-xs text-red-600" role="alert" data-ask-error>Not saved: {{ failed }}</p>
    <div class="flex gap-2">
      <button :class="cancelClass" :disabled="saving" data-ask-cancel @click="cancel">Cancel</button>
      <button :class="saveClass" :disabled="!canSave" data-ask-save @click="save">{{ submitText }}</button>
    </div>
  </div>
  <form v-else class="space-y-2 p-2 text-sm" data-next-step :aria-busy="saving || undefined" @submit.prevent="save">
    <p v-if="ask.scope" class="text-xs text-ink-faint" data-ask-scope>{{ ask.scope }}</p>
    <label class="block text-xs text-ink-faint" for="quick-ask-text">{{ ask.def.name }}</label>
    <input
      id="quick-ask-text"
      ref="textInput"
      v-model="text"
      :inputmode="ask.def.kind === 'number' ? 'decimal' : ask.def.kind === 'url' ? 'url' : 'text'"
      :readonly="saving"
      :aria-invalid="!!problem || undefined"
      :aria-describedby="problem || failed ? 'quick-ask-note' : undefined"
      :enterkeyhint="ask.submitLabel === 'Save' ? 'done' : 'next'"
      class="w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong max-md:py-2.5 max-md:text-base"
      :class="problem ? 'border-red-600' : 'border-line'"
      :placeholder="ask.def.kind === 'text' ? 'What happens next' : ''"
      @keydown.escape.stop="cancel"
    />
    <p v-if="problem || failed" id="quick-ask-note" class="text-xs text-red-600" role="alert" data-ask-error>{{ problem ?? `Not saved: ${failed}` }}</p>
    <p v-if="stays" class="text-xs text-ink-faint">{{ stays }}</p>
    <div class="flex gap-2 pt-1">
      <button type="button" :class="cancelClass" :disabled="saving" data-ask-cancel @click="cancel">Cancel</button>
      <button type="submit" :class="saveClass" :disabled="!canSave" data-ask-save>{{ submitText }}</button>
    </div>
  </form>
</template>
