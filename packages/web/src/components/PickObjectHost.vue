<script setup lang="ts">
// The box lib/pick.ts asks with: a title and a search over objects (ObjectPicker, nothing created),
// centred over a dimmed page, or a sheet from the bottom on a phone (BottomSheet). Escape, Back or a
// tap outside closes it.
import { pickRequest } from '../lib/pick.ts'
import { isPhone } from '../lib/viewport.ts'
import BottomSheet from './BottomSheet.vue'
import ObjectPicker from './ObjectPicker.vue'
</script>

<template>
  <BottomSheet v-if="pickRequest" :label="pickRequest.title" desktop="center" data-pick-object @close="pickRequest.resolve(null)">
    <p class="px-1 pb-2 font-medium" :class="isPhone ? 'text-base' : 'text-sm'">{{ pickRequest.title }}</p>
    <ObjectPicker :type-ids="pickRequest.typeIds" :exclude="pickRequest.exclude" no-create @pick="pickRequest.resolve($event)" />
  </BottomSheet>
</template>
