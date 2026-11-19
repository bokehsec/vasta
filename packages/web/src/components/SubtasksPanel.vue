<script setup lang="ts">
// An object's steps on its page (types with a parent field, core subtasks.ts): how many are done,
// each with its checkbox, title and due date (swipes on touch), and "Add subtask": Return makes it
// and keeps the cursor for the next; several pasted lines make one each. A new step takes the
// parent's selects, relations, people and tags (lib/subtasks.ts). The checkbox and "done" follow
// the type's status select (core statusProperty, as the progress does), so any type with one has
// them and a type without one shows no checkbox. A step's circle is the one lists have
// (TaskCompletionCheck): it runs the type's Done, offers an Undo, and its circle undoes it too, both
// putting the exact values back; a dropped step shows as dropped. On touch a step swipes and has a
// ⋯, like any row (lib/quick-actions.ts swipeActionsFor). Once every step is closed and
// the parent is open, a line says so with a button for the type's Done action; the parent is never
// closed by itself.
import { computed, nextTick, ref, watch } from 'vue'
import type { ObjectRecord, ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { doneActionOf, isClosedTask, statusProperty, subtaskProgress, taskDatesOf } from '@vasta/core'
import { mainButton, tintedButton } from '../lib/buttons.ts'
import { setProperties } from '../lib/actions.ts'
import { displayTitle, formatDateShort } from '../lib/format.ts'
import { openContextMenu } from '../lib/overlays.ts'
import { copyObjectLink, openObject } from '../lib/open.ts'
import { quickActionMenuItems, runQuickAction, swipeActionsFor, type QuickSave } from '../lib/quick-actions.ts'
import { lastError } from '../lib/state.ts'
import { addSubtask, noteSaved, subtaskMenuItems, subtasksOf } from '../lib/subtasks.ts'
import { useCompletion } from '../lib/use-completion.ts'
import { isPhone, isTouch } from '../lib/viewport.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import ObjectLink from './ObjectLink.vue'
import SwipeRow from './SwipeRow.vue'
import TaskCompletionCheck from './TaskCompletionCheck.vue'

const props = defineProps<{ type: ObjectType; object: Pick<ObjectRecord, 'id' | 'props' | 'tagIds'>; save: QuickSave }>()

const steps = computed(() => subtasksOf(props.type, props.object.id))
const progress = computed(() => subtaskProgress(props.type, props.object, steps.value))
/** The select that says whether a step is open or closed; without one, steps have no checkbox. */
const statusDef = computed(() => statusProperty(props.type))
const dueOf = (step: ObjectSummary) => {
  const deadline = taskDatesOf(props.type).deadline?.id
  const value = deadline ? step.props[deadline] : undefined
  return value?.kind === 'date' ? formatDateShort(value.value) : ''
}

const saveStep: QuickSave = (id, values) => setProperties(id, values).then(noteSaved)

// Completion feedback (lib/completion-feedback.ts), as on type pages: a step marked Done here
// saves and stays in place (steps always are), and its circle or the notice's Undo puts its exact
// values back. Only a step completed elsewhere, which the panel never watched close, reopens with
// the status that reopens a task.
function replaceStep(saved: ObjectRecord | ObjectSummary) {
  const index = steps.value.findIndex((step) => step.id === saved.id)
  if (index >= 0) steps.value[index] = { ...saved, preview: steps.value[index]!.preview } as ObjectSummary
}
const completion = useCompletion({
  type: () => props.type,
  rows: () => steps.value,
  replace: replaceStep,
  noun: 'subtask',
  resetOn: () => props.object.id,
})
watch(steps, (list) => completion.prune(new Set(list.map((step) => step.id))))

// Adding ------------------------------------------------------------------------
const title = ref('')
const input = ref<HTMLInputElement | null>(null)
const adding = ref(false)
async function add(lines: string[]) {
  const titles = lines.map((l) => l.trim()).filter(Boolean)
  if (!titles.length || adding.value) return
  adding.value = true
  try {
    for (const line of titles) await addSubtask(props.type, props.object, line)
    title.value = ''
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    adding.value = false
    await nextTick()
    input.value?.focus()
  }
}
function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text.includes('\n')) return
  event.preventDefault()
  void add([title.value + text.split('\n')[0], ...text.split('\n').slice(1)])
}

// Ready to close: the type's Done, run on the parent through the page.
const closeAction = computed<QuickActionDef | undefined>(() => doneActionOf(props.type))
const parentOpen = computed(() => !isClosedTask(props.type, props.object))
function closeParent(event: MouseEvent) {
  if (closeAction.value) void runQuickAction(props.type, props.object, closeAction.value, { anchor: event.currentTarget as HTMLElement, save: props.save })
}

