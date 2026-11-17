<script setup lang="ts">
// One row of a menu or a sheet (PopoverMenu): an icon, the label with an optional line under it,
// and at the end a value, a check (ticked) or a caret (it opens another menu). 44px high on a
// phone. Menu rows are not buttons of the five kinds (lib/buttons.ts); this is their one look.
import AppIcon from './AppIcon.vue'

defineProps<{
  icon?: string
  /** Red: removes something. */
  danger?: boolean
  /** The row's current choice, shown at its end. */
  value?: string
  /** Ticked: the choice in force. Not given: no tick room is kept. */
  check?: boolean
  /** The row opens another menu. */
  caret?: boolean
}>()
</script>

<template>
  <button type="button" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent max-md:min-h-11" :class="danger ? 'text-red-600 dark:text-red-400' : ''">
    <AppIcon v-if="icon" :fallback="icon" :size="16" class="shrink-0" :class="danger ? '' : 'text-ink-soft'" />
    <span class="min-w-0 flex-1 break-words">
      <slot />
      <span v-if="$slots.hint" class="block text-xs text-ink-faint"><slot name="hint" /></span>
    </span>
    <slot name="end" />
    <span v-if="value" class="ml-auto max-w-[50%] shrink-0 truncate text-ink-faint">{{ value }}</span>
    <AppIcon v-if="check" fallback="ph:check" class="ml-auto shrink-0 text-accent" />
    <AppIcon v-if="caret" fallback="ph:caret-right" :size="12" class="shrink-0 text-ink-faint" :class="value ? '' : 'ml-auto'" />
  </button>
</template>
