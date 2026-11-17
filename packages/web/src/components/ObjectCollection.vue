<script setup lang="ts">
// A set of objects shown in one of the view layouts (list, table, wall, grid, gallery, board,
// agenda), optionally grouped. Used by type pages, query pages and queries embedded in documents.
// This holds what the layouts share: the groups and their folds, how many of each are drawn, and
// whether a table is drawn as rows (a phone); the table (ObjectTable), the rows (ObjectRows), the
// cards, the board and the agenda draw themselves.
import { computed, inject, provide, ref, watch } from 'vue'
import type { AgendaSettings, BoardSettings, FilterGroup, Id, ListSettings, ObjectRecord, ObjectSummary, TableSettings, ViewLayout, ViewOpenIn } from '@vasta/core'
import { parentFieldOf } from '@vasta/core'
import { COMPLETION_FEEDBACK } from '../lib/completion-feedback.ts'
import type { Section } from '../lib/collection-rows.ts'
import { listFields, QUICK_ACTIONS_COLUMN, rowFieldsFromTable, tableColumns } from '../lib/columns.ts'
import { startNew, useNewPlace } from '../lib/new-item.ts'
import { groupObjects, movableField, typesOf, type Group } from '../lib/query.ts'
import { summaryOf, typesById } from '../lib/state.ts'
import { foldKey, useGroupFolds } from '../lib/group-folds.ts'
import { quietButton } from '../lib/buttons.ts'
import { VIEW_OPENS } from '../lib/open.ts'
import { isPhone } from '../lib/viewport.ts'
import GroupHeading from './GroupHeading.vue'
import AgendaView from './AgendaView.vue'
import BoardView from './BoardView.vue'
import ObjectCard from './ObjectCard.vue'
import ObjectRows from './ObjectRows.vue'
import ObjectTable from './ObjectTable.vue'
import ShowMore from './ShowMore.vue'

const props = defineProps<{
  objects: ObjectSummary[]
  layout: ViewLayout
  /** Field to group by; '' for no grouping. */
  groupField: string
  /** Stable identity of this view or query instance (a path: `type/<id>/view/<id>`), for the person's own group and column folds. */
  foldScope?: string
  /** Preview rows per group; grouping and its counts still see every result. */
  initialLimit?: number
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
  /** Sits inside something that already frames it (a query embedded in a page, a whiteboard card):
   * the table draws no box of its own and its first column lines up with the text around it. */
  bare?: boolean
}>()
const emit = defineEmits<{
  menu: [event: MouseEvent, object: ObjectSummary]
  moved: [object: ObjectRecord]
  created: [object: ObjectRecord]
  table: [table: TableSettings]
  board: [board: BoardSettings]
  manual: []
}>()

const types = computed(() => typesOf(props.typeIds))
const typeOf = (object: ObjectSummary) => typesById.value.get(object.typeId)
// Where links inside open, for every link, card and relation chip (lib/open.ts, VIEW_OPENS): the
// view's choice, else the type's of the object linked, else a window over the page.
provide(VIEW_OPENS, (id) => props.openIn ?? typesById.value.get(summaryOf(id)?.typeId ?? '')?.openIn ?? 'popup')
const completion = inject(COMPLETION_FEEDBACK, undefined)
const groups = computed<Group[]>(() => {
  const actual = new Map(props.objects.map((object) => [object.id, object]))
  return groupObjects(props.objects.map((object) => completion?.placement(object) ?? object), props.groupField, types.value)
    .map((group) => ({ ...group, items: group.items.map((object) => actual.get(object.id)!) }))
})

const { folded: foldedGroups, toggle: toggleGroup, collapseAll, expandAll } = useGroupFolds(() => foldKey('folds', props.foldScope, props.groupField))
// A "+" on a group's header adds an item into that group, on a type page (lib/new-item.ts).
const newPlace = useNewPlace()
const addable = computed(() => !!newPlace && !props.readonly && props.typeIds.length === 1 && props.typeIds[0] === newPlace.typeId && movableField(props.groupField, types.value))
const addIn = (group: Group) => newPlace && startNew(newPlace.typeId, { groups: [{ field: props.groupField, group }] })
const groupCollapsed = (group: Group) => !!props.groupField && foldedGroups.value.has(group.key)
const hasExpanded = computed(() => groups.value.some((group) => !groupCollapsed(group)))
const hasCollapsed = computed(() => groups.value.some(groupCollapsed))
watch(() => props.groupField, () => { if (!props.foldScope) expandAll() })
/** Collapse all and Expand all: for a page's own groups, not for one inside a document or on a whiteboard card. */
const groupControls = computed(() => !!props.groupField && groups.value.length > 0 && !props.bare && !props.readonly)

// A group shows its first STEP objects, and more as the page scrolls to its end: drawing a type's
// thousands of objects at once takes seconds. Sorting, grouping and filters still see them all.
const STEP = 200
const drawn = ref<Record<string, number>>({})
watch([() => props.typeIds.join(), () => props.groupField, () => props.foldScope, () => props.initialLimit], () => (drawn.value = {}))
const drawLimit = (group: Group) => drawn.value[group.key] ?? props.initialLimit ?? STEP
const drawMore = (group: Group) => (drawn.value = { ...drawn.value, [group.key]: drawLimit(group) + STEP })
const sections = computed<Section[]>(() => groups.value.map((group) => ({ group, collapsed: groupCollapsed(group), limit: drawLimit(group) })))
/** More are drawn as the end of a group comes near, unless the owner limited the preview. */
const auto = computed(() => !props.initialLimit)

