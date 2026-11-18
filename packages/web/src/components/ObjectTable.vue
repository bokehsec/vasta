<script setup lang="ts">
// The table layout of ObjectCollection: fixed column widths (resized by dragging a header's edge),
// the last, empty column taking the space left, one body per group. Editing in the table: a click
// anywhere on a property's cell (or Enter on it) opens its editor there, one cell at a time; the
// related objects' chips and links in it do not navigate then. In a query embedded in a page,
// presses in a cell stay out of the page editor, which would select the embed and lose track of the
// document. A value shows as soon as it is picked (`edits`) and is saved like the object page
// saves it; only the latest edit of a cell clears it, so quick changes do not flicker back.
import { computed, nextTick, ref, watch } from 'vue'
import type { Id, ObjectRecord, ObjectSummary, PropertyDef, PropertyValue, SelectOption, TableSettings } from '@vasta/core'
import { addSelectOption, setProperties, setProperty } from '../lib/actions.ts'
import { columnWidth, MIN_COLUMN_WIDTH, QUICK_ACTIONS_COLUMN, tableColumns, tableSettings, type Column } from '../lib/columns.ts'
import { useRowTypes, type Section } from '../lib/collection-rows.ts'
import { displayTitle } from '../lib/format.ts'
import type { Group } from '../lib/query.ts'
import { lastError } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import FieldValue from './FieldValue.vue'
import GroupHeading from './GroupHeading.vue'
import ObjectLink from './ObjectLink.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'
import ShowMore from './ShowMore.vue'
import StepProgress from './StepProgress.vue'
import TaskCompletionCheck from './TaskCompletionCheck.vue'
import TaskCompletionNote from './TaskCompletionNote.vue'
import TaskQuickActions from './TaskQuickActions.vue'

const props = defineProps<{
  sections: Section[]
  /** The field the groups are by; '' for no grouping. */
  groupField: string
  addable: boolean
  /** The columns drawn (a phone's Quick actions column is left out: its buttons are under the title). */
  columns: Column[]
  actionsUnderTitle: boolean
  table?: TableSettings | undefined
  typeIds: Id[]
  readonly?: boolean | undefined
  bare?: boolean | undefined
  /** More of a group are drawn when its end comes near. */
  auto: boolean
}>()
const emit = defineEmits<{
  menu: [event: MouseEvent, object: ObjectSummary]
  moved: [object: ObjectRecord]
  table: [table: TableSettings]
  toggle: [group: Group]
  add: [group: Group]
  more: [group: Group]
}>()

const { completion, typeOf, actionType, titleClass, progressOf } = useRowTypes(() => props.readonly)
const shown = (section: Section) => section.group.items.slice(0, section.limit)

// A column being resized shows its new width until the settings come back saved.
const resized = ref<Record<string, number>>({})
watch(() => props.table, () => (resized.value = {}))
const widthOf = (column: Column) => resized.value[column.field] ?? columnWidth(column)
const tableWidth = computed(() => props.columns.reduce((sum, c) => sum + widthOf(c), 0))

function startResize(event: PointerEvent, column: Column) {
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startWidth = widthOf(column)
  const move = (e: PointerEvent) => (resized.value = { ...resized.value, [column.field]: Math.max(MIN_COLUMN_WIDTH, startWidth + e.clientX - startX) })
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    const width = resized.value[column.field]
    if (width === undefined || width === startWidth) return
    emit('table', tableSettings(tableColumns(props.table, props.typeIds).map((c) => (c.field === column.field ? { ...c, width } : c))))
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

const EDITABLE = new Set<PropertyDef['kind']>(['text', 'url', 'number', 'checkbox', 'date', 'select', 'relation', 'person'])
const editable = (column: Column) => !props.readonly && !!column.def && EDITABLE.has(column.def.kind)
const cellKey = (object: ObjectSummary, column: Column) => `${object.id} ${column.field}`
const editing = ref('')
const edits = ref<Record<string, PropertyValue | null>>({})
const latest = new Map<string, number>()
let saves = 0
const container = ref<HTMLElement | null>(null)
const valueOf = (object: ObjectSummary, column: Column) => {
  const key = cellKey(object, column)
  return key in edits.value ? (edits.value[key] ?? undefined) : object.props[column.field]
}
const editedOf = (object: ObjectSummary, column: Column) => (cellKey(object, column) in edits.value ? { value: valueOf(object, column) } : undefined)

function startEdit(object: ObjectSummary, column: Column) {
  if (!editable(column)) return
  // A checkbox has nothing to open: a click toggles it.
  if (column.def?.kind === 'checkbox') {
    const value = valueOf(object, column)
    void saveCell(object, column, { kind: 'checkbox', value: !(value?.kind === 'checkbox' && value.value) })
  } else editing.value = cellKey(object, column)
}

/** A click in a cell edits it, except on a link out (a URL's address), which opens as before. */
function cellClick(event: MouseEvent, object: ObjectSummary, column: Column) {
  if ((event.target as Element).closest('a[target="_blank"]')) return
  event.preventDefault()
  startEdit(object, column)
}

/** Editing ended; the focus goes back to the cell when nothing else took it (Enter, Escape). */
function endEdit(key: string) {
  if (editing.value !== key) return
  editing.value = ''
  void nextTick(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    container.value?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key)}"]`)?.focus()
  })
}

async function saveCell(object: ObjectSummary, column: Column, value: PropertyValue | undefined) {
  const key = cellKey(object, column)
  const save = ++saves
  latest.set(key, save)
  edits.value = { ...edits.value, [key]: value ?? null }
  try {
    const saved = await setProperty(object.id, column.field, value)
    if (latest.get(key) === save) emit('moved', saved)
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    if (latest.get(key) === save) {
      latest.delete(key)
      const { [key]: _done, ...rest } = edits.value
      edits.value = rest
    }
  }
}

