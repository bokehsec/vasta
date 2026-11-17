<script setup lang="ts">
// Live results of a query, laid out as the query says. Re-runs when the query changes and when
// objects change anywhere (debounced), so embedded queries stay current.
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import type { BoardSettings, Id, ObjectRecord, ObjectSummary, QueryDef, TableSettings } from '@vasta/core'
import { pinMenu, setProperties } from '../lib/actions.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle } from '../lib/format.ts'
import { openContextMenu, type MenuItem } from '../lib/overlays.ts'
import { runServerQuery } from '../lib/query.ts'
import { cachedSummary, notice, primeSummaries, typesById } from '../lib/state.ts'
import ObjectCollection from './ObjectCollection.vue'
import { copyObjectLink, openObject } from '../lib/open.ts'
import { quickActionMenuItems } from '../lib/quick-actions.ts'
import { subtaskMenuItems } from '../lib/subtasks.ts'
import { COMPLETION_FEEDBACK, createCompletionFeedback } from '../lib/completion-feedback.ts'
import { onObjectSave } from '../lib/object-saves.ts'

/** `readonly`: property cells of a table do not edit (a whiteboard card, a page that cannot be edited). */
/** `bare`: drawn inside something that frames it already (ObjectCollection). */
const props = defineProps<{ query: QueryDef; foldScope?: string; parentId?: Id; limit?: number; readonly?: boolean; bare?: boolean }>()
const emit = defineEmits<{ table: [table: TableSettings]; board: [board: BoardSettings] }>()

const results = ref<ObjectSummary[]>([])
const loading = ref(true)
const failed = ref(false)
const showAll = ref(false)
let seq = 0
// The agenda reads the calendar feed itself: no query to run, and no results to be empty.
const isAgenda = computed(() => props.query.layout === 'agenda')

