<script setup lang="ts">
// Edits a query: which types, filters, sort, grouping, layout and where results open. Emits the
// whole new query. The agenda layout has no sort or grouping (it is by day and time).
import { computed, ref } from 'vue'
import type { AgendaSettings, FilterGroup, Id, ListSettings, QueryDef, SortRule, TableSettings, ViewLayout } from '@vasta/core'
import { chip } from '../lib/colors.ts'
import { quickActionsColumnShown, toggleQuickActionsColumn } from '../lib/columns.ts'
import { fieldOptions, groupOptions } from '../lib/query.ts'
import { workspace } from '../lib/state.ts'
import AgendaMenu from './AgendaMenu.vue'
import AppIcon from './AppIcon.vue'
import ColumnsMenu from './ColumnsMenu.vue'
import FilterGroupEditor from './FilterGroupEditor.vue'
import ListFieldsMenu from './ListFieldsMenu.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ query: QueryDef }>()
const emit = defineEmits<{ update: [query: QueryDef] }>()

const LAYOUTS: { layout: ViewLayout; label: string; icon: string }[] = [
  { layout: 'list', label: 'List', icon: 'ph:list-dashes' },
  { layout: 'grid', label: 'Grid', icon: 'ph:grid-four' },
  { layout: 'wall', label: 'Wall', icon: 'ph:wall' },
  { layout: 'gallery', label: 'Gallery', icon: 'ph:images' },
  { layout: 'table', label: 'Table', icon: 'ph:table' },
  { layout: 'kanban', label: 'Board', icon: 'ph:kanban' },
  { layout: 'agenda', label: 'Agenda', icon: 'ph:calendar-dots' },
]

const update = (patch: Partial<QueryDef>) => {
  const next: QueryDef = { ...props.query, ...patch }
  for (const key of Object.keys(patch) as (keyof QueryDef)[]) if (patch[key] === undefined) delete next[key]
  emit('update', next)
}

const types = computed(() => [...workspace.types].sort((a, b) => a.name.localeCompare(b.name)))
function toggleType(id: Id) {
  const typeIds = props.query.typeIds.includes(id) ? props.query.typeIds.filter((t) => t !== id) : [...props.query.typeIds, id]
  update({ typeIds })
}

const filter = computed<FilterGroup>(() => props.query.filter ?? { kind: 'group', operator: 'and', items: [] })
const setFilter = (group: FilterGroup) => update({ filter: group.items.length ? group : undefined })

const sortFields = computed(() => fieldOptions(props.query.typeIds).filter((f) => f.kind !== 'ids' || f.def?.kind === 'select'))
const sort = computed<SortRule | undefined>(() => props.query.sort?.[0])
function setSort(field: string) {
  update({ sort: field ? [{ field, direction: sort.value?.direction ?? (field === 'title' ? 'asc' : 'desc') }] : undefined })
}
function flipSort() {
  if (sort.value) update({ sort: [{ ...sort.value, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }] })
}

const groups = computed(() => groupOptions(props.query.typeIds))
const groupField = computed(() => props.query.groupBy?.[0]?.field ?? '')
const setGroup = (field: string) => update({ groupBy: field ? [{ field }] : undefined })

const columnsAnchor = ref<HTMLElement | null>(null)
const columnsOpen = ref(false)
const setTable = (table: TableSettings | undefined) => update({ table })
const setList = (list: ListSettings | undefined) => update({ list })
const agendaAnchor = ref<HTMLElement | null>(null)
const agendaOpen = ref(false)
const setAgenda = (agenda: AgendaSettings | undefined) => update({ agenda })
const setOpenIn = (value: string) => update({ openIn: value === 'pane' || value === 'page' ? value : undefined })
// Quick actions for tasks, offered when the query can find tasks: in a table, a column (shown, hidden
// and moved like the others); in a list, on each row.
const findsTasks = computed(() => !props.query.typeIds.length || workspace.types.some((t) => t.system === 'task' && props.query.typeIds.includes(t.id)))
const rowsLayout = computed(() => (props.query.layout ?? 'list') === 'list' || props.query.layout === 'table')
const quickActionsOn = computed(() => (props.query.layout === 'table' ? quickActionsColumnShown(props.query.table, props.query.typeIds) : !!props.query.quickActions))
function toggleQuickActions() {
  if (props.query.layout === 'table') update({ table: toggleQuickActionsColumn(props.query.table, props.query.typeIds) })
  else update({ quickActions: props.query.quickActions ? undefined : true })
}

