<script setup lang="ts">
// The end of a group that shows only its first part: how many are drawn of how many, and more of
// them when this comes near the viewport (`auto`: it asks again after each step, as the parent
// keys it by how many are drawn) or when pressed. Drawing a type's thousands of objects at once
// takes seconds; sorting, grouping and filters still see them all.
import type { Directive } from 'vue'
import { quietButton } from '../lib/buttons.ts'
import { locale, t } from '../lib/i18n.ts'

defineProps<{ shown: number; total: number; auto?: boolean }>()
const emit = defineEmits<{ more: [] }>()

/** Calls its value when the element comes near the viewport. */
const vNear: Directive<HTMLElement & { near?: IntersectionObserver }, () => void> = {
  mounted(el, binding) {
    if (typeof IntersectionObserver === 'undefined') return
    el.near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && binding.value(), { rootMargin: '600px' })
    el.near.observe(el)
  },
  unmounted: (el) => el.near?.disconnect(),
}
</script>

<template>
  <button type="button" v-near="() => { if (auto) emit('more') }" :class="[quietButton, 'mt-2 w-full']" @click="emit('more')">
    {{ t('views.showMoreCount', { shown: shown.toLocaleString(locale), total: total.toLocaleString(locale) }) }}
  </button>
</template>
