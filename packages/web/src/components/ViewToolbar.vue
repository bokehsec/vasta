<script setup lang="ts">
// A desktop's view toolbar: search, Mine, Filter and one button for each way to arrange the view
// (the toolbar model's arrange rows; their menus are ArrangeMenus). Quiet buttons, tinted while
// something narrows the page (lib/buttons.ts). A phone has FiltersSheet instead.
import { quietButton, tintedButton } from '../lib/buttons.ts'
import type { ViewToolbar } from '../lib/view-toolbar.ts'
import AppIcon from './AppIcon.vue'
import HabitProgressMenu from './HabitProgressMenu.vue'
import PopoverMenu from './PopoverMenu.vue'
import ViewFilters from './ViewFilters.vue'

const props = defineProps<{ toolbar: ViewToolbar }>()
const t = props.toolbar
</script>

<template>
  <div class="ml-auto flex items-center gap-1 whitespace-nowrap text-sm [&>*]:shrink-0" data-view-toolbar>
    <div v-if="!t.agendaActive.value" class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink-faint focus-within:bg-hover">
      <AppIcon fallback="ph:magnifying-glass" :size="14" />
      <input v-model="t.filterText.value" class="w-28 bg-transparent text-ink outline-none placeholder:text-ink-faint md:w-36" placeholder="Filter…" aria-label="Filter this view" />
    </div>
    <HabitProgressMenu v-if="t.fixedActive.value && t.type.value?.system === 'habit'" :type="t.type.value" />
    <template v-if="!t.fixedActive.value">
      <button v-if="t.showMine.value && !t.agendaActive.value" :class="t.mineOnly.value ? tintedButton : quietButton" :aria-pressed="t.mineOnly.value" :title="t.mineTitle.value" @click="t.toggleMine">
        <AppIcon fallback="ph:user-circle" /> Mine
      </button>
      <button :ref="(el) => (t.anchors.filter = el as HTMLElement | null)" :class="t.filterCount.value ? tintedButton : quietButton" @click="t.menus.filter.value = !t.menus.filter.value">
        <AppIcon fallback="ph:funnel" /> Filter<span v-if="t.filterCount.value"> · {{ t.filterCount.value }}</span>
      </button>
      <button v-for="row in t.arrangeRows.value" :key="row.id" :ref="(el) => (t.anchors[row.menu] = el as HTMLElement | null)" :class="quietButton" :data-arrange="row.id" @click="row.open.value = !row.open.value">
        <AppIcon :fallback="row.icon" /> {{ row.id === 'group' && !t.groupField.value ? 'Group' : row.value || row.label }}
      </button>
    </template>
    <PopoverMenu v-model:open="t.menus.filter.value" :anchor="t.anchors.filter" placement="bottom-end" width="34rem">
      <ViewFilters :type="t.type.value!" :view="t.view.value" :narrowing="t.narrowing.value" :show-closed="t.showClosed.value" clear @update:narrowing="t.setNarrowing" @show-closed="t.showClosed.value = $event" @save="t.saveNarrowing" @clear="t.clearNarrowing" @edit-view="t.editViewFilter" />
    </PopoverMenu>
  </div>
</template>
