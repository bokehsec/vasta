<script setup lang="ts">
// Edits a query: which types, filters, sort, grouping, layout and where results open. Emits the
// whole new query. The agenda layout has no sort or grouping (it is by day and time).
import { computed, ref } from 'vue'
import type { AgendaSettings, FilterGroup, Id, ListSettings, QueryDef, SortRule, TableSettings, ViewLayout } from '@vasta/core'
import { defaultQueryFilter, parentFieldOf, quickActionsOf } from '@vasta/core'
import { chip } from '../lib/colors.ts'
import { quickActionsColumnShown, toggleQuickActionsColumn } from '../lib/columns.ts'
import { t, typePluralName } from '../lib/i18n.ts'
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

const LAYOUTS = computed<{ layout: ViewLayout; label: string; icon: string }[]>(() => [
  { layout: 'list', label: t('views.layout.list'), icon: 'ph:list-dashes' },
  { layout: 'grid', label: t('views.layout.grid'), icon: 'ph:grid-four' },
  { layout: 'wall', label: t('views.layout.wall'), icon: 'ph:wall' },
  { layout: 'gallery', label: t('views.layout.gallery'), icon: 'ph:images' },
  { layout: 'table', label: t('views.layout.table'), icon: 'ph:table' },
  { layout: 'kanban', label: t('views.layout.kanban'), icon: 'ph:kanban' },
  { layout: 'agenda', label: 'Agenda', icon: 'ph:calendar-dots' },
])

const update = (patch: Partial<QueryDef>) => {
  const next: QueryDef = { ...props.query, ...patch }
  for (const key of Object.keys(patch) as (keyof QueryDef)[]) if (patch[key] === undefined) delete next[key]
  emit('update', next)
}

const types = computed(() => [...workspace.types].sort((a, b) => a.name.localeCompare(b.name)))
// A type with a status chosen starts the query with its closed objects (Done, Dropped) left out,
// as a new view of it does, unless the filters already say something about its status.
function toggleType(id: Id) {
  if (props.query.typeIds.includes(id)) return update({ typeIds: props.query.typeIds.filter((t) => t !== id) })
  const added = workspace.types.filter((t) => t.id === id)
  update({ typeIds: [...props.query.typeIds, id], filter: defaultQueryFilter(added, props.query) })
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
const setOpenIn = (value: string) => update({ openIn: value === 'pane' || value === 'page' || value === 'popup' ? value : undefined })
// Quick actions, offered when the query can find a type that has them: in a table, a column (shown,
// hidden and moved like the others); in a list, on each row.
const findsActions = computed(() => !props.query.typeIds.length || workspace.types.some((t) => props.query.typeIds.includes(t.id) && quickActionsOf(t).length > 0))
const rowsLayout = computed(() => (props.query.layout ?? 'list') === 'list' || props.query.layout === 'table')
const quickActionsOn = computed(() => (props.query.layout === 'table' ? quickActionsColumnShown(props.query.table, props.query.typeIds) : !!props.query.quickActions))
function toggleQuickActions() {
  if (props.query.layout === 'table') update({ table: toggleQuickActionsColumn(props.query.table, props.query.typeIds) })
  else update({ quickActions: props.query.quickActions ? undefined : true })
}
// Steps nested under their parent (a type with subtasks among the results, list layout); on by default.
const findsSteps = computed(() => workspace.types.some((t) => (!props.query.typeIds.length || props.query.typeIds.includes(t.id)) && parentFieldOf(t)))
const listLayout = computed(() => (props.query.layout ?? 'list') === 'list')
const toggleNested = () => update({ flat: props.query.flat ? undefined : true })

const control = 'rounded-md bg-hover px-1.5 py-1 text-sm outline-none'
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <section>
      <h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">{{ t('query.types') }}</h3>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="typeItem in types"
          :key="typeItem.id"
          class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
          :class="query.typeIds.includes(typeItem.id) ? chip(typeItem.color) : 'text-ink-faint ring-1 ring-line hover:text-ink'"
          @click="toggleType(typeItem.id)"
        >
          <AppIcon :icon="typeItem.icon" fallback="ph:cube" :size="12" />{{ typePluralName(typeItem) }}
        </button>
      </div>
      <p v-if="!query.typeIds.length" class="mt-1 text-xs text-ink-faint">{{ t('query.noTypeChosen') }}</p>
    </section>

    <section>
      <h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">{{ t('query.filters') }}</h3>
      <FilterGroupEditor :group="filter" :type-ids="query.typeIds" @update="setFilter" />
    </section>

    <section class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label v-if="query.layout !== 'agenda'" class="flex items-center gap-1.5 text-ink-soft">
        {{ t('query.sortBy') }}
        <select :value="sort?.field ?? ''" :class="control" @change="setSort(($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('query.newestFirst') }}</option>
          <option v-for="f in sortFields" :key="f.field" :value="f.field">{{ f.label }}</option>
        </select>
        <button v-if="sort" class="rounded-md p-1 hover:bg-hover" :title="sort.direction === 'asc' ? t('query.ascending') : t('query.descending')" @click="flipSort">
          <AppIcon :fallback="sort.direction === 'asc' ? 'ph:sort-ascending' : 'ph:sort-descending'" />
        </button>
      </label>
      <label v-if="query.layout !== 'agenda'" class="flex items-center gap-1.5 text-ink-soft">
        {{ t('query.groupBy') }}
        <select :value="groupField" :class="control" @change="setGroup(($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('query.nothing') }}</option>
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
        v-if="!query.layout || query.layout === 'list' || query.layout === 'table'"
        ref="columnsAnchor"
        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-soft hover:bg-hover hover:text-ink"
        @click="columnsOpen = !columnsOpen"
      >
        <AppIcon :fallback="query.layout === 'table' ? 'ph:columns' : 'ph:list-dashes'" /> {{ query.layout === 'table' ? t('views.columns') : t('views.fields') }}
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
        {{ t('views.openIn') }}
        <select :value="query.openIn ?? ''" :class="control" @change="setOpenIn(($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('query.asEachTypeSays') }}</option>
          <option value="popup">Window</option>
          <option value="pane">{{ t('views.sidePane') }}</option>
          <option value="page">{{ t('views.fullPage') }}</option>
        </select>
      </label>
      <label v-if="findsActions && rowsLayout" class="flex items-center gap-1.5 text-ink-soft" title="The type's quick actions on each row; in a table, a column of their own">
        <input type="checkbox" class="accent-[var(--color-accent)]" :checked="quickActionsOn" @change="toggleQuickActions" />
        Quick actions
      </label>
      <label v-if="findsSteps && listLayout" class="flex items-center gap-1.5 text-ink-soft" title="Subtasks under their parent, folded with its caret">
        <input type="checkbox" class="accent-[var(--color-accent)]" :checked="!query.flat" data-nest-subtasks @change="toggleNested" />
        Nest subtasks
      </label>
    </section>
  </div>
</template>
