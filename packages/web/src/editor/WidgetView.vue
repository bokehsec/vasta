<script setup lang="ts">
// Today belongs to the viewer, and rolls over while a Home is left open.
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import HabitChecklist from '../components/HabitChecklist.vue'
import FoodDay from '../components/nutrition/FoodDay.vue'
import InlineCapture from '../components/InlineCapture.vue'
import { useToday } from '../lib/habits.ts'

defineProps(nodeViewProps)
const today = useToday()
</script>

<template>
  <NodeViewWrapper class="vasta-ui my-2" contenteditable="false" :data-widget="node.attrs.kind">
    <HabitChecklist v-if="node.attrs.kind === 'habits'" :key="today" :day="today" variant="inline" />
    <FoodDay v-else-if="node.attrs.kind === 'food'" :key="today" :day="today" />
    <InlineCapture v-else-if="node.attrs.kind === 'capture'" />
  </NodeViewWrapper>
</template>
