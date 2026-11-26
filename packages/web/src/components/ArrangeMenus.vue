<script setup lang="ts">
// The menus that arrange a view (sort, group, layout, columns and fields, cards, agenda
// options). A desktop's toolbar buttons open them; on a phone the Filters sheet's Arrange rows
// open them, each a sheet over it (PopoverMenu). They save on the type through the toolbar model.
import { parentFieldOf } from '@vasta/core'
import type { ViewToolbar } from '../lib/view-toolbar.ts'
import { LAYOUTS } from '../lib/view-toolbar.ts'
import { isPhone } from '../lib/viewport.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AgendaMenu from './AgendaMenu.vue'
import AppIcon from './AppIcon.vue'
import CardOptionsMenu from './CardOptionsMenu.vue'
import ColumnsMenu from './ColumnsMenu.vue'
import ListFieldsMenu from './ListFieldsMenu.vue'
import MenuRow from './MenuRow.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ toolbar: ViewToolbar }>()
const { view, menus, anchors, updateView } = props.toolbar
const typeIds = [props.toolbar.type.value!.id]
const heading = `px-2.5 pb-1 pt-0.5 font-medium uppercase tracking-wide text-ink-faint ${metaText}`
</script>

<template>
  <PopoverMenu v-model:open="menus.sort.value" :anchor="anchors.sort" placement="bottom-end" width="13rem">
    <MenuRow v-for="f in toolbar.sortFields.value" :key="f.field" @click="toolbar.setSort(f.field)">
      {{ f.label }}
      <template v-if="toolbar.sort.value.field === f.field" #end><AppIcon :fallback="toolbar.sort.value.direction === 'asc' ? 'ph:arrow-up' : 'ph:arrow-down'" class="ml-auto text-accent" /></template>
    </MenuRow>
  </PopoverMenu>
  <PopoverMenu v-model:open="menus.group.value" :anchor="anchors.group" placement="bottom-end" width="13rem">
    <MenuRow v-for="f in toolbar.groupFields.value" :key="f.field" :check="toolbar.groupField.value === f.field" @click="toolbar.setGroup(f.field), (menus.group.value = false)">{{ f.label }}</MenuRow>
  </PopoverMenu>
  <PopoverMenu v-model:open="menus.cards.value" :anchor="anchors.cards" placement="bottom-end" width="16.5rem">
    <template v-if="view.layout === 'kanban'">
      <div :class="heading">Swimlanes</div>
      <select :value="view.board?.swimlanes ?? ''" class="mx-1.5 mb-2 w-[calc(100%-0.75rem)] rounded-md bg-hover px-2 py-1 outline-none max-md:min-h-11" :class="bodyText" aria-label="Swimlanes" @change="toolbar.setSwimlanes(($event.target as HTMLSelectElement).value)">
        <option value="">None</option>
        <option v-for="f in toolbar.groupFields.value.filter((g) => g.field && g.field !== toolbar.groupField.value)" :key="f.field" :value="f.field">{{ f.label }}</option>
      </select>
      <div class="my-1 border-t border-line" />
    </template>
    <CardOptionsMenu v-if="toolbar.cardVariant.value" :variant="toolbar.cardVariant.value" :card="toolbar.activeCardSettings.value" :choices="toolbar.cardFieldChoices.value" @patch="toolbar.patchCard" />
    <template v-if="view.layout === 'kanban' && (view.board?.columnOrder?.length || view.board?.laneOrder?.length)">
      <div class="my-1 border-t border-line" />
      <MenuRow icon="ph:arrow-counter-clockwise" @click="toolbar.resetBoardOrder">Reset order</MenuRow>
    </template>
  </PopoverMenu>
  <PopoverMenu v-model:open="menus.columns.value" :anchor="anchors.columns" placement="bottom-end" width="17rem">
    <ColumnsMenu v-if="view.layout === 'table'" :table="view.table" :type-ids="typeIds" @update="updateView({ table: $event })" />
    <ListFieldsMenu v-else :list="view.list" :type-ids="typeIds" @update="updateView({ list: $event })" />
  </PopoverMenu>
  <PopoverMenu v-model:open="menus.options.value" :anchor="anchors.options" placement="bottom-end" width="18rem">
    <AgendaMenu :agenda="view.agenda" :type-ids="typeIds" @update="updateView({ agenda: $event })" />
  </PopoverMenu>
  <PopoverMenu v-model:open="menus.layout.value" :anchor="anchors.layout" placement="bottom-end" width="15rem">
    <MenuRow v-for="l in LAYOUTS" :key="l.layout" :icon="l.icon" :check="view.layout === l.layout" @click="updateView({ layout: l.layout }), (menus.layout.value = false)">{{ l.label }}</MenuRow>
    <div class="my-1 border-t border-line" />
    <div :class="heading">Open in</div>
    <MenuRow v-for="o in toolbar.openChoices.value" :key="o.label" :check="view.openIn === o.openIn" :aria-pressed="view.openIn === o.openIn" @click="updateView({ openIn: o.openIn }), (menus.layout.value = false)">{{ o.label }}</MenuRow>
    <template v-if="parentFieldOf(toolbar.type.value) && (view.layout === 'list' || (isPhone && view.layout === 'table' && !toolbar.phoneTable.value))">
      <div class="my-1 border-t border-line" />
      <MenuRow icon="ph:tree-structure" :check="!view.flat" :aria-pressed="!view.flat" data-nest-subtasks @click="updateView({ flat: view.flat ? undefined : true }), (menus.layout.value = false)">Nest subtasks</MenuRow>
    </template>
    <template v-if="isPhone && view.layout === 'table'">
      <div class="my-1 border-t border-line" />
      <MenuRow icon="ph:table" :check="toolbar.phoneTable.value" :aria-pressed="toolbar.phoneTable.value" data-phone-table @click="toolbar.togglePhoneTable(), (menus.layout.value = false)">Show as table on this phone</MenuRow>
    </template>
    <template v-if="toolbar.hasQuickActions.value && (view.layout === 'list' || view.layout === 'table')">
      <div class="my-1 border-t border-line" />
      <MenuRow icon="ph:lightning" :check="toolbar.quickActionsOn.value" :aria-pressed="toolbar.quickActionsOn.value" :title="view.layout === 'table' ? 'A column with the quick actions (Columns moves it)' : 'The quick actions on each row'" data-view-quick-actions @click="toolbar.toggleQuickActions">Quick actions</MenuRow>
    </template>
  </PopoverMenu>
</template>
