<script setup lang="ts">
// A task's quick actions (Type settings › Quick actions, @vasta/core task-actions.ts): a button per
// action, on its page (icon and name) and on its row in a list or table that shows them (`variant`
// 'row': icons). Pressing one runs it (lib/quick-actions.ts): an action that asks for a value asks
// under the button first. Closed tasks show none. The page or list applies the values; Undo in the
// notice puts the previous ones back, saving them itself once this is gone (the next task opened in
// the side pane, a row the list no longer shows).
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Id, ObjectRecord, ObjectType, PropertyValue, QuickActionDef } from '@vasta/core'
import { isClosedTask, quickActionsOf } from '@vasta/core'
import { setProperties } from '../lib/actions.ts'
import { quickAsk, runQuickAction } from '../lib/quick-actions.ts'
import AppIcon from './AppIcon.vue'

/** `note`: said in the notice after an action (the page: subtasks still open). */
const props = defineProps<{ type: ObjectType; object: Pick<ObjectRecord, 'id' | 'props'>; variant?: 'page' | 'row'; note?: () => string | undefined }>()
const emit = defineEmits<{ set: [values: Record<Id, PropertyValue | undefined>] }>()

const row = computed(() => props.variant === 'row')
const actions = computed(() => quickActionsOf(props.type))
const shown = computed(() => actions.value.length > 0 && !isClosedTask(props.type, props.object))

let mounted = true
onBeforeUnmount(() => (mounted = false))

/** This task's values go to the page or list while it shows this task, else straight to the server. */
const save = (id: Id, values: Record<Id, PropertyValue | undefined>) => (mounted && props.object.id === id ? emit('set', values) : setProperties(id, values))

function press(event: MouseEvent, action: QuickActionDef) {
  void runQuickAction(props.type, props.object, action, { anchor: event.currentTarget as HTMLElement, save, note: props.note })
}
/** The action whose question is open under one of these buttons. */
const root = ref<HTMLElement | null>(null)
const askingId = computed(() => {
  const ask = quickAsk.value
  return ask?.anchor && root.value?.contains(ask.anchor) ? ask.action.id : undefined
})

const pageButton = 'flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5'
const rowButton = 'grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink max-md:h-9 max-md:w-9'
</script>

<template>
  <!-- On a row inside a link, clicks stay here. -->
  <div v-if="shown" ref="root" :class="row ? 'flex shrink-0 flex-wrap items-center' : 'mt-3 flex flex-wrap items-center gap-1.5 text-sm'" data-quick-actions @click.stop.prevent>
    <button
      v-for="action in actions"
      :key="action.id"
      :class="row ? rowButton : pageButton"
      :title="row ? action.name : undefined"
      :aria-expanded="askingId === action.id || undefined"
      :data-action="action.id"
      @click="press($event, action)"
    >
      <AppIcon :icon="action.icon" fallback="ph:lightning" :size="row ? 17 : 15" /><template v-if="!row"> {{ action.name }}</template>
    </button>
  </div>
</template>