// Swipes on a step, as on rows in lists; a ⋯ at the row's end (and a long press) opens its menu.
function swipes(step: ObjectSummary) {
  return isTouch.value && !isClosedTask(props.type, step) ? swipeActionsFor(props.type, step, { save: saveStep, menu: (event) => stepMenu(event, step) }) : { left: [] }
}
function stepMenu(event: MouseEvent, step: ObjectSummary) {
  openContextMenu(event, [
    { kind: 'heading', label: displayTitle(step, props.type) },
    { label: 'Open', icon: 'ph:arrow-square-out', run: () => openObject(step.id) },
    { label: 'Copy link to page', icon: 'ph:link', run: () => copyObjectLink(step.id) },
    ...(completion.entries.has(step.id) ? [] : quickActionMenuItems(props.type, step, { save: saveStep })),
    ...subtaskMenuItems(props.type, step, noteSaved),
  ])
}
/** A phone's ⋯ at a step's end: its menu, from the button's corner. */
function stepMore(event: MouseEvent, step: ObjectSummary) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  stepMenu(new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom }), step)
}
</script>

<template>
  <section class="mt-5" data-subtasks>
    <header class="flex items-baseline justify-between px-1 pb-1.5 font-semibold text-ink-soft" :class="metaText">
      <span>Subtasks</span>
      <span v-if="progress.total" class="flex items-center gap-2 font-medium tabular-nums text-ink-faint">
        <span class="h-[3px] w-16 overflow-hidden rounded-full bg-line" aria-hidden="true" data-subtask-bar>
          <span class="block h-full rounded-full bg-[var(--color-flow-done)] transition-[width] duration-200" :style="{ width: `${(progress.done / progress.total) * 100}%` }" />
        </span>
        <span data-subtask-progress>{{ progress.done }} of {{ progress.total }} done</span>
      </span>
    </header>
    <div class="divide-y divide-line/70 border-y border-line/70">
      <SwipeRow v-for="step in steps" :key="step.id" :enabled="!!swipes(step).right" :right="swipes(step).right" :left="swipes(step).left">
        <div class="flex items-start gap-2 px-1 py-1.5 max-md:py-2.5" data-subtask @contextmenu="stepMenu($event, step)">
          <TaskCompletionCheck v-if="statusDef" :object="step" :type="type" class="mt-px" data-subtask-check />
          <ObjectLink :id="step.id" class="min-w-0 flex-1 hover:underline max-md:text-base max-md:leading-snug" :class="[bodyText, completion.done(step) ? 'text-ink-faint line-through' : '']">
            {{ displayTitle(step, type) }}
          </ObjectLink>
          <span v-if="dueOf(step)" class="shrink-0 pt-0.5 text-ink-faint" :class="metaText">{{ dueOf(step) }}</span>
          <!-- A phone: a visible way to the step's menu, 44px to touch (a long press is not found by looking). -->
          <button
            v-if="isPhone"
            class="-my-2.5 -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-soft active:bg-hover"
            :aria-label="`More actions for ${displayTitle(step, type)}`"
            data-row-more
            @click.prevent.stop="stepMore($event, step)"
          >
            <AppIcon fallback="ph:dots-three" :size="20" />
          </button>
        </div>
      </SwipeRow>
      <form class="flex items-center gap-2 px-1 py-1 max-md:py-1.5" @submit.prevent="add([title])">
        <AppIcon fallback="ph:plus" :size="18" class="shrink-0 text-ink-faint" />
        <input
          ref="input"
          v-model="title"
          class="min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-ink-faint max-md:text-base"
          :class="bodyText"
          placeholder="Add subtask"
          aria-label="Add subtask"
          :disabled="adding"
          data-add-subtask
          enterkeyhint="enter"
          @paste="onPaste"
          @keydown.escape="title = ''"
        />
        <button v-if="isTouch" type="submit" :class="mainButton" :disabled="adding || !title.trim()" data-add-subtask-button>Add</button>
      </form>
    </div>
    <div v-if="progress.readyToClose && parentOpen" class="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-1.5" :class="bodyText" data-ready-to-close>
      <AppIcon fallback="ph:check-circle" :size="16" class="shrink-0 text-[var(--color-flow-done)]" />
      <span class="flex-1">All subtasks done</span>
      <button v-if="closeAction" :class="tintedButton" data-close-parent @click="closeParent">
        <AppIcon :icon="closeAction.icon" fallback="ph:check-circle" :size="15" /> {{ closeAction.name }}
      </button>
    </div>
  </section>
</template>
