<script setup lang="ts">
// An object's steps on its page (types with a parent field, core subtasks.ts): how many are done,
// each with its checkbox, title and due date (swipes on touch), and "Add subtask": Return makes it
// and keeps the cursor for the next; several pasted lines make one each. A new step takes the
// parent's selects, relations, people and tags (lib/subtasks.ts). Once every step is closed and
// the parent is open, a line says so with a button for the type's first quick action (Done); the
// parent is never closed by itself.
import { computed, nextTick, ref } from 'vue'
import type { ObjectRecord, ObjectSummary, ObjectType, QuickActionDef } from '@vasta/core'
import { DUE_PROPERTY_ID, isClosedTask, quickActionsOf, subtaskProgress } from '@vasta/core'
import { setProperties } from '../lib/actions.ts'
import { isDone, setTaskDone } from '../lib/calendar.ts'
import { displayTitle, formatDateShort } from '../lib/format.ts'
import { runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { lastError } from '../lib/state.ts'
import { addSubtask, loadSubtasks, subtasksOf } from '../lib/subtasks.ts'
import { isTouch } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import ObjectLink from './ObjectLink.vue'
import SwipeRow, { type SwipeAction } from './SwipeRow.vue'

const props = defineProps<{ type: ObjectType; object: Pick<ObjectRecord, 'id' | 'props' | 'tagIds'>; save: QuickSave }>()

const steps = computed(() => subtasksOf(props.type, props.object.id))
const progress = computed(() => subtaskProgress(props.type, props.object, steps.value))
const statusOf = (step: ObjectSummary) => (step.props.status?.kind === 'select' ? step.props.status.value : undefined)
const closed = (step: ObjectSummary) => isDone(props.type, statusOf(step))
const dueOf = (step: ObjectSummary) => {
  const value = step.props[DUE_PROPERTY_ID]
  return value?.kind === 'date' ? formatDateShort(value.value) : ''
}

const saveStep: QuickSave = (id, values) => setProperties(id, values).then(() => loadSubtasks(props.type.id, true))

async function toggle(step: ObjectSummary) {
  try {
    await setTaskDone(step.id, props.type, !closed(step))
    await loadSubtasks(props.type.id, true)
  } catch (error) {
    lastError.value = (error as Error).message
  }
}

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

// Ready to close: the type's first quick action, run on the parent through the page.
const closeAction = computed<QuickActionDef | undefined>(() => quickActionsOf(props.type)[0])
const parentOpen = computed(() => !isClosedTask(props.type, props.object))
function closeParent(event: MouseEvent) {
  if (closeAction.value) void runQuickAction(props.type, props.object, closeAction.value, { anchor: event.currentTarget as HTMLElement, save: props.save })
}

// Swipes on a step: as on rows in lists (right: Defer, left: the others).
function swipes(step: ObjectSummary): { right?: SwipeAction; left: SwipeAction[] } {
  if (!isTouch.value || isClosedTask(props.type, step)) return { left: [] }
  const actions = quickActionsOf(props.type)
  const right = actions.find((a) => a.id === 'defer') ?? actions[0]
  const make = (a: QuickActionDef): SwipeAction => ({ id: a.id, label: a.name, icon: a.icon, tone: a.id === 'done' ? 'done' : a.id === 'defer' ? 'accent' : 'neutral', run: () => runQuickAction(props.type, step, a, { save: saveStep }) })
  const left = actions.filter((a) => a !== right).sort((a, b) => Number(b.id === 'done') - Number(a.id === 'done')).slice(0, 3).map(make)
  return { right: right && make(right), left }
}

</script>

<template>
  <section class="mt-5" data-subtasks>
    <header class="flex items-baseline justify-between px-1 pb-1.5 text-xs font-semibold text-ink-soft">
      <span>Subtasks</span>
      <span v-if="progress.total" class="font-medium tabular-nums text-ink-faint" data-subtask-progress>{{ progress.done }} of {{ progress.total }} done</span>
    </header>
    <div class="divide-y divide-line/70 border-y border-line/70">
      <SwipeRow v-for="step in steps" :key="step.id" :enabled="!!swipes(step).right" :right="swipes(step).right" :left="swipes(step).left">
        <div class="flex items-start gap-2 px-1 py-1.5 max-md:py-2.5" data-subtask>
          <button
            class="relative mt-px shrink-0 rounded-full [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-3 [@media(hover:none)]:after:content-['']"
            :class="closed(step) ? 'text-[var(--color-flow-done)]' : 'text-ink-soft hover:text-ink'"
            :title="closed(step) ? 'Mark as to do' : 'Mark as done'"
            data-subtask-check
            @click="toggle(step)"
          >
            <AppIcon :fallback="closed(step) ? 'ph:check-circle-fill' : 'ph:circle'" :size="18" />
          </button>
          <ObjectLink :id="step.id" class="min-w-0 flex-1 text-sm hover:underline max-md:text-base max-md:leading-snug" :class="closed(step) ? 'text-ink-faint line-through' : ''">
            {{ displayTitle(step, type) }}
          </ObjectLink>
          <span v-if="dueOf(step)" class="shrink-0 pt-0.5 text-xs text-ink-faint max-md:text-[13px]">{{ dueOf(step) }}</span>
        </div>
      </SwipeRow>
      <form class="flex items-center gap-2 px-1 py-1 max-md:py-1.5" @submit.prevent="add([title])">
        <AppIcon fallback="ph:plus" :size="18" class="shrink-0 text-ink-faint" />
        <input
          ref="input"
          v-model="title"
          class="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-ink-faint max-md:text-base"
          placeholder="Add subtask"
          aria-label="Add subtask"
          :disabled="adding"
          data-add-subtask
          @paste="onPaste"
          @keydown.escape="title = ''"
        />
      </form>
    </div>
    <div v-if="progress.readyToClose && parentOpen" class="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm" data-ready-to-close>
      <AppIcon fallback="ph:check-circle" :size="16" class="shrink-0 text-[var(--color-flow-done)]" />
      <span class="flex-1">All subtasks done</span>
      <button v-if="closeAction" class="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-2" data-close-parent @click="closeParent">
        <AppIcon :icon="closeAction.icon" fallback="ph:check-circle" :size="15" /> {{ closeAction.name }}
      </button>
    </div>
  </section>
</template>
