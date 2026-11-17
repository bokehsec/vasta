<script setup lang="ts">
// A view's filters, in the toolbar's menu and the phone's sheet. What the view saves for everyone
// ("This view: Area is Work", changed on purpose with Edit view filter) is shown apart from what
// the person narrows it with: the narrowing is kept for this visit to the page, and Save to view is
// the one way it becomes the view's. Show done is the person's own choice for this view.
import { computed, ref } from 'vue'
import type { FilterGroup, ObjectType, ViewDef } from '@vasta/core'
import { closedOptionsOf, closedStatusIds, savedConditions } from '@vasta/core'
import { tintedButton } from '../lib/buttons.ts'
import { describeFilter } from '../lib/query.ts'
import AppIcon from './AppIcon.vue'
import FilterGroupEditor from './FilterGroupEditor.vue'

const props = defineProps<{
  type: ObjectType
  view: ViewDef
  /** What this visit narrows the view with. */
  narrowing: FilterGroup
  showClosed: boolean
  /** A Clear for the narrowing here (the phone's sheet has its own, for search and Mine too). */
  clear?: boolean
}>()
const emit = defineEmits<{
  'update:narrowing': [group: FilterGroup]
  'show-closed': [on: boolean]
  save: []
  clear: []
  'edit-view': [conditions: FilterGroup]
}>()

const canShowClosed = computed(() => closedStatusIds(props.type).length > 0)
const closedLabel = computed(() => {
  const names = closedOptionsOf(props.type).map((o) => o.label.toLowerCase())
  return `Show ${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)}`
})

const saved = computed(() => savedConditions(props.type, props.view.filter))
const savedItems = computed(() => saved.value?.items.length ?? 0)
const savedText = computed(() => (saved.value ? describeFilter(saved.value, [props.type.id]) : ''))
const editing = ref(false)
</script>

<template>
  <div class="text-sm" data-view-filters>
    <button v-if="canShowClosed" class="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover md:min-h-0" :aria-pressed="showClosed" data-show-closed @click="emit('show-closed', !showClosed)">
      <AppIcon fallback="ph:check-circle" :size="16" class="text-ink-soft" /> {{ closedLabel }}
      <AppIcon :fallback="showClosed ? 'ph:check-square-fill' : 'ph:square'" :class="showClosed ? 'text-accent' : 'text-ink-faint'" class="ml-auto" />
    </button>

    <div v-if="savedItems" class="mx-1.5 mt-1.5 rounded-lg border border-line px-3 py-2" data-view-filter>
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">This view</p>
      <p class="mt-0.5 break-words" data-view-filter-text>{{ savedText }}</p>
      <button class="mt-1 flex min-h-11 items-center gap-1 rounded-md text-accent md:min-h-0" data-edit-view-filter :aria-expanded="editing" @click="editing = !editing">
        {{ editing ? 'Close' : 'Edit view filter' }}
      </button>
      <p v-if="editing" class="text-xs text-ink-faint">Changes the view for everyone who uses it.</p>
      <div v-if="editing && saved" class="mt-1.5" data-view-filter-editor>
        <FilterGroupEditor :group="saved" :type-ids="[type.id]" @update="emit('edit-view', $event)" />
      </div>
    </div>

    <div class="mx-1.5 mt-2 flex items-center gap-2 px-1">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">Just for now</p>
      <span class="text-xs text-ink-faint">gone when you leave this page</span>
      <button v-if="clear && narrowing.items.length" class="ml-auto min-h-11 rounded-lg px-2 text-accent md:min-h-0" data-narrowing-clear @click="emit('clear')">Clear</button>
    </div>
    <div class="p-1.5" data-narrowing>
      <FilterGroupEditor :group="narrowing" :type-ids="[type.id]" @update="emit('update:narrowing', $event)" />
    </div>
    <div v-if="narrowing.items.length" class="px-1.5 pb-1.5">
      <button :class="[tintedButton, 'w-full justify-center']" data-save-to-view @click="emit('save')">
        <AppIcon fallback="ph:floppy-disk" :size="16" /> Save to view
      </button>
      <p class="mt-1 px-1 text-xs text-ink-faint">Adds these to the view’s own filter, for everyone who uses it.</p>
    </div>
  </div>
</template>
