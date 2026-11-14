<script setup lang="ts">
// A set of objects shown in one of the view layouts (list, table, wall, grid, gallery, board,
// agenda), optionally grouped. Used by type pages, query pages and queries embedded in documents.
import { computed, nextTick, onBeforeUnmount, provide, ref, watch, type Directive } from 'vue'
import type { AgendaSettings, BoardSettings, FilterGroup, Id, ListSettings, ObjectRecord, ObjectSummary, ObjectType, PropertyDef, PropertyValue, SelectOption, TableSettings, ViewLayout, ViewOpenIn } from '@vasta/core'
import { newId, isClosedTask, nextStepFieldOf, outlineRows, parentFieldOf, parentIdOf, quickActionsOf, subtaskProgress, type OutlineRow, type QuickActionDef } from '@vasta/core'
import { addSelectOption, setProperties, setProperty } from '../lib/actions.ts'
import { isDone, setTaskDone } from '../lib/calendar.ts'
import { chip } from '../lib/colors.ts'
import { columnWidth, listFields, MIN_COLUMN_WIDTH, QUICK_ACTIONS_COLUMN, rowFields, rowFieldsFromTable, tableColumns, tableSettings, type Column } from '../lib/columns.ts'
import { displayTitle, formatDate, formatDateShort, formatRelative } from '../lib/format.ts'
import { groupObjects, NO_VALUE, typesOf, type Group } from '../lib/query.ts'
import { lastError, summaryOf, typesById } from '../lib/state.ts'
import { objectColor } from '../lib/tags.ts'
import { runQuickAction } from '../lib/quick-actions.ts'
import { clearSelection, isSelected, isSelecting, pruneSelection, rememberMenuOwner, selection, toggleSelected, type SelectionOwner } from '../lib/selection.ts'
import { foldedSteps as folded, subtasksOf } from '../lib/subtasks.ts'
import { hideSwipeTip, swipeTipHidden } from '../lib/tips.ts'
import { isPhone, isTouch } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import AgendaView from './AgendaView.vue'
import BoardView from './BoardView.vue'
import TypeIcon from './TypeIcon.vue'
import ObjectCard from './ObjectCard.vue'
import ObjectChip from './ObjectChip.vue'
import PersonChip from './PersonChip.vue'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'
import ObjectLink from './ObjectLink.vue'
import SwipeRow, { type SwipeAction } from './SwipeRow.vue'
import TaskQuickActions from './TaskQuickActions.vue'
import { VIEW_OPENS } from '../lib/open.ts'

const props = defineProps<{
  objects: ObjectSummary[]
  layout: ViewLayout
  /** Field to group by; '' for no grouping. */
  groupField: string
  /** Types the objects come from (empty = any); decides table columns and group labels. */
  typeIds: Id[]
  /** Columns of the table layout, as saved on the view or query. */
  table?: TableSettings
  /** The board layout's settings, and whether its cards keep their manual order (no sort chosen). */
  board?: BoardSettings
  /** The list layout's rows, as saved on the view or query; unset: tags and the last change. */
  list?: ListSettings
  manual?: boolean
  /** The agenda layout's settings; it shows what the filter selects from the calendar feed, not `objects` (parentId: the object a query is embedded in). */
  agenda?: AgendaSettings
  filter?: FilterGroup
  parentId?: Id
  /** Where a click on an object opens it, as saved on the view or query; unset: as its type says. */
  openIn?: ViewOpenIn
  /** Shown where nothing should change (a whiteboard card, a page that cannot be edited): property cells do not edit. */
  readonly?: boolean
  /** Task rows show their quick actions (list and table layouts), as saved on the view or query. */
  quickActions?: boolean
  /** On a phone a table is drawn as rows, unless this is set ("Show as table on this phone"). */
  phoneTable?: boolean
  /** Steps listed flat, not nested under their parent (types with subtasks). */
  flat?: boolean
}>()
const emit = defineEmits<{
  menu: [event: MouseEvent, object: ObjectSummary]
  moved: [object: ObjectRecord]
  created: [object: ObjectRecord]
  table: [table: TableSettings]
  board: [board: BoardSettings]
  manual: []
  /** Objects moved to the trash from the bulk bar. */
  trashed: [ids: Id[]]
}>()

