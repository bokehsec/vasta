<script setup lang="ts">
// A phone's Filters button and the sheet behind it: search, Mine and the filters (ViewFilters), then
// Arrange (the menus a desktop's toolbar buttons open, each a sheet over this one). Changes apply
// as they are made: the count says what they leave, Done closes the sheet. The button counts what
// narrows the page. A desktop has ViewToolbar instead.
import { ref } from 'vue'
import { greyButton, quietButton, tintedButton } from '../lib/buttons.ts'
import type { ViewToolbar } from '../lib/view-toolbar.ts'
import { metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import MenuRow from './MenuRow.vue'
import PopoverMenu from './PopoverMenu.vue'
import ViewFilters from './ViewFilters.vue'

const props = defineProps<{ toolbar: ViewToolbar; /** How many rows the page shows with the narrowing. */ shown: number }>()
const t = props.toolbar
const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const heading = `px-2.5 pb-1 pt-3 font-medium uppercase tracking-wide text-ink-faint ${metaText}`
</script>

<template>
  <button ref="anchor" :class="t.activeFilterCount.value ? tintedButton : greyButton" data-filters-button @click="open = true">
    <AppIcon fallback="ph:funnel" :size="16" /> Filters
    <span v-if="t.activeFilterCount.value" class="tabular-nums" data-filters-count>{{ t.activeFilterCount.value }}</span>
  </button>
  <PopoverMenu v-model:open="open" :anchor="anchor" label="Search and filter">
    <div class="flex items-center gap-1 px-2.5 pb-1">
      <div class="min-w-0">
        <p class="text-base font-semibold">Search and filter</p>
        <p class="text-ink-faint" :class="metaText" data-filters-shown>{{ shown }} {{ shown === 1 ? t.type.value!.name.toLowerCase() : t.type.value!.pluralName.toLowerCase() }} shown</p>
      </div>
      <button v-if="t.activeFilterCount.value" :class="[quietButton, 'ml-auto']" data-filters-clear @click="t.clearFilters">Clear</button>
      <button :class="[greyButton, t.activeFilterCount.value ? '' : 'ml-auto']" data-filters-done @click="open = false">Done</button>
    </div>
    <div v-if="!t.agendaActive.value" class="mx-1.5 mb-2 flex items-center gap-2 rounded-lg bg-hover px-3 text-ink-faint focus-within:ring-1 focus-within:ring-accent/50">
      <AppIcon fallback="ph:magnifying-glass" :size="16" />
      <input v-model="t.filterText.value" class="h-11 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint" placeholder="Search this view" aria-label="Search this view" enterkeyhint="search" data-filters-search />
    </div>
    <MenuRow v-if="t.showMine.value && !t.agendaActive.value && !t.fixedActive.value" icon="ph:user-circle" :aria-pressed="t.mineOnly.value" data-filters-mine @click="t.toggleMine">
      Mine
      <template #end><AppIcon :fallback="t.mineOnly.value ? 'ph:check-square-fill' : 'ph:square'" :class="t.mineOnly.value ? 'text-accent' : 'text-ink-faint'" class="ml-auto" /></template>
    </MenuRow>
    <template v-if="!t.fixedActive.value">
      <div :class="heading">Filters</div>
      <ViewFilters :type="t.type.value!" :view="t.view.value" :narrowing="t.narrowing.value" :show-closed="t.showClosed.value" @update:narrowing="t.setNarrowing" @show-closed="t.showClosed.value = $event" @save="t.saveNarrowing" @edit-view="t.editViewFilter" />
      <div :class="heading">Arrange</div>
      <MenuRow v-for="row in t.arrangeRows.value" :key="row.id" :icon="row.icon" :value="row.value" caret :data-arrange="row.id" @click="row.open.value = true">{{ row.label }}</MenuRow>
    </template>
  </PopoverMenu>
</template>
