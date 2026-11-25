<script setup lang="ts">
// The decision under the task in a review, labels in full and without icons. A big screen has one row in
// the task's column: Keep as planned (the ink button), Schedule…, Waiting… and Done (grey), then Drop and
// a quiet Snooze at the other end (Decide later, shown only where there is no Snooze or after a decision
// (Next), is quiet text at the very end); each key (kbd) shows only on hover or keyboard focus of its
// button. The other statuses are a small muted "Move to …" line under it. When the row does not fit the
// column (a narrow window, long names) or on a phone, the same choices are a tray at the bottom, every
// button 44px tall: Keep a full row, Schedule… | Waiting…, Done a full row, Drop | Snooze; a label wraps
// there rather than being cut, and nothing ever scrolls sideways. Whatever is typed in the comment box
// goes with the decision pressed (ProcessMode). What is offered is lib/review-choices.ts; the choosing
// and the keys are ProcessMode's.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ObjectType, QuickActionDef, ReviewButton } from '@vasta/core'
import { askOf } from '@vasta/core'
import { greyButton, mainButton, quietButton } from '../lib/buttons.ts'
import type { ReviewDecisions } from '../lib/review-choices.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'

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
  /** Days Snooze hides a task for. */
  snoozeDays: number
  /** A big screen (the row is tried first); a phone always has the tray. */
  wide: boolean
}>()
const emit = defineEmits<{ act: [action: QuickActionDef, anchor: HTMLElement | null]; skip: [] }>()

const label = (button: ReviewButton) => (button.role === 'wait' || askOf(props.type, button.action) ? `${button.label}…` : button.label)
const keepLabel = computed(() => (props.outcome ? `Next ${props.noun}` : 'Keep as planned'))
const keepHint = computed(() => (props.outcome ? 'Decided. Go on to the next one.' : props.every ? `Marks it reviewed today. It comes back in ${props.every} ${props.every === 1 ? 'day' : 'days'}.` : 'Marks it reviewed today.'))
const laterHint = 'Not reviewed; it stays in the queue.'
const snoozeHint = computed(() => `Hidden from Review for ${props.snoozeDays} ${props.snoozeDays === 1 ? 'day' : 'days'}. Nothing else changes.`)
/** Decide later stays where there is no Snooze (another type's review), after a decision (Next) and for a task that is gone. */
const skipShown = computed(() => !props.choices.main.some((b) => b.role === 'snooze') || !!props.outcome || !props.active)

/** What the row or the tray is made of, in the order of both: Keep, the others, Done, Drop, Snooze. */
interface Item { key: string; kind: 'keep' | 'choice'; button?: ReviewButton; role: string; quiet: boolean; full: boolean; gap: boolean }
const items = computed<Item[]>(() => {
  const main = props.choices.main
  const done = main.find((b) => b.role === 'done')
  const drop = main.find((b) => b.role === 'drop')
  const snooze = main.find((b) => b.role === 'snooze')
  const others = main.filter((b) => b !== done && b !== drop && b !== snooze)
  const entry = (button: ReviewButton, quiet = false): Item => ({ key: button.action.id, kind: 'choice', button, role: button.role, quiet, full: false, gap: false })
  const list: Item[] = []
  if (props.choices.reviewed) list.push({ key: 'keep', kind: 'keep', role: 'keep', quiet: false, full: true, gap: false })
  const middle = [...others.map((b) => entry(b)), ...(done ? [{ ...entry(done), full: true }] : [])]
  // An odd one out among the others takes the whole row (Done does anyway).
  if (others.length % 2 === 1) middle[others.length - 1]!.full = true
  list.push(...middle)
  const last = [...(drop ? [entry(drop, true)] : []), ...(snooze ? [entry(snooze, true)] : [])]
  if (last.length === 1) last[0]!.full = true
  if (last[0]) last[0].gap = true
  list.push(...last)
  return list
})

// One row if it fits, else the tray. The row's own width is measured while it is shown; once it did not
// fit, the width it needs is remembered and the row comes back when the column is that wide again.
const inner = ref<HTMLElement | null>(null)
const row = ref<HTMLElement | null>(null)
const narrow = ref(false)
const tray = computed(() => !props.wide || narrow.value)
let needed = 0
let resizes: ResizeObserver | undefined
function measure() {
  if (!props.wide || !inner.value) return
  if (row.value) {
    if (row.value.scrollWidth > row.value.clientWidth + 1) {
      needed = row.value.scrollWidth
      narrow.value = true
    }
  } else if (needed && inner.value.clientWidth >= needed) narrow.value = false
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && inner.value) (resizes = new ResizeObserver(measure)).observe(inner.value)
  measure()
})
onBeforeUnmount(() => resizes?.disconnect())
// What the row holds changed (another task, a decision): try the row again.
watch([() => items.value.map((i) => `${i.key}:${i.button ? label(i.button) : keepLabel.value}`).join('|'), skipShown, () => props.wide], async () => {
  needed = 0
  narrow.value = false
  await nextTick()
  measure()
})