// What a phone changes about a table, in one place: its Quick actions column leaves the table and
// the buttons go under each title, where they can be reached without scrolling sideways; and unless
// "Show as table on this phone" is ticked it is drawn as list rows (no sideways scrolling), its
// shown columns becoming the row's fields.
const shownColumns = computed(() => tableColumns(props.table, props.typeIds).filter((c) => !c.hidden))
const actionsUnderTitle = computed(() => isPhone.value && shownColumns.value.some((c) => c.field === QUICK_ACTIONS_COLUMN))
const columns = computed(() => (actionsUnderTitle.value ? shownColumns.value.filter((c) => c.field !== QUICK_ACTIONS_COLUMN) : shownColumns.value))
const phoneRows = computed(() => isPhone.value && props.layout === 'table' && !props.phoneTable)
const asRows = computed(() => props.layout === 'list' || phoneRows.value)
const asTable = computed(() => props.layout === 'table' && !asRows.value)
/** Steps nest in a list (core subtasks.ts), not in a table. */
const nests = computed(() => asRows.value && !props.flat && types.value.some((t) => !!parentFieldOf(t)))
/** List rows: with fields chosen, each row shows those after its title. */
const listColumns = computed(() => (phoneRows.value ? rowFieldsFromTable(shownColumns.value) : props.list?.fields ? listFields(props.list, props.typeIds) : undefined))

const cardVariant = computed(() => (props.layout === 'wall' || props.layout === 'embed' ? 'wall' : props.layout === 'gallery' ? 'gallery' : 'grid'))
const cards = (group: Group) => group.items.slice(0, drawLimit(group))
</script>

<template>
  <!-- Board -->
  <BoardView
    v-if="layout === 'kanban'"
    :objects="objects"
    :group-field="groupField"
    :type-ids="typeIds"
    :board="board"
    :fold-scope="foldScope"
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
  <div v-else class="@container">
    <div v-if="groupControls" class="mb-2 flex flex-wrap justify-end gap-1" aria-label="Group display" data-group-controls>
      <button type="button" :class="quietButton" :disabled="!hasExpanded" @click="collapseAll(groups.map((group) => group.key))">Collapse all</button>
      <button type="button" :class="quietButton" :disabled="!hasCollapsed" @click="expandAll">Expand all</button>
    </div>
    <ObjectTable
      v-if="asTable"
      :sections="sections"
      :group-field="groupField"
      :addable="addable"
      :columns="columns"
      :actions-under-title="actionsUnderTitle"
      :table="table"
      :type-ids="typeIds"
      :readonly="readonly"
      :bare="bare"
      :auto="auto"
      @menu="(event, object) => emit('menu', event, object)"
      @moved="emit('moved', $event)"
      @table="emit('table', $event)"
      @toggle="(group) => toggleGroup(group.key)"
      @add="addIn"
      @more="drawMore"
    />
    <template v-else>
      <section v-for="(section, index) in sections" :key="section.group.key" class="mt-4 first:mt-0">
        <GroupHeading v-if="groupField" class="mb-3" :group="section.group" :field="groupField" :collapsed="section.collapsed" :addable="addable" @toggle="toggleGroup(section.group.key)" @add="addIn(section.group)" />
        <template v-if="!section.collapsed">
          <ObjectRows
            v-if="asRows"
            :group="section.group"
            :limit="section.limit"
            :objects="objects"
            :nests="nests"
            :list="list"
            :list-columns="listColumns"
            :phone-rows="phoneRows"
            :actions-under-title="actionsUnderTitle"
            :quick-actions="quickActions"
            :readonly="readonly"
            :tip="index === 0"
            :auto="auto"
            @menu="(event, object) => emit('menu', event, object)"
            @moved="emit('moved', $event)"
            @more="drawMore(section.group)"
          />
          <!-- Wall: masonry columns; grid and gallery: a grid of cards. -->
          <template v-else>
            <div v-if="cardVariant === 'wall'" class="columns-1 gap-3 @lg:columns-2 @4xl:columns-3 @7xl:columns-4">
              <ObjectCard v-for="object in cards(section.group)" :key="object.id" :object="object" :type="typeOf(object)" variant="wall" @contextmenu="emit('menu', $event, object)" @moved="emit('moved', $event)" />
            </div>
            <div v-else class="grid gap-3" :class="cardVariant === 'gallery' ? 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]'">
              <ObjectCard v-for="object in cards(section.group)" :key="object.id" :object="object" :type="typeOf(object)" :variant="cardVariant" @contextmenu="emit('menu', $event, object)" @moved="emit('moved', $event)" />
            </div>
            <ShowMore v-if="section.group.items.length > section.limit" :key="cards(section.group).length" :shown="cards(section.group).length" :total="section.group.items.length" :auto="auto" @more="drawMore(section.group)" />
          </template>
        </template>
      </section>
    </template>
  </div>
</template>