const control = 'rounded-md bg-hover px-1.5 py-1 text-sm outline-none'
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <section>
      <h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Types</h3>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in types"
          :key="t.id"
          class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
          :class="query.typeIds.includes(t.id) ? chip(t.color) : 'text-ink-faint ring-1 ring-line hover:text-ink'"
          @click="toggleType(t.id)"
        >
          <AppIcon :icon="t.icon" fallback="ph:cube" :size="12" />{{ t.pluralName }}
        </button>
      </div>
      <p v-if="!query.typeIds.length" class="mt-1 text-xs text-ink-faint">No type chosen: the query searches every type.</p>
    </section>

    <section>
      <h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Filters</h3>
      <FilterGroupEditor :group="filter" :type-ids="query.typeIds" @update="setFilter" />
    </section>

    <section class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label v-if="query.layout !== 'agenda'" class="flex items-center gap-1.5 text-ink-soft">
        Sort by
        <select :value="sort?.field ?? ''" :class="control" @change="setSort(($event.target as HTMLSelectElement).value)">
          <option value="">Newest first</option>
          <option v-for="f in sortFields" :key="f.field" :value="f.field">{{ f.label }}</option>
        </select>
        <button v-if="sort" class="rounded-md p-1 hover:bg-hover" :title="sort.direction === 'asc' ? 'Ascending' : 'Descending'" @click="flipSort">
          <AppIcon :fallback="sort.direction === 'asc' ? 'ph:sort-ascending' : 'ph:sort-descending'" />
        </button>
      </label>
      <label v-if="query.layout !== 'agenda'" class="flex items-center gap-1.5 text-ink-soft">
        Group by
        <select :value="groupField" :class="control" @change="setGroup(($event.target as HTMLSelectElement).value)">
          <option value="">Nothing</option>
          <option v-for="f in groups" :key="f.field" :value="f.field">{{ f.label }}</option>
        </select>
      </label>
      <div class="flex items-center gap-0.5">
        <button
          v-for="l in LAYOUTS"
          :key="l.layout"
          class="rounded-md p-1.5"
          :class="(query.layout ?? 'list') === l.layout ? 'bg-hover text-ink' : 'text-ink-faint hover:bg-hover hover:text-ink'"
          :title="l.label"
          @click="update({ layout: l.layout })"
        >
          <AppIcon :fallback="l.icon" />
        </button>
      </div>
      <button
        v-if="query.layout === 'table'"
        ref="columnsAnchor"
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft hover:bg-hover hover:text-ink"
        @click="columnsOpen = !columnsOpen"
      >
        <AppIcon fallback="ph:columns" /> Columns
      </button>
      <button
        v-else-if="(query.layout ?? 'list') === 'list'"
        ref="columnsAnchor"
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft hover:bg-hover hover:text-ink"
        @click="columnsOpen = !columnsOpen"
      >
        <AppIcon fallback="ph:list-checks" /> Fields
      </button>
      <button
        v-if="query.layout === 'agenda'"
        ref="agendaAnchor"
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft hover:bg-hover hover:text-ink"
        @click="agendaOpen = !agendaOpen"
      >
        <AppIcon fallback="ph:calendar-dots" /> Agenda
      </button>
      <PopoverMenu v-model:open="agendaOpen" :anchor="agendaAnchor" placement="bottom-end" width="18rem">
        <AgendaMenu :agenda="query.agenda" :type-ids="query.typeIds" @update="setAgenda" />
      </PopoverMenu>
      <PopoverMenu v-model:open="columnsOpen" :anchor="columnsAnchor" placement="bottom-end" width="17rem">
        <ColumnsMenu v-if="query.layout === 'table'" :table="query.table" :type-ids="query.typeIds" @update="setTable" />
        <ListFieldsMenu v-else :list="query.list" :type-ids="query.typeIds" @update="setList" />
      </PopoverMenu>
      <label class="flex items-center gap-1.5 text-ink-soft">
        Open in
        <select :value="query.openIn ?? ''" :class="control" @change="setOpenIn(($event.target as HTMLSelectElement).value)">
          <option value="">As each type says</option>
          <option value="pane">Side pane</option>
          <option value="page">Full page</option>
        </select>
      </label>
      <label v-if="findsTasks && rowsLayout" class="flex items-center gap-1.5 text-ink-soft" title="Done, Defer, Drop and the next step on each task's row">
        <input type="checkbox" class="accent-[var(--color-accent)]" :checked="quickActionsOn" @change="toggleQuickActions" />
        Quick actions
      </label>
    </section>
  </div>
</template>
