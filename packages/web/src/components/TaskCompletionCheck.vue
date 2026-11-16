<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { ObjectRecord, ObjectSummary, ObjectType } from '@vasta/core'
import { isDone, setTaskDone } from '../lib/calendar.ts'
import { COMPLETION_FEEDBACK } from '../lib/completion-feedback.ts'
import AppIcon from './AppIcon.vue'
import { lastError as saveError, notice } from '../lib/state.ts'

const props = defineProps<{ object: ObjectSummary; type: ObjectType | undefined }>()
const emit = defineEmits<{ moved: [object: ObjectRecord] }>()

const feedback = inject(COMPLETION_FEEDBACK, undefined)
const working = ref(false)
const lastError = ref('')
const done = computed(() => feedback?.done(props.object) ?? isDone(props.type, props.object.props.status?.kind === 'select' ? props.object.props.status.value : undefined))
const disabled = computed(() => working.value || (feedback?.busy(props.object.id) ?? false))
const label = computed(() => (done.value ? 'Mark as to do' : 'Mark as done'))

async function toggle() {
  if (disabled.value) return
  working.value = true
  lastError.value = ''
  try {
    if (feedback?.entries.has(props.object.id)) await feedback.undo(props.object.id)
    else {
      const saved = await setTaskDone(props.object.id, props.type, !done.value)
      if (saved) emit('moved', saved)
    }
  } catch (e) {
    lastError.value = e instanceof Error ? e.message : String(e)
    saveError.value = lastError.value
    notice.value = { message: 'The task was not saved. Try again.', action: { label: 'Retry', run: toggle } }
  } finally {
    working.value = false
  }
}
</script>

<template>
  <button
    type="button"
    data-task-check
    class="-m-3 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
    :aria-label="label"
    :title="lastError || label"
    :aria-pressed="done"
    :disabled="disabled"
    @click.prevent.stop="toggle"
  >
    <!-- The icon lets the pointer through: the button itself is the click's target, so the editor
         around an embedded list leaves the click here instead of following the row's link. -->
    <span
      class="pointer-events-none grid size-5 place-items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none"
      :class="done ? 'border-accent bg-accent text-white' : lastError ? 'border-red-500 text-transparent' : 'border-line-strong text-transparent hover:border-accent'"
    >
      <AppIcon fallback="ph:check-bold" :size="12" />
    </span>
  </button>
</template>
