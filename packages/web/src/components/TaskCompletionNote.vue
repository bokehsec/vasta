<script setup lang="ts">
import { computed, inject } from 'vue'
import { taskDatesOf, type ObjectSummary } from '@vasta/core'
import { COMPLETION_FEEDBACK } from '../lib/completion-feedback.ts'
import { formatDateShort } from '../lib/format.ts'
import { typesById } from '../lib/state.ts'

const props = defineProps<{ object: ObjectSummary }>()

const feedback = inject(COMPLETION_FEEDBACK, undefined)
const due = computed(() => {
  const deadline = taskDatesOf(typesById.value.get(props.object.typeId)).deadline?.id
  const value = deadline ? props.object.props[deadline] : undefined
  return value?.kind === 'date' ? value.value : undefined
})
const show = computed(() => !!feedback?.entries.get(props.object.id)?.repeat && !!due.value)
</script>

<template>
  <p v-if="show && due" data-completion-note class="text-xs text-ink-soft">Done this time · Next: {{ formatDateShort(due) }}</p>
</template>