function addOption(object: ObjectSummary, column: Column, option: SelectOption) {
  const type = typeOf(object)
  if (type) void addSelectOption(type, column.field, option).catch((error) => (lastError.value = (error as Error).message))
}

/** A row's own buttons save through here; a failure is left to reach the runner, which says so and skips the success notice. */
async function saveQuick(object: ObjectSummary, values: Record<Id, PropertyValue | undefined>) {
  emit('moved', await setProperties(object.id, values))
}
</script>

<template>
  <!-- Table: fixed column widths; the last, empty column takes the space left. -->
  <!-- Grouped or not, a page's table sits in the same box, its groups' headings rows inside it. -->
  <div ref="container" class="overflow-x-auto" :class="bare ? '' : 'rounded-xl border border-line'">
    <table class="table-fixed text-sm" :style="{ width: `max(100%, ${tableWidth}px)` }">
      <colgroup>
        <col v-for="column in columns" :key="column.field" :style="{ width: `${widthOf(column)}px` }" />
        <col />
      </colgroup>
      <thead class="text-left text-xs text-ink-faint">
        <tr>
          <th v-for="column in columns" scope="col" :key="column.field" class="relative px-3 py-2 font-medium" :class="bare ? 'first:pl-0' : ''" :data-column="column.field">
            <span class="block truncate">{{ column.field === 'title' ? 'Title' : column.label }}</span>
            <span class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-accent/30" title="Drag to resize" @pointerdown.prevent="startResize($event, column)" />
          </th>
          <th />
        </tr>
      </thead>
      <tbody v-for="(section, index) in sections" :key="section.group.key">
        <tr v-if="groupField" :class="bare ? '' : 'border-t border-line bg-hover/40'">
          <th :colspan="columns.length + 1" scope="rowgroup" class="text-left font-normal" :class="bare ? ['pb-3', index ? 'pt-6' : 'pt-3'] : 'px-1.5 py-1.5'">
            <GroupHeading :group="section.group" :field="groupField" :collapsed="section.collapsed" :addable="addable" @toggle="emit('toggle', section.group)" @add="emit('add', section.group)" />
          </th>
        </tr>
        <template v-if="!section.collapsed">
          <tr v-for="object in shown(section)" :key="object.id" class="group/row border-t border-line hover:bg-hover/60" @contextmenu="emit('menu', $event, object)">
            <td v-for="column in columns" :key="column.field" class="overflow-hidden px-3 py-2 align-top" :class="[column.wrap ? 'break-words' : 'whitespace-nowrap text-ellipsis', bare ? 'first:pl-0' : '']">
              <template v-if="column.field === 'title'">
                <TaskCompletionCheck v-if="typeOf(object)?.system === 'task' && !readonly && completion" :object="object" :type="typeOf(object)" class="mr-2 inline-grid align-middle" @moved="emit('moved', $event)" />
                <ObjectLink :id="object.id" class="font-medium hover:underline">
                  <AppIcon v-if="typeOf(object)?.system !== 'task'" :icon="object.icon ?? typeOf(object)?.icon" fallback="ph:file-text" class="mr-2 inline-block align-[-2px] text-ink-soft" /><span :class="titleClass(object)">{{ displayTitle(object, typeOf(object)) }}</span>
                </ObjectLink>
                <TaskCompletionNote :object="object" class="mt-1" />
                <StepProgress v-if="progressOf(object)" :progress="progressOf(object)!" class="ml-2" />
                <TaskQuickActions v-if="actionsUnderTitle && actionType(object)" :type="actionType(object)!" :object="object" variant="row" class="-mb-1 mt-0.5 -ml-1.5" @set="saveQuick(object, $event)" />
              </template>
              <template v-else-if="column.field === QUICK_ACTIONS_COLUMN">
                <TaskQuickActions v-if="actionType(object)" :type="actionType(object)!" :object="object" variant="row" class="-my-1.5 -ml-1.5" @set="saveQuick(object, $event)" />
              </template>
              <PropertyValueEditor
                v-else-if="column.def && editing === cellKey(object, column)"
                :def="column.def"
                :value="valueOf(object, column)"
                autofocus
                class="-mx-2 -my-1.5"
                @update="saveCell(object, column, $event)"
                @add-option="addOption(object, column, $event)"
                @close="endEdit(cellKey(object, column))"
                @mousedown.stop
              />
              <div
                v-else-if="column.def && editable(column)"
                role="button"
                tabindex="0"
                class="-mx-1.5 -my-0.5 min-h-6 cursor-pointer rounded-md px-1.5 py-0.5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/50"
                :class="column.wrap ? '' : 'overflow-hidden'"
                :aria-label="`${column.label}: edit`"
                :data-edit="column.field"
                :data-cell="cellKey(object, column)"
                @mousedown.stop
                @click.capture="cellClick($event, object, column)"
                @keydown.enter.self.prevent="startEdit(object, column)"
                @keydown.space.self.prevent="startEdit(object, column)"
              >
                <FieldValue :object="object" :field="column.field" :def="column.def" :wrap="column.wrap" :edited="editedOf(object, column)" />
              </div>
              <FieldValue v-else :object="object" :field="column.field" :def="column.def" :wrap="column.wrap" />
            </td>
            <td />
          </tr>
          <tr v-if="section.group.items.length > section.limit">
            <td :colspan="columns.length + 1">
              <ShowMore :key="shown(section).length" :shown="shown(section).length" :total="section.group.items.length" :auto="auto" @more="emit('more', section.group)" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
