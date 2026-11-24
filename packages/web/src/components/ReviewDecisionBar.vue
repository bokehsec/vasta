<script setup lang="ts">
// The decision under the task in a review: Keep (highlighted: the status it has), the main buttons,
// then the other statuses as links; Back and Decide later at the ends. A phone has them as a tray
// at the bottom, Back in the header. What is offered is lib/review-choices.ts; the choosing and the
// keys are ProcessMode's.
import { computed } from 'vue'
import type { ObjectType, QuickActionDef, ReviewButton } from '@vasta/core'
import { askOf } from '@vasta/core'
import { greyButton, mainButton, quietButton } from '../lib/buttons.ts'
import type { ReviewDecisions } from '../lib/review-choices.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  type: ObjectType
  choices: ReviewDecisions
  /** There is an object to decide on (not the end, not a deleted one). */
  active: boolean
  blocked: boolean
  /** What it was decided with here, if it was. */
  outcome?: string | undefined
  /** The word for one object ("task"). */
  noun: string
  /** Days until a kept object comes back; 0: every time. */
  every: number
  atFirst: boolean
  wide: boolean
}>()
const emit = defineEmits<{ act: [action: QuickActionDef, anchor: HTMLElement | null]; skip: []; back: [] }>()

const label = (button: ReviewButton) => (askOf(props.type, button.action) ? `${button.label}…` : button.label)
const icon = (button: ReviewButton) => (button.role === 'today' ? 'ph:calendar-check' : button.role === 'defer' ? 'ph:calendar-blank' : button.role === 'done' ? 'ph:check-circle' : button.role === 'drop' ? 'ph:x-circle' : (button.action.icon?.value ?? 'ph:arrow-right'))
const tone = (button: ReviewButton) => (button.role === 'done' ? 'text-[var(--color-flow-done)]' : button.role === 'drop' ? 'text-red-600 dark:text-red-400' : '')
const keepLabel = computed(() => (props.outcome ? `Next ${props.noun}` : props.choices.currentStatus ? `Keep in ${props.choices.currentStatus.label}` : 'Keep as it is'))
const keepHint = computed(() => (props.outcome ? 'Decided. Go on to the next one.' : props.every ? `Marks it reviewed today. It comes back in ${props.every} ${props.every === 1 ? 'day' : 'days'}.` : 'Marks it reviewed today.'))
const laterHint = 'Not reviewed; it stays in the queue.'
/** A phone's tray is two columns: with an odd number of buttons the first (Keep, or a new task's Next) takes a row. */
const firstWide = computed(() => !props.wide && (props.choices.main.length + (props.choices.reviewed ? 1 : 0)) % 2 === 1)
const choose = (action: QuickActionDef, event: Event) => emit('act', action, event.currentTarget as HTMLElement)
const link = `min-h-11 rounded-md px-1.5 text-ink underline decoration-line-strong underline-offset-[3px] hover:bg-hover hover:decoration-ink-soft disabled:opacity-40 ${bodyText}`
const kbd = `rounded border border-line-strong px-1.5 py-0.5 leading-none text-ink-faint ${metaText}`
</script>

<template>
  <div class="shrink-0 border-t border-line bg-surface px-3.5 pt-2.5 md:px-6 md:pt-3.5" :class="wide ? 'pb-2' : 'pb-1'" data-process-choices>
    <template v-if="active">
      <div :class="wide ? 'flex flex-wrap justify-center gap-2' : 'grid grid-cols-2 gap-2'">
        <button v-if="choices.reviewed" :class="[mainButton, 'min-w-0', wide ? '' : 'min-h-12', firstWide ? 'col-span-2' : '']" :disabled="blocked" :title="keepHint" data-process-reviewed @click="choose(choices.reviewed, $event)">
          <AppIcon fallback="ph:check" :size="18" class="shrink-0" /><span class="truncate">{{ keepLabel }}</span><kbd v-if="wide && !outcome" class="ml-1 rounded border border-surface/35 px-1.5 py-0.5 leading-none text-surface/75" :class="metaText">K</kbd>
        </button>
        <button v-for="(button, i) in choices.main" :key="button.action.id" :class="[greyButton, 'min-w-0', wide ? '' : 'min-h-12', firstWide && !choices.reviewed && !i ? 'col-span-2' : '']" :disabled="blocked" :data-key="choices.keyOf(button)" :data-process-choice="button.option?.id ?? button.role" :data-process-role="button.role" :data-process-action="button.option ? undefined : button.action.id" @click="choose(button.action, $event)">
          <AppIcon :icon="button.option ? undefined : button.action.icon" :fallback="icon(button)" :size="18" class="shrink-0" :class="tone(button)" /><span class="truncate">{{ label(button) }}</span><kbd v-if="wide && choices.keyOf(button)" :class="[kbd, 'ml-1']">{{ choices.keyOf(button) }}</kbd>
        </button>
      </div>
    </template>
    <div class="mt-1 flex items-center gap-2" :class="wide ? 'grid grid-cols-[1fr_auto_1fr]' : 'justify-between'">
      <button v-if="wide" :class="[quietButton, 'justify-self-start']" :disabled="atFirst || blocked" data-process-back @click="emit('back')"><AppIcon fallback="ph:caret-left" :size="14" />Back</button>
      <p v-if="active && choices.links.length" class="flex min-w-0 flex-wrap items-center text-ink-soft" :class="[bodyText, wide ? 'justify-center' : '']" data-process-links>
        <span class="pr-0.5">{{ choices.hasButtons ? 'Move to' : 'Or' }}</span>
        <template v-for="(button, i) in choices.links" :key="button.action.id">
          <span v-if="i" aria-hidden="true">·</span>
          <button :class="link" :disabled="blocked" :data-key="choices.keyOf(button)" :title="wide && choices.keyOf(button) ? `Key ${choices.keyOf(button)}` : undefined" :data-process-choice="button.option?.id" :data-process-action="button.option ? undefined : button.action.id" @click="choose(button.action, $event)">{{ label(button) }}</button>
        </template>
      </p>
      <span v-else />
      <button :class="[quietButton, 'justify-self-end font-medium text-ink']" :disabled="blocked" :title="outcome ? undefined : laterHint" data-process-skip @click="emit('skip')">{{ outcome ? 'Next' : wide ? 'Decide later' : 'Later' }}<AppIcon fallback="ph:caret-right" :size="14" /></button>
    </div>
  </div>
</template>