const choose = (action: QuickActionDef, event: Event) => emit('act', action, event.currentTarget as HTMLElement)
const link = `rounded-md px-1.5 text-ink-soft underline decoration-line-strong underline-offset-[3px] hover:bg-hover hover:text-ink hover:decoration-ink-soft disabled:opacity-40 ${bodyText}`
const kbd = `pointer-events-none absolute -top-2.5 right-1.5 hidden rounded border border-line-strong bg-surface px-1 py-0.5 font-normal leading-none text-ink-soft shadow-sm group-hover:block group-focus-visible:block ${metaText}`
const kindOf = (item: Item) => (item.kind === 'keep' ? mainButton : item.quiet ? quietButton : greyButton)
const classes = (item: Item) => [kindOf(item), 'group relative', tray.value ? 'min-h-11 min-w-0 whitespace-normal! break-words' : '', tray.value && item.full ? 'col-span-2' : '', !tray.value && item.gap ? 'ml-auto' : '']
</script>

<template>
  <div class="shrink-0 border-t border-line bg-surface px-3.5 pt-3 md:px-6" :class="wide ? 'pb-2' : 'pb-1'" data-process-choices>
    <div ref="inner" class="mx-auto w-full max-w-[37.5rem]">
      <div v-if="active" ref="row" :class="tray ? 'grid grid-cols-2 gap-2' : 'flex items-center gap-2'" :data-process-tray="tray ? '' : undefined" data-process-row>
        <template v-for="item in items" :key="item.key">
          <button v-if="item.kind === 'keep' && choices.reviewed" :class="classes(item)" :disabled="blocked" :title="keepHint" data-process-reviewed @click="choose(choices.reviewed, $event)">
            {{ keepLabel }}<kbd v-if="wide && !outcome" :class="kbd">K</kbd>
          </button>
          <button v-else-if="item.button" :class="classes(item)" :disabled="blocked" :title="item.role === 'snooze' ? snoozeHint : undefined" :data-key="choices.keyOf(item.button)" :data-process-choice="item.button.option?.id ?? item.role" :data-process-role="item.role" :data-process-action="item.button.option ? undefined : item.button.action.id" @click="choose(item.button.action, $event)">
            {{ item.role === 'snooze' ? item.button.label : label(item.button) }}<kbd v-if="wide && choices.keyOf(item.button)" :class="kbd">{{ choices.keyOf(item.button) }}</kbd>
          </button>
        </template>
        <button v-if="skipShown && !tray" :class="[quietButton, items.some((i) => i.gap) ? '' : 'ml-auto', 'font-medium text-ink']" :disabled="blocked" :title="outcome || !active ? undefined : laterHint" data-process-skip @click="emit('skip')">{{ outcome || !active ? 'Next' : 'Decide later' }}</button>
      </div>
      <div v-else-if="skipShown && !tray" class="flex">
        <button :class="[quietButton, 'ml-auto font-medium text-ink']" :disabled="blocked" data-process-skip @click="emit('skip')">Next</button>
      </div>
      <!-- Under the row, a big screen keeps this line's room even when empty, so the row is in the same place for every task. -->
      <div v-if="!tray || (active && choices.links.length) || skipShown" class="mt-1 flex items-center justify-between gap-2" :class="tray ? '' : 'min-h-8'" data-process-under>
        <p v-if="active && choices.links.length" class="flex min-w-0 flex-wrap items-center text-ink-soft" :class="[metaText, tray ? 'max-md:text-sm' : '']" data-process-links>
          <span class="pr-0.5">{{ choices.hasButtons ? 'Move to' : 'Or' }}</span>
          <template v-for="(button, i) in choices.links" :key="button.action.id">
            <span v-if="i" aria-hidden="true">·</span>
            <button :class="[link, tray ? 'min-h-11' : 'min-h-8', metaText, 'max-md:text-sm']" :disabled="blocked" :data-key="choices.keyOf(button)" :title="wide && choices.keyOf(button) ? `Key ${choices.keyOf(button)}` : undefined" :data-process-choice="button.option?.id" :data-process-action="button.option ? undefined : button.action.id" @click="choose(button.action, $event)">{{ label(button) }}</button>
          </template>
        </p>
        <span v-else />
        <button v-if="tray && skipShown" :class="[quietButton, 'font-medium text-ink']" :disabled="blocked" :title="outcome || !active ? undefined : laterHint" data-process-skip @click="emit('skip')">{{ outcome || !active ? 'Next' : wide ? 'Decide later' : 'Later' }}</button>
      </div>
    </div>
  </div>
</template>
