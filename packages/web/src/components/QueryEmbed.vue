<script setup lang="ts">
// A saved query embedded in a document: its live results, and its settings on demand. Editing
// here changes the query object itself, so every page embedding it follows. Compact shows only the
// results: no header or border, and Edit query comes from the block menu (blocks.ts). A compact
// one whose query found nothing is hidden (data-empty, as a compact block's; style.css), while its
// settings are open or the query failed it is not. Neither draws a frame: the page is the frame.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Id, QueryDef } from '@vasta/core'
import { api } from '../lib/api.ts'
import { displayTitle } from '../lib/format.ts'
import { greyButton } from '../lib/buttons.ts'
import { openObject } from '../lib/open.ts'
import { primeFromObject, summaryOf, typesById } from '../lib/state.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import QueryEditor from './QueryEditor.vue'
import QueryResults from './QueryResults.vue'
import ObjectLink from './ObjectLink.vue'

/** `readonly`: in a page that cannot be edited, the results' table cells do not edit either. */
const props = defineProps<{ objectId: Id; instanceId?: string; parentId?: Id; readonly?: boolean; compact?: boolean }>()

const summary = computed(() => summaryOf(props.objectId))
const type = computed(() => typesById.value.get(summary.value?.typeId ?? ''))
const query = computed<QueryDef>(() => draft.value ?? summary.value?.query ?? { typeIds: [] })
// A query that selects nothing yet (just created) opens its settings.
const editing = ref(!summary.value?.query?.typeIds.length && !summary.value?.query?.filter)
const draft = ref<QueryDef | null>(null)
const results = ref<InstanceType<typeof QueryResults>>()
const hidden = computed(() => props.compact && !editing.value && !!results.value?.empty)

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
  <!-- Frameless: the title reads as a small heading in the page, the results sit under it with
       no box of their own, and Edit query shows on hover (always on touch) or while editing. -->
  <div ref="root" class="vasta-ui group/query" :class="bodyText" :data-empty="hidden ? '' : undefined">
    <header v-if="!compact" class="flex min-h-8 items-center gap-2 pb-1" data-drag-handle>
      <AppIcon :icon="summary?.icon ?? type?.icon" fallback="ph:funnel" class="text-ink-soft" />
      <ObjectLink :id="objectId" class="truncate font-semibold hover:underline" :class="bodyText">{{ displayTitle(summary, type) }}</ObjectLink>
      <button
        class="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1"
        :class="[metaText, editing ? 'bg-hover text-ink' : 'text-ink-faint opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/query:opacity-100 [@media(hover:none)]:opacity-100']"
        @click="editing = !editing"
      >
        <AppIcon fallback="ph:sliders-horizontal" :size="13" /> {{ editing ? 'Done' : 'Edit query' }}
      </button>
    </header>
    <div v-if="editing && !(compact && readonly)" class="mb-2 rounded-xl border border-line bg-surface px-3 py-3">
      <!-- Compact has no header, so the settings carry their own Done -->
      <div v-if="compact" class="mb-2 flex justify-end">
        <button :class="greyButton" @click="editing = false">
          <AppIcon fallback="ph:sliders-horizontal" :size="13" /> Done
        </button>
      </div>
      <QueryEditor :query="query" @update="edit" />
    </div>
    <div v-show="!hidden">
      <QueryResults ref="results" :fold-scope="parentId && instanceId ? `object/${parentId}/embed/${instanceId}/${objectId}` : undefined" :query="query" :parent-id="parentId" :limit="24" :readonly="readonly" bare @table="edit({ ...query, table: $event })" @board="edit({ ...query, board: $event })" />
    </div>
  </div>
</template>