const types = computed(() => typesOf(props.typeIds))
const typeOf = (object: ObjectSummary) => typesById.value.get(object.typeId)
// Where links inside open, for every link, card and relation chip (lib/open.ts, VIEW_OPENS): the
// view's choice, else the type's of the object linked, else its page.
provide(VIEW_OPENS, (id) => props.openIn ?? typesById.value.get(summaryOf(id)?.typeId ?? '')?.openIn)
const groups = computed<Group[]>(() => groupObjects(props.objects, props.groupField, types.value))

// A group shows its first STEP objects, and more as the page scrolls to its end: drawing a type's
// thousands of objects at once takes seconds. Sorting, grouping and filters still see them all.
const STEP = 200
const drawn = ref<Record<string, number>>({})
watch([() => props.typeIds.join(), () => props.groupField], () => (drawn.value = {}))
const shown = (group: Group) => group.items.slice(0, drawn.value[group.key] ?? STEP)

// Subtasks (core subtasks.ts): in a list, a step follows its parent, indented (four levels at most),
// and a parent's caret folds its steps (for the session). Any object with steps shows how many are
// done ("2/5", counting every step, also those the filter leaves out) and "Ready to close" once all
// are; a step whose parent is not listed stays at the top with the parent's name under it.
const nests = computed(() => asList.value && !props.flat && types.value.some((t) => !!parentFieldOf(t)))
const parentIdFor = (object: ObjectSummary) => parentIdOf(typeOf(object), object)
function rowsOf(group: Group): OutlineRow<ObjectSummary>[] {
  if (!nests.value) return shown(group).map((object) => ({ object, depth: 0, hasChildren: false }))
  const rows: OutlineRow<ObjectSummary>[] = []
  let foldedAt = Infinity
  for (const row of outlineRows(group.items, parentIdFor)) {
    if (row.depth > foldedAt) continue
    foldedAt = row.hasChildren && folded.has(row.object.id) ? row.depth : Infinity
    rows.push(row)
  }
  return rows.slice(0, drawn.value[group.key] ?? STEP)
}
const outlined = (group: Group) => nests.value && group.items.some((o) => parentIdFor(o) && group.items.some((p) => p.id === parentIdFor(o)))
/** How far an object's steps are, when it has any. */
function progressOf(object: ObjectSummary) {
  const type = typeOf(object)
  if (!parentFieldOf(type)) return undefined
  const steps = subtasksOf(type, object.id)
  return steps.length ? subtaskProgress(type, object, steps) : undefined
}
/** The name of a listed step's parent when the parent itself is not in the list. */
function absentParent(object: ObjectSummary): string {
  const id = nests.value ? parentIdFor(object) : undefined
  if (!id || props.objects.some((o) => o.id === id)) return ''
  const parent = summaryOf(id)
  return parent ? displayTitle(parent, typeOf(parent)) : ''
}
const drawMore = (group: Group) => (drawn.value = { ...drawn.value, [group.key]: (drawn.value[group.key] ?? STEP) + STEP })
/** Calls its value when the element comes near the viewport (it is keyed, so it asks again after each step). */
const vNear: Directive<HTMLElement & { near?: IntersectionObserver }, () => void> = {
  mounted(el, binding) {
    if (typeof IntersectionObserver === 'undefined') return
    el.near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && binding.value(), { rootMargin: '600px' })
    el.near.observe(el)
  },
  unmounted: (el) => el.near?.disconnect(),
}

