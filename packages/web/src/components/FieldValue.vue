<script setup lang="ts">
// One field of an object as a table cell or a list row's field shows it: the built-in fields
// (tags, collections, type, last edited, date, host) and a property's value (PropertyDisplay).
// Written once for both layouts; `row` is the list row's smaller, one-line look (short dates and values).
import type { ObjectSummary, PropertyDef, PropertyValue } from '@vasta/core'
import { chip } from '../lib/colors.ts'
import { formatDate, formatDateShort, formatRelative } from '../lib/format.ts'
import { typesById } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import ObjectChip from './ObjectChip.vue'
import PropertyDisplay from './PropertyDisplay.vue'

const props = defineProps<{
  object: ObjectSummary
  field: string
  def?: PropertyDef | undefined
  /** A list row's field. */
  row?: boolean
  /** Long values wrap (a table column's setting); a list row never does. */
  wrap?: boolean
  /** The value to show instead of the object's (which may be none), for one just edited and not yet saved. */
  edited?: { value: PropertyValue | undefined }
}>()
const type = () => typesById.value.get(props.object.typeId)
</script>

<template>
  <span v-if="field === 'tags' || field === 'collections'" class="flex gap-1" :class="wrap ? 'flex-wrap' : row ? '' : 'overflow-hidden'">
    <ObjectChip v-for="id in field === 'tags' ? object.tagIds : object.collectionIds" :key="id" :id="id" :tag="field === 'tags'" />
  </span>
  <span v-else-if="field === 'type'" class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5" :class="[chip(type()?.color), row ? '' : 'text-xs']">
    <AppIcon :icon="type()?.icon" fallback="ph:cube" :size="12" />{{ type()?.name }}
  </span>
  <span v-else-if="field === 'createdAt' || field === 'updatedAt'" class="text-ink-faint" :class="row ? 'whitespace-nowrap' : 'text-xs'">{{ formatRelative(object[field]) }}</span>
  <span v-else-if="field === 'date'" :class="row ? 'whitespace-nowrap' : ''">{{ object.date ? (row ? formatDateShort(object.date) : formatDate(object.date)) : '' }}</span>
  <span v-else-if="field === 'host'" :class="row ? 'whitespace-nowrap' : ''">{{ object.media?.host?.replace(/^www\./, '') }}</span>
  <PropertyDisplay v-else-if="def" :def="def" :value="edited ? edited.value : object.props[field]" :object="object" :wrap="row ? false : wrap" :short="row" />
</template>
