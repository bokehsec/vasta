<script setup lang="ts">
// The inside of a quick action's question (QuickAskHost): a day (tomorrow and next week save at
// once, with Undo, unless that is after the deadline: then the warning shows and Save waits; one
// picked on a calendar only selects it: the day, and where the deadline ends up, show before Save
// writes it, keeping deadlines unless explicitly moved; any other choices the caller gave sit under
// the calendar and close the question when pressed) or a line of text
// (a number, a link); an empty line clears the field. Cancel and Save are always on screen. It stays
// open with what was typed or picked while saving, and when nothing could be saved says why and
// offers Retry.
import { computed, nextTick, onMounted, ref } from 'vue'
import { addDays } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
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
// "Also move the due date": off at first — rescheduling replaces the plan, and a deadline moves
// only by that explicit choice; a task planned past its deadline is left overdue on purpose.
const moveDue = ref(false)

const saving = computed(() => props.ask.state.saving)
const failed = computed(() => props.ask.state.error)
const submitText = computed(() => (saving.value ? 'Saving…' : failed.value ? 'Retry' : props.ask.submitLabel))

// What the picked day does to the due dates, in words: always says where the due date ends up.
const dueLine = computed(() => {
  const { ask } = props
  const day = picked.value
  if (!ask.due) return undefined
  const due = `Due ${longDay(ask.due)}`
  if (!day || day <= ask.due) return due
  const moves = ask.dueMoves(day)
  if (moves && moveDue.value) return `${due} → ${longDay(moves)}`
  if (!ask.dueMovable) return `${due} (repeats, so it stays)`
  return `${due} — planned after the deadline`
})

// A plan after its unchanged deadline needs a visible warning, including repeating deadlines.
const afterDue = computed(() => {
  const { ask } = props
  return ask.def.kind === 'date' && !!ask.due && !!picked.value && picked.value > ask.due && (!moveDue.value || !ask.dueMoves(picked.value))
})

const problem = computed(() => (props.ask.def.kind === 'date' ? undefined : textProblem(props.ask.def, text.value)))
const stays = computed(() => (props.ask.closes === undefined ? undefined : props.ask.closes ? 'Saving also closes it.' : 'Saving does not mark it done.'))

function pick(day: string) {
  if (!saving.value) picked.value = day
}
// Tomorrow and next week are one tap: saved at once (Undo is in the notice), but past the deadline
// the warning shows first and Save waits.
function preset(day: string) {
  pick(day)
  if (!afterDue.value) save()
}
const canSave = computed(() => !saving.value && (props.ask.def.kind === 'date' ? !!picked.value : !problem.value))

function save() {
  if (!canSave.value) return
  if (props.ask.def.kind === 'date') void props.ask.answer({ kind: 'date', value: { start: `${picked.value}T00:00:00.000Z`, resolution: 'day' } }, props.ask.dueMovable && moveDue.value)
  else void props.ask.answer(textAnswer(props.ask.def, text.value, props.ask.text, props.ask.action.changes.length === 1))
}
const cancel = () => props.ask.answer(null)
function choose(alternative: NonNullable<QuickAsk['alternatives']>[number]) {
  if (saving.value) return
  alternative.run()
  void props.ask.answer(null)
}

const presetClass = (day: string) => [
  'flex-1 rounded-lg px-2.5 py-1.5 max-md:py-3 max-md:text-base',
  picked.value === day ? 'bg-ink text-surface' : 'bg-hover hover:bg-line',
]
const cancelClass = [greyButton, 'flex-1']
const saveClass = [mainButton, 'flex-1']
</script>

<template>
  <div v-if="ask.def.kind === 'date'" class="space-y-3 p-2 text-sm" data-defer-menu :aria-busy="saving || undefined">
    <p v-if="ask.scope" class="line-clamp-2 text-xs text-ink-soft max-md:text-sm" data-ask-scope>{{ ask.scope }}</p>
    <div class="flex gap-2">
      <button :class="presetClass(tomorrow)" :aria-pressed="picked === tomorrow" :disabled="saving" @click="preset(tomorrow)">Tomorrow</button>
      <button :class="presetClass(nextWeek)" :aria-pressed="picked === nextWeek" :disabled="saving" @click="preset(nextWeek)">Next week</button>
    </div>
    <MiniMonth :selected="picked" @pick="pick" />
    <div v-if="ask.alternatives?.length" class="flex gap-2" data-ask-alternatives>
      <button v-for="alternative in ask.alternatives" :key="alternative.id" :class="[greyButton, 'min-w-0 flex-1 flex-col !gap-0 !py-1.5 max-md:!py-2']" :disabled="saving" :data-ask-alternative="alternative.id" @click="choose(alternative)">
        <span class="flex items-center gap-1.5"><AppIcon :fallback="alternative.icon" :size="16" />{{ alternative.label }}</span>
        <span v-if="alternative.hint" class="text-xs font-normal text-ink-soft">{{ alternative.hint }}</span>
      </button>
    </div>
    <p class="font-medium" :class="picked ? 'text-ink' : 'text-ink-faint'" data-picked-day>{{ ask.def.name }}: {{ picked ? longDay(picked) : 'choose a day' }}</p>
    <p v-if="dueLine" class="flex items-center gap-1.5 text-xs" :class="afterDue ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-ink-faint'" data-due-line>
      <AppIcon :fallback="afterDue ? 'ph:warning-circle' : 'ph:flag'" :size="12" /> {{ dueLine }}
    </p>
    <label v-if="ask.dueMovable" class="flex items-start gap-2 text-xs text-ink-soft max-md:min-h-11 max-md:items-center max-md:text-sm" data-move-due>
      <input v-model="moveDue" type="checkbox" :disabled="saving" class="mt-px shrink-0 accent-[var(--color-accent)] max-md:h-5 max-md:w-5" />
      <span>Also move the due date, if the new day is after it</span>
    </label>
    <p v-if="stays" class="text-xs text-ink-faint">{{ stays }}</p>
    <p v-if="failed" class="text-xs text-red-600" role="alert" data-ask-error>Not saved: {{ failed }}</p>
    <!-- On a short phone the sheet scrolls: Cancel and Save stay at its bottom edge. -->
    <div class="flex gap-2 max-md:sticky max-md:bottom-0 max-md:-mx-2 max-md:bg-surface max-md:px-2 max-md:pt-2">
      <button :class="cancelClass" :disabled="saving" data-ask-cancel @click="cancel">Cancel</button>
      <button :class="saveClass" :disabled="!canSave" data-ask-save @click="save">{{ submitText }}</button>
    </div>
  </div>
  <form v-else class="space-y-2 p-2 text-sm" data-next-step :aria-busy="saving || undefined" @submit.prevent="save">
    <p v-if="ask.scope" class="line-clamp-2 text-xs text-ink-soft max-md:text-sm" data-ask-scope>{{ ask.scope }}</p>
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