// Table columns; a column being resized shows its new width until the settings come back saved.
const resized = ref<Record<string, number>>({})
watch(() => props.table, () => (resized.value = {}))
// On a phone the Quick actions column leaves the table and its buttons go under each title, where
// they can be reached without scrolling sideways.
const shownColumns = computed(() => tableColumns(props.table, props.typeIds).filter((c) => !c.hidden))
const actionsUnderTitle = computed(() => isPhone.value && shownColumns.value.some((c) => c.field === QUICK_ACTIONS_COLUMN))
// On a phone a table is drawn as list rows (no sideways scrolling): its shown columns become the
// row's fields, its Quick actions column the row's actions and next step line.
const phoneRows = computed(() => isPhone.value && props.layout === 'table' && !props.phoneTable)
const asList = computed(() => props.layout === 'list' || phoneRows.value)
const columns = computed(() => (actionsUnderTitle.value ? shownColumns.value.filter((c) => c.field !== QUICK_ACTIONS_COLUMN) : shownColumns.value))
const widthOf = (column: Column) => resized.value[column.field] ?? columnWidth(column)
const tableWidth = computed(() => columns.value.reduce((sum, c) => sum + widthOf(c), 0))

// Quick actions on rows (TaskQuickActions), for triage: in the table a column like any other
// (lib/columns.ts), in the list at the end of the row when the view or query turns them on (on a
// line of their own in a narrow column), with a task's next step under its title. They save as a
// table cell does. Any type with quick actions gets them; a task's next step line is tasks only.
const actionableTypes = computed(() => new Set([...typesById.value.values()].filter((t) => quickActionsOf(t).length).map((t) => t.id)))
const actionType = (object: ObjectSummary): ObjectType | undefined => {
  const type = props.readonly ? undefined : typeOf(object)
  return type && actionableTypes.value.has(type.id) ? type : undefined
}
const quickType = (object: ObjectSummary) => (props.quickActions || (phoneRows.value && actionsUnderTitle.value) ? actionType(object) : undefined)
const nextStepOf = (object: ObjectSummary) => {
  const field = nextStepFieldOf(quickType(object))
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'text' ? value.value : ''
}

