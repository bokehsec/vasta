<script setup lang="ts">
// A shared header for table sections, lists and cards. Linked chips stay outside the fold
// button so tags, relations and people still open normally (no nested interactive controls).
import { computed } from 'vue'
import { quietButton } from '../lib/buttons.ts'
import { chip } from '../lib/colors.ts'
import { displayTitle } from '../lib/format.ts'
import { NO_VALUE, type Group } from '../lib/query.ts'
import { summaryOf } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import ObjectChip from './ObjectChip.vue'
import PersonChip from './PersonChip.vue'

const props = defineProps<{ group: Group; field: string; collapsed: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const linked = computed(() => !!(props.group.objectId || props.group.personId))
const label = computed(() => props.group.objectId ? displayTitle(summaryOf(props.group.objectId)) : props.group.label)
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 text-sm" :data-group-heading="group.key">
    <button type="button" class="max-w-full" :class="quietButton" :aria-expanded="!collapsed" :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${label}, ${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`" data-fold-group @click="emit('toggle')">
      <AppIcon :fallback="collapsed ? 'ph:caret-right' : 'ph:caret-down'" :size="13" />
      <template v-if="!linked">
        <span class="truncate rounded-md px-2 py-0.5 font-medium" :class="group.key === NO_VALUE ? 'text-ink-faint' : chip(group.color as never)">{{ group.label }}</span>
        <span class="text-xs tabular-nums text-ink-faint">{{ group.items.length }}</span>
      </template>
    </button>
    <template v-if="linked">
      <ObjectChip v-if="group.objectId" :id="group.objectId" :tag="field === 'tags'" />
      <PersonChip v-else-if="group.personId" :id="group.personId" />
      <span class="text-xs tabular-nums text-ink-faint">{{ group.items.length }}</span>
    </template>
  </div>
</template>
