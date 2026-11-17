<script setup lang="ts">
// The Review button of a type page (DESIGN_SYSTEM.md › Buttons): tinted with the count while
// something waits (the new tasks of the space and this view's check-ins), grey without. With a
// paused review it says "Resume 4 of 12", and when that review covers somewhere else than this
// view, says where and offers "Review this view instead" beside it. Another type than tasks has the
// button only while a review is paused (it starts from the view's ⋯ menu).
import { greyButton, quietButton, tintedButton } from '../lib/buttons.ts'
import type { ReviewControl } from '../lib/use-review-session.ts'
import AppIcon from './AppIcon.vue'

defineProps<{ review: ReviewControl; loading: boolean }>()
</script>

<template>
  <div v-if="!loading && (review.isTask.value || review.session.value)" class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" :class="review.pausedElsewhere.value ? 'max-md:basis-full' : ''" data-review-bar>
    <button
      :class="review.session.value || review.toReview.value ? tintedButton : greyButton"
      class="min-w-0"
      :title="review.session.value ? `Resume ${review.session.value.scopeLabel}` : review.primaryLabel.value"
      aria-live="polite"
      :data-review-tasks="review.isTask.value ? '' : undefined"
      :data-process-resume="review.isTask.value ? undefined : ''"
      @click="review.press($event.currentTarget as HTMLElement)"
    >
      <template v-if="review.session.value"><AppIcon fallback="ph:play" /> Resume <span class="tabular-nums" :data-process-resume="review.isTask.value ? '' : undefined">{{ review.position.value }}</span></template>
      <template v-else><AppIcon fallback="ph:arrows-clockwise" />{{ review.primaryScope.value === 'view' ? 'Review' : 'Review all' }} <span v-if="review.toReview.value" class="tabular-nums">{{ review.toReview.value }}</span></template>
    </button>
    <template v-if="review.session.value && review.pausedElsewhere.value">
      <span class="min-w-0 break-words text-sm text-ink-soft" data-review-paused-scope>in {{ review.session.value.scopeLabel }}</span>
      <button :class="quietButton" data-review-this-instead @click="review.startInstead($event.currentTarget as HTMLElement)">Review this view instead</button>
    </template>
  </div>
</template>