// Swipes on a touch screen (SwipeRow): right runs the type's Defer (else its first action), left
// uncovers the others, Done first, and More (the row's menu). On a phone they replace the row's
// buttons; a tablet keeps both.
/** The type whose swipes this row has on touch, selecting or not. */
const swipeable = (object: ObjectSummary) => {
  const type = isTouch.value ? actionType(object) : undefined
  return type && !isClosedTask(type, object) ? type : undefined
}
/** Swipes are off while selecting here (a tap picks the row). */
const swipeType = (object: ObjectSummary) => (selectingHere.value ? undefined : swipeable(object))
const rightActionOf = (actions: QuickActionDef[]) => actions.find((a) => a.id === 'defer') ?? actions[0]
const saveRow = async (id: Id, values: Record<Id, PropertyValue | undefined>) => emit('moved', await setProperties(id, values))
function swipeAction(type: ObjectType, object: ObjectSummary, action: QuickActionDef): SwipeAction {
  return { id: action.id, label: action.name, icon: action.icon, tone: action.id === 'done' ? 'done' : action.id === 'defer' ? 'accent' : 'neutral', run: () => runQuickAction(type, object, action, { save: saveRow }) }
}
function swipeRight(object: ObjectSummary): SwipeAction | undefined {
  const type = swipeType(object)
  const action = type && rightActionOf(quickActionsOf(type))
  return type && action ? swipeAction(type, object, action) : undefined
}
function swipeLeft(object: ObjectSummary): SwipeAction[] {
  const type = swipeType(object)
  if (!type) return []
  const actions = quickActionsOf(type)
  const right = rightActionOf(actions)
  const rest = actions.filter((a) => a !== right).sort((a, b) => Number(b.id === 'done') - Number(a.id === 'done'))
  const more: SwipeAction = {
    id: 'more',
    label: 'More',
    icon: { kind: 'icon', value: 'ph:dots-three' },
    tone: 'more',
    run: (anchor) => {
      const box = anchor?.getBoundingClientRect()
      rowMenu(new MouseEvent('contextmenu', { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 }), object)
    },
  }
  return [...rest.slice(0, 3).map((a) => swipeAction(type, object, a)), more]
}
// Selection (lib/selection.ts): a box at the start of a row (on hover; always while anything is
// selected here), Shift-click for a range in the order drawn; while selecting, a click or tap on a
// row picks it instead of opening it (⌘/Ctrl-click still opens), and swipes are off.
const selKey = newId()
const owner: SelectionOwner = {
  drawn: () => groups.value.flatMap((group) => (asList.value ? rowsOf(group).map((r) => r.object) : shown(group))),
  all: () => props.objects,
  pickable: (object) => {
    const type = actionType(object)
    return !type || !isClosedTask(type, object)
  },
  moved: (object) => emit('moved', object),
  trashed: (ids) => emit('trashed', ids),
}
const canSelect = computed(() => !props.readonly && (asList.value || props.layout === 'table'))
const selectingHere = computed(() => isSelecting(selKey))
const picked = (object: ObjectSummary) => isSelected(selKey, object.id)
function pick(event: MouseEvent, object: ObjectSummary) {
  toggleSelected(selKey, object.id, owner, event.shiftKey)
}
/** A click on a row while selecting picks it (the row's link does not open). */
function rowClick(event: MouseEvent, object: ObjectSummary) {
  if (!selectingHere.value || event.metaKey || event.ctrlKey) return
  event.preventDefault()
  pick(event, object)
}
function rowMenu(event: MouseEvent, object: ObjectSummary) {
  if (canSelect.value) rememberMenuOwner(selKey, owner)
  emit('menu', event, object)
}
onBeforeUnmount(() => selection.key === selKey && clearSelection())
// What is picked must stay what is shown: ids no longer among the objects (a filter, another view, a
// sync) are dropped, and a layout without selection (board, agenda, cards) ends it.
watch([() => props.objects, () => props.objects.length], () => selection.key === selKey && pruneSelection())
watch(canSelect, (can) => !can && selection.key === selKey && clearSelection())

/** On a phone the row's own buttons give way to swipes, also while selecting (the rows keep their height). */
const rowButtons = (object: ObjectSummary) => !!quickType(object) && !(isPhone.value && swipeable(object))
/** Shown once per device over the first list with swipeable rows on a phone. */
const swipeTip = computed(() => {
  if (!isPhone.value || !asList.value || swipeTipHidden.value) return ''
  const object = props.objects.find((o) => swipeType(o))
  const right = object && swipeRight(object)
  return right ? `Swipe right to ${right.label.toLowerCase()}, left for more` : ''
})

/** A row's own buttons save through here; a failure is left to reach the runner, which says so and skips the success notice. */
async function saveQuick(object: ObjectSummary, values: Record<Id, PropertyValue | undefined>) {
  emit('moved', await setProperties(object.id, values))
}

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
// Editing in the table: a click anywhere on a property's cell (or Enter on it) opens its editor
// there, one cell at a time; the related objects' chips and links in it do not navigate then. In a
// query embedded in a page, presses in a cell stay out of the page editor, which would select the
// embed and lose track of the document. A value shows as soon as it is picked (`edits`) and is saved like the object page
// saves it; only the latest edit of a cell clears it, so quick changes do not flicker back.
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

// List rows: with fields chosen, each row shows those after its title, and a task gets a checkbox.
const listColumns = computed(() => (phoneRows.value ? rowFieldsFromTable(shownColumns.value) : props.list?.fields ? listFields(props.list, props.typeIds) : undefined))
/** A table drawn as rows shows the first four of its fields that have a value. */
const fieldsOf = (object: ObjectSummary) => {
  const fields = rowFields(object, typeOf(object), listColumns.value ?? [])
  return phoneRows.value ? fields.slice(0, 4) : fields
}
const isDoneTask = (object: ObjectSummary) => isDone(typeOf(object), object.props.status?.kind === 'select' ? object.props.status.value : undefined)

