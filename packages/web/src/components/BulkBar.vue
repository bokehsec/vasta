<script setup lang="ts">
// The bar for a selection (lib/selection.ts), fixed at the bottom above the safe area: how many are
// picked, Select all, Clear, and what can be done to all of them at once: the quick actions when
// every one is an open object of one type that has them (one question, one notice, one Undo, through
// lib/quick-actions.ts; rows that fail to save stay picked), and Move to trash (one Undo). On a phone the actions are labelled icons in
// a row under the count.
import { computed } from 'vue'
import type { ObjectType, QuickActionDef } from '@vasta/core'
import { isClosedTask, quickActionsOf } from '@vasta/core'
import { setProperties } from '../lib/actions.ts'
import { runQuickAction } from '../lib/quick-actions.ts'
import { clearSelection, dropSelected, selectAll, selectedObjects, selecting, selection, selectionOwner, trashSelected } from '../lib/selection.ts'
import { typesById } from '../lib/state.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const count = computed(() => selection.ids.size)
const objects = computed(() => (selection.ids.size ? selectedObjects() : []))
/** The one type every picked object is, that has quick actions, and every one is open. */
const actionType = computed<ObjectType | undefined>(() => {
  const typeIds = new Set(objects.value.map((o) => o.typeId))
  if (typeIds.size !== 1) return undefined
  const type = typesById.value.get([...typeIds][0]!)
  return type && quickActionsOf(type).length > 0 && objects.value.every((o) => !isClosedTask(type, o)) ? type : undefined
})
const actions = computed(() => quickActionsOf(actionType.value))

async function run(action: QuickActionDef, event: MouseEvent) {
  const type = actionType.value
  const owner = selectionOwner()
  if (!type) return
  const asked = objects.value.length
  const saved = await runQuickAction(type, objects.value, action, {
    anchor: isPhone.value ? null : (event.currentTarget as HTMLElement),
    save: async (id, values) => owner?.moved(await setProperties(id, values)),
    noun: (n) => `${n} ${n === 1 ? type.name.toLowerCase() : type.pluralName.toLowerCase()}`,
  })
  // Everything saved ends the selection; after a partial failure the rows that failed stay picked.
  if (saved.length && saved.length >= asked) clearSelection()
  else if (saved.length) dropSelected(saved.map((e) => e.id))
}

const button = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-hover hover:text-ink'
const phoneButton = 'flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] text-ink-soft active:bg-hover'
</script>

<template>
  <Transition name="vasta-fade">
    <div
      v-if="selecting"
      class="fixed inset-x-2 z-40 mx-auto max-w-3xl rounded-2xl border border-line-strong bg-surface shadow-[0_8px_24px_rgb(0_0_0/0.16)] md:inset-x-4"
      :class="isPhone ? 'bottom-[calc(0.5rem+env(safe-area-inset-bottom))] px-1 pb-1 pt-1.5' : 'bottom-4 flex items-center gap-1 px-2 py-1.5'"
      role="toolbar"
      aria-label="Selected"
      data-bulk-bar
    >
      <div class="flex items-center gap-1" :class="isPhone ? 'px-2 pb-1' : 'pr-2'">
        <span class="text-sm font-semibold tabular-nums" data-bulk-count>{{ count }} selected</span>
        <button class="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-accent hover:bg-hover max-md:py-2.5" data-bulk-all @click="selectAll">Select all</button>
        <button v-if="isPhone" class="grid h-11 w-11 place-items-center rounded-lg text-ink-soft" aria-label="Clear the selection" data-bulk-clear @click="clearSelection">
          <AppIcon fallback="ph:x" :size="18" />
        </button>
      </div>
      <div class="flex items-center gap-1" :class="isPhone ? 'border-t border-line pt-1' : 'flex-1 border-l border-line pl-2'">
        <button v-for="action in actions" :key="action.id" :class="isPhone ? phoneButton : button" :data-bulk-action="action.id" :disabled="!count" @click="run(action, $event)">
          <AppIcon :icon="action.icon" fallback="ph:lightning" :size="isPhone ? 20 : 16" />{{ action.name }}
        </button>
        <button :class="[isPhone ? phoneButton : button, isPhone ? '' : 'ml-auto']" :disabled="!count" data-bulk-trash @click="trashSelected">
          <AppIcon fallback="ph:trash" :size="isPhone ? 20 : 16" />{{ isPhone ? 'Trash' : 'Move to trash' }}
        </button>
        <button v-if="!isPhone" :class="button" aria-label="Clear the selection" title="Clear (Esc)" data-bulk-clear @click="clearSelection">
          <AppIcon fallback="ph:x" :size="16" />
        </button>
      </div>
    </div>
  </Transition>
</template>