async function load() {
  const mine = ++seq
  if (isAgenda.value) {
    loading.value = false
    return
  }
  try {
    const list = await runServerQuery(props.query, props.parentId)
    if (mine !== seq) return
    primeSummaries(list)
    results.value = list
    // A kept row no longer returned and no longer retained left on its own (an undo returned it,
    // a board drag moved it); a retained task deleted elsewhere also loses its cached summary.
    const present = new Set(list.map((object) => object.id))
    for (const id of [...kept.keys()]) if (!present.has(id) && !completion.entries.has(id)) kept.delete(id)
    for (const id of [...completion.entries.keys()]) {
      if (present.has(id) || (kept.has(id) && !!cachedSummary(id))) continue
      completion.entries.delete(id)
      kept.delete(id)
    }
    failed.value = false
  } catch {
    if (mine === seq) failed.value = true
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(() => [JSON.stringify(props.query), props.parentId], () => void load(), { immediate: true })

let timer: ReturnType<typeof setTimeout> | undefined
const stop = onChange((event) => {
  // Typing in the page that embeds the query saves it constantly; that alone changes no results.
  if (event.kind !== 'object' || event.id === props.parentId) return
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 400)
})
onBeforeUnmount(() => {
  stop()
  clearTimeout(timer)
})

// Group before limiting a preview, so every group header has its full matching count.
const grouped = computed(() => !!props.query.groupBy?.[0]?.field && !['kanban', 'agenda'].includes(props.query.layout ?? 'list'))

function moved(saved: ObjectSummary) {
  const index = results.value.findIndex((o) => o.id === saved.id)
  if (index >= 0) results.value[index] = { ...saved, preview: results.value[index]!.preview }
  else if (kept.has(saved.id)) kept.set(saved.id, saved)
  void load()
}

// Completion feedback (lib/completion-feedback.ts), per query instance: a task marked Done here
// saves, then stays in place, checked and struck, through the background re-runs; only a fresh
// view (a reload, the query's own definition changing) drops it. The query no longer returns it,
// so its latest row is kept here and merged back where it was. A query spans types; only
// task-type objects are retained. An agenda keeps its own completions (AgendaView), which list no
// rows here, so nothing is ever kept for one.
const kept = reactive(new Map<Id, ObjectSummary>())
function replaceRow(object: ObjectRecord | ObjectSummary) {
  const index = results.value.findIndex((o) => o.id === object.id)
  const preview = index >= 0 ? results.value[index]!.preview : kept.get(object.id)?.preview ?? ''
  const row = { ...object, preview } as ObjectSummary
  if (completion.entries.has(object.id) || kept.has(object.id)) kept.set(object.id, row)
  if (index >= 0) results.value[index] = row
}
const completion = createCompletionFeedback({
  type: (object) => typesById.value.get(object.typeId),
  rows: () => display.value,
  replace: replaceRow,
  save: setProperties,
  failed: (retry) => {
    notice.value = { message: 'The task was not saved. Try again.', action: { label: 'Retry', run: () => retry().catch(() => {}) } }
  },
})
provide(COMPLETION_FEEDBACK, completion)
const stopSaves = onObjectSave((object, base) => completion.observe(object, base))
onBeforeUnmount(stopSaves)
// The query's own definition changing is a fresh view: what it kept goes with it.
watch(() => [JSON.stringify(props.query), props.parentId], () => {
  completion.clear()
  kept.clear()
}, { flush: 'sync' })

/** The query's rows plus the tasks it kept after a completion, back where they were. */
const display = computed(() => {
  const missing = [...kept.keys()].filter((id) => !results.value.some((object) => object.id === id)).map((id) => kept.get(id)!)
  return completion.pin([...results.value, ...missing])
})

/** An open task's quick actions, in its menu (a long press on a phone); none where nothing changes. */
function quickItems(object: ObjectSummary): MenuItem[] {
  if (props.readonly) return []
  const type = typesById.value.get(object.typeId)
  const items = [
    ...(completion.entries.has(object.id) ? [] : quickActionMenuItems(type, object, { save: async (id, values) => moved({ ...(await setProperties(id, values)), preview: '' }) })),
    ...subtaskMenuItems(type, object, (saved) => moved({ ...saved, preview: '' })),
  ]
  return items.length ? [{ kind: 'separator' }, ...items] : []
}

function objectMenu(event: MouseEvent, object: ObjectSummary) {
  openContextMenu(event, [
    { kind: 'heading', label: displayTitle(object, typesById.value.get(object.typeId)) },
    { label: 'Open', icon: 'ph:arrow-square-out', run: () => openObject(object.id, { where: 'type' }) },
    { label: 'Copy link to page', icon: 'ph:link', run: () => copyObjectLink(object.id) },
    pinMenu(object.id),
    ...quickItems(object),
  ])
}

/** The query ran and nothing matched (an agenda is never empty: it says "Nothing planned"); a kept completion still counts. */
const empty = computed(() => !loading.value && !failed.value && !isAgenda.value && !display.value.length)

defineExpose({ count: computed(() => display.value.length), empty })
</script>

<template>
  <div>
    <p v-if="loading" class="py-3 text-sm text-ink-faint">Loading…</p>
    <p v-else-if="failed && !isAgenda" class="py-3 text-sm text-red-600">Could not run this query.</p>
    <p v-else-if="!display.length && !isAgenda" class="py-3 text-sm text-ink-faint">No objects match this query.</p>
    <template v-else>
      <ObjectCollection
        :objects="!grouped && limit && !showAll ? display.slice(0, limit) : display"
        :initial-limit="grouped && !showAll ? limit : undefined"
        :layout="query.layout ?? 'list'"
        :group-field="query.groupBy?.[0]?.field ?? ''"
        :fold-scope="foldScope"
        :type-ids="query.typeIds"
        :table="query.table"
        :board="query.board"
        :list="query.list"
        :manual="!query.sort?.length"
        :agenda="query.agenda"
        :filter="query.filter"
        :parent-id="parentId"
        :open-in="query.openIn"
        :quick-actions="query.quickActions"
        :flat="query.flat"
        :readonly="readonly"
        :bare="bare"
        @table="emit('table', $event)"
        @board="emit('board', $event)"
        @moved="moved({ ...$event, preview: '' })"
        @menu="objectMenu"
      />
      <button v-if="limit && display.length > limit && !showAll && !isAgenda" class="mt-2 text-xs text-ink-faint hover:text-ink" @click="showAll = true">
        Show all {{ display.length }}
      </button>
    </template>
  </div>
</template>