async function toggleDone(object: ObjectSummary) {
  try {
    const saved = await setTaskDone(object.id, typeOf(object), !isDoneTask(object))
    if (saved) emit('moved', saved)
  } catch (error) {
    lastError.value = (error as Error).message
  }
}

const cardVariant = computed(() => (props.layout === 'wall' || props.layout === 'embed' ? 'wall' : props.layout === 'gallery' ? 'gallery' : 'grid'))

</script>

<template>
  <!-- Board -->
  <BoardView
    v-if="layout === 'kanban'"
    :objects="objects"
    :group-field="groupField"
    :type-ids="typeIds"
    :board="board"
    :manual="manual ?? true"
    @menu="(event, object) => emit('menu', event, object)"
    @moved="emit('moved', $event)"
    @created="emit('created', $event)"
    @board="emit('board', $event)"
    @manual="emit('manual')"
  />

  <!-- Agenda: reads the calendar feed itself; grouping and sort do not apply. -->
  <AgendaView v-else-if="layout === 'agenda'" :type-ids="typeIds" :filter="filter" :agenda="agenda" :parent-id="parentId" :readonly="readonly" />

  <!-- Container queries: the same view sits in a full page or in a narrow document column. -->
  <div v-else ref="container" class="@container">
    <p v-if="swipeTip" class="mb-3 flex items-center gap-2 rounded-lg border border-line bg-raised py-1 pl-3 text-[13px] text-ink-soft" data-swipe-tip>
      <AppIcon fallback="ph:hand-swipe-right" :size="16" class="shrink-0" /><span class="flex-1">{{ swipeTip }}</span>
      <button class="grid h-11 w-11 shrink-0 place-items-center text-ink-faint hover:text-ink" aria-label="Hide this tip" @click="hideSwipeTip"><AppIcon fallback="ph:x" :size="14" /></button>
    </p>
    <section v-for="group in groups" :key="group.key" class="mt-4 first:mt-0">
      <header v-if="groupField" class="mb-3 flex items-center gap-2 text-sm">
        <span v-if="group.objectId"><ObjectChip :id="group.objectId" :tag="groupField === 'tags'" /></span>
        <PersonChip v-else-if="group.personId" :id="group.personId" />
        <span v-else class="rounded-md px-2 py-0.5 font-medium" :class="group.key === NO_VALUE ? 'text-ink-faint' : chip(group.color as never)">{{ group.label }}</span>
        <span class="text-xs text-ink-faint">{{ group.items.length }}</span>
      </header>

      <!-- List; on a phone a table too. -->
      <div v-if="asList" class="divide-y divide-line/70" :data-phone-rows="phoneRows || undefined">
        <SwipeRow v-for="{ object, depth, hasChildren } in rowsOf(group)" :key="object.id" :enabled="!!swipeType(object)" :right="swipeRight(object)" :left="swipeLeft(object)">
          <ObjectLink
            :id="object.id"
            class="group/row flex items-center gap-3 rounded-lg px-2 py-2 max-md:py-2.5"
            :class="[listColumns ? 'flex-wrap gap-y-1 @2xl:flex-nowrap' : quickType(object) ? 'flex-wrap gap-y-1 @md:flex-nowrap' : absentParent(object) ? 'flex-wrap gap-y-0.5' : '', picked(object) ? 'bg-accent/10' : 'hover:bg-hover']"
            :style="depth ? { paddingLeft: `${0.5 + Math.min(depth, 4) * 1.5}rem` } : undefined"
            :data-depth="nests ? depth : undefined"
            :data-selected="picked(object) || undefined"
            @click="rowClick($event, object)"
            @contextmenu="rowMenu($event, object)"
          >
            <!-- The selection box: on hover (a mouse), always while selecting here. -->
            <button
              v-if="canSelect && (selectingHere || !isTouch)"
              class="relative -mr-1 grid h-4 w-4 shrink-0 place-items-center rounded border text-white [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-3.5 [@media(hover:none)]:after:content-['']"
              :class="[picked(object) ? 'border-accent bg-accent' : 'border-line-strong bg-surface', selectingHere ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100']"
              role="checkbox"
              :aria-checked="picked(object)"
              :aria-label="`Select ${displayTitle(object, typeOf(object))}`"
              data-select-row
              @click.prevent.stop="pick($event, object)"
            >
              <AppIcon v-if="picked(object)" fallback="ph:check-bold" :size="11" />
            </button>
            <!-- A parent's caret folds its steps; rows of an outline keep its place free. -->
            <button
              v-if="hasChildren"
              class="relative -mx-1 grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-line hover:text-ink [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-3 [@media(hover:none)]:after:content-['']"
              :aria-expanded="!folded.has(object.id)"
              :title="folded.has(object.id) ? 'Show subtasks' : 'Hide subtasks'"
              data-fold-steps
              @click.prevent.stop="folded.has(object.id) ? folded.delete(object.id) : folded.add(object.id)"
            >
              <AppIcon :fallback="folded.has(object.id) ? 'ph:caret-right' : 'ph:caret-down'" :size="13" />
            </button>
            <span v-else-if="outlined(group)" class="-mx-1 w-5 shrink-0" aria-hidden="true" />
            <!-- On touch the checkbox's tap area reaches 44px around it. -->
            <button
              v-if="listColumns && typeOf(object)?.system === 'task'"
              class="relative shrink-0 rounded-full text-ink-soft enabled:hover:text-ink [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-3 [@media(hover:none)]:after:content-['']"
              :class="isDoneTask(object) ? 'text-accent' : ''"
              :disabled="readonly"
              :title="isDoneTask(object) ? 'Mark as to do' : 'Mark as done'"
              data-task-check
              @click.prevent.stop="toggleDone(object)"
            >
              <AppIcon :fallback="isDoneTask(object) ? 'ph:check-circle-fill' : 'ph:circle'" :size="18" />
            </button>
            <TypeIcon v-else :icon="object.icon ?? typeOf(object)?.icon" fallback="ph:file-text" :color="objectColor(object, typeOf(object))" />
            <span v-if="quickType(object)" class="min-w-0 flex-1">
              <span class="block font-medium max-md:text-base max-md:leading-snug" :class="list?.wrap || phoneRows ? 'break-words' : 'truncate'">{{ displayTitle(object, typeOf(object)) }}</span>
              <span v-if="nextStepOf(object)" class="mt-0.5 flex items-center gap-1 text-xs text-ink-soft max-md:text-[13px]" data-next-step-line>
                <AppIcon fallback="ph:arrow-right" :size="11" class="shrink-0 text-ink-faint" /><span class="truncate">{{ nextStepOf(object) }}</span>
              </span>
            </span>
            <span
              v-else
              class="min-w-0 flex-1 font-medium max-md:text-base max-md:leading-snug"
              :class="[list?.wrap || phoneRows ? 'break-words' : 'truncate', listColumns && typeOf(object)?.system === 'task' && isDoneTask(object) ? 'text-ink-faint line-through' : '']"
            >{{ displayTitle(object, typeOf(object)) }}</span>
            <span v-if="progressOf(object)" class="shrink-0 rounded-md border px-1.5 text-xs font-medium tabular-nums" :class="progressOf(object)!.readyToClose ? 'border-[var(--color-flow-done)]/40 text-[var(--color-flow-done)]' : 'border-line text-ink-soft'" data-step-progress>
              {{ progressOf(object)!.done }}/{{ progressOf(object)!.total }}<template v-if="progressOf(object)!.readyToClose"> · Ready to close</template>
            </span>
            <span v-if="absentParent(object)" class="order-last w-full truncate pl-[30px] text-xs text-ink-faint max-md:text-[13px]" data-absent-parent>in {{ absentParent(object) }}</span>
            <span v-if="listColumns" class="flex min-w-0 shrink-0 items-center gap-2 text-xs max-md:text-[13px] @max-2xl:order-last @max-2xl:w-full @max-2xl:flex-wrap @max-2xl:pl-[30px]" data-row-fields @click.prevent>
              <template v-for="field in fieldsOf(object)" :key="field.field">
                <span v-if="field.field === 'tags' || field.field === 'collections'" class="flex gap-1">
                  <ObjectChip v-for="id in field.field === 'tags' ? object.tagIds : object.collectionIds" :key="id" :id="id" :tag="field.field === 'tags'" />
                </span>
                <span v-else-if="field.field === 'type'" class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5" :class="chip(typeOf(object)?.color)">
                  <AppIcon :icon="typeOf(object)?.icon" fallback="ph:cube" :size="12" />{{ typeOf(object)?.name }}
                </span>
                <span v-else-if="field.field === 'createdAt' || field.field === 'updatedAt'" class="whitespace-nowrap text-ink-faint">{{ formatRelative(object[field.field]) }}</span>
                <span v-else-if="field.field === 'date'" class="whitespace-nowrap">{{ object.date ? formatDateShort(object.date) : '' }}</span>
                <span v-else-if="field.field === 'host'" class="whitespace-nowrap">{{ object.media?.host?.replace(/^www\./, '') }}</span>
                <PropertyDisplay v-else-if="field.def" :def="field.def" :value="object.props[field.field]" :object="object" :wrap="false" short />
              </template>
            </span>
            <template v-else>
              <span class="hidden gap-1 md:flex" @click.prevent>
                <ObjectChip v-for="id in object.tagIds.slice(0, 3)" :key="id" :id="id" tag />
              </span>
              <span v-if="!quickType(object)" class="w-24 shrink-0 text-right text-xs text-ink-faint">{{ formatRelative(object.updatedAt) }}</span>
            </template>
            <!-- In a narrow column the actions take a line of their own under the title; on a phone swipes replace them. -->
            <TaskQuickActions
              v-if="rowButtons(object)"
              :type="quickType(object)!"
              :object="object"
              variant="row"
              class="@max-md:order-last @max-md:w-full @max-md:pl-6"
              @set="saveQuick(object, $event)"
            />
          </ObjectLink>
        </SwipeRow>
      </div>

      <!-- Table: fixed column widths; the last, empty column takes the space left. -->
      <div v-else-if="layout === 'table'" class="overflow-x-auto rounded-xl border border-line">
        <table class="table-fixed text-sm" :style="{ width: `max(100%, ${tableWidth}px)` }">
          <colgroup>
            <col v-for="column in columns" :key="column.field" :style="{ width: `${widthOf(column)}px` }" />
            <col />
          </colgroup>
          <thead class="bg-raised text-left text-xs text-ink-faint">
            <tr>
              <th v-for="column in columns" :key="column.field" class="relative px-3 py-2 font-medium" :data-column="column.field">
                <span class="block truncate">{{ column.field === 'title' ? 'Title' : column.label }}</span>
                <span
                  class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-accent/30"
                  title="Drag to resize"
                  @pointerdown.prevent="startResize($event, column)"
                />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="object in shown(group)"
              :key="object.id"
              class="group/row border-t border-line"
              :class="picked(object) ? 'bg-accent/10' : 'hover:bg-hover/60'"
              :data-selected="picked(object) || undefined"
              @contextmenu="rowMenu($event, object)"
            >
              <td
                v-for="column in columns"
                :key="column.field"
                class="overflow-hidden px-3 py-2 align-top"
                :class="column.wrap ? 'break-words' : 'whitespace-nowrap text-ellipsis'"
              >
                <template v-if="column.field === 'title'">
                  <button
                    v-if="canSelect && (selectingHere || !isTouch)"
                    class="relative -ml-1 mr-2 inline-grid h-4 w-4 place-items-center rounded border align-[-3px] text-white"
                    :class="[picked(object) ? 'border-accent bg-accent' : 'border-line-strong bg-surface', selectingHere ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100']"
                    role="checkbox"
                    :aria-checked="picked(object)"
                    :aria-label="`Select ${displayTitle(object, typeOf(object))}`"
                    data-select-row
                    @click.prevent.stop="pick($event, object)"
                  >
                    <AppIcon v-if="picked(object)" fallback="ph:check-bold" :size="11" />
                  </button>
                  <ObjectLink :id="object.id" class="font-medium hover:underline" @click="rowClick($event, object)">
                    <AppIcon :icon="object.icon ?? typeOf(object)?.icon" fallback="ph:file-text" class="mr-2 inline-block align-[-2px] text-ink-soft" />{{ displayTitle(object, typeOf(object)) }}
                  </ObjectLink>
                  <span v-if="progressOf(object)" class="ml-2 rounded-md border px-1.5 text-xs font-medium tabular-nums" :class="progressOf(object)!.readyToClose ? 'border-[var(--color-flow-done)]/40 text-[var(--color-flow-done)]' : 'border-line text-ink-soft'" data-step-progress>
                    {{ progressOf(object)!.done }}/{{ progressOf(object)!.total }}<template v-if="progressOf(object)!.readyToClose"> · Ready to close</template>
                  </span>
                  <TaskQuickActions v-if="actionsUnderTitle && actionType(object)" :type="actionType(object)!" :object="object" variant="row" class="-mb-1 mt-0.5 -ml-1.5" @set="saveQuick(object, $event)" />
                </template>
                <span v-else-if="column.field === 'tags' || column.field === 'collections'" class="flex gap-1" :class="column.wrap ? 'flex-wrap' : 'overflow-hidden'">
                  <ObjectChip v-for="id in column.field === 'tags' ? object.tagIds : object.collectionIds" :key="id" :id="id" :tag="column.field === 'tags'" />
                </span>
                <span v-else-if="column.field === 'type'" class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs" :class="chip(typeOf(object)?.color)">
                  <AppIcon :icon="typeOf(object)?.icon" fallback="ph:cube" :size="12" />{{ typeOf(object)?.name }}
                </span>
                <span v-else-if="column.field === 'createdAt' || column.field === 'updatedAt'" class="text-xs text-ink-faint">{{ formatRelative(object[column.field]) }}</span>
                <span v-else-if="column.field === 'date'">{{ object.date ? formatDate(object.date) : '' }}</span>
                <span v-else-if="column.field === 'host'">{{ object.media?.host?.replace(/^www\./, '') }}</span>
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
                  <PropertyDisplay :def="column.def" :value="valueOf(object, column)" :object="object" :wrap="column.wrap" />
                </div>
                <PropertyDisplay v-else-if="column.def" :def="column.def" :value="object.props[column.field]" :object="object" :wrap="column.wrap" />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Wall: masonry columns -->
      <div v-else-if="cardVariant === 'wall'" class="columns-1 gap-3 @lg:columns-2 @4xl:columns-3 @7xl:columns-4">
        <ObjectCard v-for="object in shown(group)" :key="object.id" :object="object" :type="typeOf(object)" variant="wall" @contextmenu="emit('menu', $event, object)" />
      </div>

      <!-- Grid and gallery -->
      <div v-else class="grid gap-3" :class="cardVariant === 'gallery' ? 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]'">
        <ObjectCard v-for="object in shown(group)" :key="object.id" :object="object" :type="typeOf(object)" :variant="cardVariant" @contextmenu="emit('menu', $event, object)" />
      </div>

      <button
        v-if="group.items.length > shown(group).length"
        :key="shown(group).length"
        v-near="() => drawMore(group)"
        class="mt-2 w-full rounded-lg py-2 text-center text-xs text-ink-faint hover:bg-hover hover:text-ink"
        @click="drawMore(group)"
      >
        {{ shown(group).length.toLocaleString() }} of {{ group.items.length.toLocaleString() }} · Show more
      </button>
    </section>
  </div>
</template>
