<script setup lang="ts">
// How many steps of an object are done ("2/5"), and "Ready to close" once all are.
defineProps<{ progress: { done: number; total: number; readyToClose: boolean } }>()
</script>

<template>
  <span class="shrink-0 rounded-md border px-1.5 text-xs font-medium tabular-nums" :class="progress.readyToClose ? 'border-[var(--color-flow-done)]/40 text-[var(--color-flow-done)]' : 'border-line text-ink-soft'" data-step-progress>
    {{ progress.done }}/{{ progress.total }}<template v-if="progress.readyToClose"> · Ready to close</template>
  </span>
</template>
