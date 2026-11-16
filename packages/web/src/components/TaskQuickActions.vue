<script setup lang="ts">
// A task's quick actions (Type settings › Quick actions, @vasta/core task-actions.ts): a button per
// action, on its page (icon and name) and on its row in a list or table that shows them (`variant`
// 'row': icons). Pressing one runs it (lib/quick-actions.ts): an action that asks for a value asks
// under the button first. Closed tasks show none. The page or list applies the values; Undo in the
// notice puts the previous ones back, saving them itself once this is gone (the next task opened in
// the side pane, a row the list no longer shows).
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import type { Id, ObjectRecord, ObjectType, PropertyValue, QuickActionDef } from '@vasta/core'
import { STATUS_PROPERTY_ID, askOf, isClosedTask, quickActionsOf } from '@vasta/core'
import { setProperties } from '../lib/actions.ts'
import { greyButton, tintedButton } from '../lib/buttons.ts'
import { quickAsk, runQuickAction } from '../lib/quick-actions.ts'
import AppIcon from './AppIcon.vue'
import { COMPLETION_FEEDBACK } from '../lib/completion-feedback.ts'

/** `note`: said in the notice after an action instead of the runner's own (subtasks still open). */
const props = defineProps<{
  type: ObjectType
  object: Pick<ObjectRecord, 'id' | 'props'>
  variant?: 'page' | 'row'
  note?: () => string | undefined
  /**
   * Applies this task's values (`@set`). A prop rather than an emit so a save that fails reaches the
   * runner, which counts it and says so instead of showing a success notice.
   */
  onSet?: (values: Record<Id, PropertyValue | undefined>) => unknown
}>()

const row = computed(() => props.variant === 'row')
const actions = computed(() => quickActionsOf(props.type))
const completion = inject(COMPLETION_FEEDBACK, undefined)
const retained = computed(() => completion?.entries.has(props.object.id) ?? false)
const shown = computed(() => actions.value.length > 0 && (!isClosedTask(props.type, props.object) || retained.value))
/**
 * On the page, the action that marks the task done (the first status that closes it as done) is the
 * main one: tinted, not filled, so it never reads as the task's current status.
 */
const mainId = computed(() => {
  const status = props.type.properties.find((p) => p.id === STATUS_PROPERTY_ID)
  const done = status?.kind === 'select' ? status.options.find((o) => o.status === 'done') : undefined
  if (!done) return undefined
  const setsDone = (action: QuickActionDef) =>
    action.changes.some((c) => c.field === STATUS_PROPERTY_ID && c.value.kind === 'value' && c.value.value.kind === 'select' && c.value.value.value.includes(done.id))
  return actions.value.find(setsDone)?.id
})
/** An action that asks for a value first says so, as in menus (Defer…). */
const label = (action: QuickActionDef) => (askOf(props.type, action) ? `${action.name}…` : action.name)

let mounted = true
onBeforeUnmount(() => (mounted = false))

/** This task's values go to the page or list while it shows this task, else straight to the server. */
const save = (id: Id, values: Record<Id, PropertyValue | undefined>) => (mounted && props.onSet && props.object.id === id ? props.onSet(values) : setProperties(id, values))

function press(event: MouseEvent, action: QuickActionDef) {
  if (retained.value) return
  // On its page the task's title is right there; a row's question names the task.
  void runQuickAction(props.type, props.object, action, { anchor: event.currentTarget as HTMLElement, save, note: props.note, ...(row.value ? {} : { scope: '' }) })
}
/** The action whose question is open under one of these buttons. */
const root = ref<HTMLElement | null>(null)
const askingId = computed(() => {
  const ask = quickAsk.value
  return ask?.anchor && root.value?.contains(ask.anchor) ? ask.action.id : undefined
})

// On the page buttons named with verbs: the main action tinted, the rest grey; none filled, so
// none reads as the task's current state (lib/buttons.ts).
const rowButton = 'grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink max-md:h-9 max-md:w-9'
</script>

<template>
  <!-- On a row inside a link, clicks stay here. -->
  <div v-if="shown" ref="root" :class="row ? 'flex shrink-0 flex-wrap items-center' : 'mt-3 flex flex-wrap items-center gap-1.5 text-sm'" data-quick-actions @click.stop.prevent>
    <button
      v-for="action in actions"
      :key="action.id"
      :class="[row ? rowButton : action.id === mainId ? tintedButton : greyButton, retained ? 'opacity-40' : '']"
      :title="row ? action.name : undefined"
      :aria-expanded="askingId === action.id || undefined"
      :aria-disabled="retained || undefined"
      :data-action="action.id"
      @click="press($event, action)"
    >
      <AppIcon :icon="action.icon" fallback="ph:lightning" :size="row ? 17 : 15" /><template v-if="!row"> {{ label(action) }}</template>
    </button>
  </div>
</template>
