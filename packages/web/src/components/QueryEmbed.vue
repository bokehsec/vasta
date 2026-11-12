<script setup lang="ts">
// A saved query embedded in a document: its live results, and its settings on demand. Editing
// here changes the query object itself, so every page embedding it follows. Compact shows only the
// results: no header or border, and Edit query comes from the block menu (blocks.ts).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Id, QueryDef } from '@vasta/core'
import { api } from '../lib/api.ts'
import { displayTitle } from '../lib/format.ts'
import { openObject } from '../lib/open.ts'
import { primeFromObject, summaryOf, typesById } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import QueryEditor from './QueryEditor.vue'
import QueryResults from './QueryResults.vue'
import ObjectLink from './ObjectLink.vue'

/** `readonly`: in a page that cannot be edited, the results' table cells do not edit either. */
const props = defineProps<{ objectId: Id; parentId?: Id; readonly?: boolean; compact?: boolean }>()

const summary = computed(() => summaryOf(props.objectId))
const type = computed(() => typesById.value.get(summary.value?.typeId ?? ''))
const query = computed<QueryDef>(() => draft.value ?? summary.value?.query ?? { typeIds: [] })
// A query that selects nothing yet (just created) opens its settings.
const editing = ref(!summary.value?.query?.typeIds.length && !summary.value?.query?.filter)
const draft = ref<QueryDef | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined
function edit(next: QueryDef) {
  draft.value = next
  clearTimeout(timer)
  timer = setTimeout(save, 500)
}
async function save() {
  clearTimeout(timer)
  const query = draft.value
  if (!query) return
  const object = await api.object(props.objectId)
  const saved = await api.saveObject({ ...object, query })
  primeFromObject(saved)
  // Keep a newer draft made while saving; the next save sends it.
  if (draft.value === query) draft.value = null
}

// The block menu's Edit query and Open query (blocks.ts) arrive as an event on the embed's block,
// the node view's wrapper.
const root = ref<HTMLElement>()
let block: Element | null | undefined
const fromMenu = (event: Event) => {
  if ((event as CustomEvent<'edit' | 'open'>).detail === 'edit') editing.value = true
  else void openObject(props.objectId)
}
onMounted(() => {
  block = root.value?.closest('[data-node-view-wrapper]')
  block?.addEventListener('vasta-query', fromMenu)
})
onBeforeUnmount(() => {
  block?.removeEventListener('vasta-query', fromMenu)
  void save()
})
</script>

<template>
  <div ref="root" class="vasta-ui" :class="compact ? '' : 'rounded-xl border border-line bg-surface'">
    <header v-if="!compact" class="flex items-center gap-2 px-3 py-2" data-drag-handle>
      <AppIcon :icon="summary?.icon ?? type?.icon" fallback="ph:funnel" class="text-ink-soft" />
      <ObjectLink :id="objectId" class="truncate text-sm font-semibold hover:underline">{{ displayTitle(summary, type) }}</ObjectLink>
      <button
        class="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs"
        :class="editing ? 'bg-hover text-ink' : 'text-ink-faint hover:bg-hover hover:text-ink'"
        @click="editing = !editing"
      >
        <AppIcon fallback="ph:sliders-horizontal" :size="13" /> {{ editing ? 'Done' : 'Edit query' }}
      </button>
    </header>
    <div v-if="editing && !(compact && readonly)" :class="compact ? 'mb-2 rounded-xl border border-line bg-surface px-3 py-3' : 'border-t border-line px-3 py-3'">
      <!-- Compact has no header, so the settings carry their own Done -->
      <div v-if="compact" class="mb-2 flex justify-end">
        <button class="flex items-center gap-1 rounded-md bg-hover px-1.5 py-1 text-xs text-ink" @click="editing = false">
          <AppIcon fallback="ph:sliders-horizontal" :size="13" /> Done
        </button>
      </div>
      <QueryEditor :query="query" @update="edit" />
    </div>
    <div :class="compact ? '' : 'border-t border-line px-3 py-3'">
      <QueryResults :query="query" :parent-id="parentId" :limit="24" :readonly="readonly" @table="edit({ ...query, table: $event })" @board="edit({ ...query, board: $event })" />
    </div>
  </div>
</template>
