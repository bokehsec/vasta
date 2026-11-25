<script setup lang="ts">
// The review's place and its list, in one button in the header: "3 of 7 · Next: Renew passport ▾", or
// "7 of 7 · Last one ▾" on the last task. The title is never cut off: a long one wraps. It opens the
// session's tasks in three groups: Done (what was decided here, with what happened), Now (the task at
// hand, marked) and Coming up (the rest, the next ones first). A task in the list is a way to it: ProcessMode
// saves what is typed and goes there. Under the button on a big screen, a sheet on a phone.
import { computed, nextTick, ref, watch } from 'vue'
import type { Id } from '@vasta/core'
import { currentId, sessionList, type ReviewSession } from '../lib/review-session.ts'
import { isPhone } from '../lib/viewport.ts'
import { bodyText, metaText, phoneUiText } from '../lib/type-scale.ts'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ session: ReviewSession; titleOf: (id: Id) => string; outcomeOf: (id: Id, name: string) => string; blocked: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ jump: [id: Id] }>()

const button = ref<HTMLElement | null>(null)
const total = computed(() => props.session.ids.length)
const at = computed(() => Math.min(props.session.index + 1, total.value))
const nextId = computed(() => props.session.ids[props.session.index + 1])
const label = computed(() => `${at.value} of ${total.value} · ${nextId.value ? `Next: ${props.titleOf(nextId.value)}` : 'Last one'}`)
const list = computed(() => sessionList(props.session))
// Opened by its button on a big screen, the task at hand takes the focus (a phone's sheet takes it itself).
const panel = ref<HTMLElement | null>(null)
watch(open, async (value) => {
  if (!value || isPhone.value) return
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  panel.value?.querySelector<HTMLElement>('[data-process-list-now], [data-process-list-item]')?.focus({ preventScroll: true })
})
const pick = (id: Id) => {
  open.value = false
  if (id !== currentId(props.session)) emit('jump', id)
}
const row = `flex min-h-9 w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover max-md:min-h-11 max-md:items-center max-md:text-base ${bodyText}`
const heading = `px-2 pb-0.5 pt-2 font-semibold text-ink-faint ${metaText} max-md:text-sm`
</script>

<template>
  <button ref="button" type="button" class="min-h-9 min-w-0 max-w-full break-words rounded-lg px-2 py-1.5 text-left text-ink-soft hover:bg-hover hover:text-ink disabled:opacity-50 max-md:min-h-11 max-md:py-2" :class="[bodyText, phoneUiText]" :disabled="blocked" aria-haspopup="dialog" :aria-expanded="open" data-process-next data-process-list-button @click="open = !open">
    <span class="tabular-nums" data-process-next-label>{{ label }}</span><span aria-hidden="true" class="ml-1.5 text-ink-faint">▾</span>
  </button>
  <PopoverMenu v-model:open="open" :anchor="button" placement="bottom-end" width="26rem" label="Tasks in this review">
    <div ref="panel" class="p-1" data-process-list>
      <p class="px-2 pb-1 pt-1 font-medium max-md:text-base" :class="bodyText" data-process-list-scope>{{ session.scopeLabel }}</p>
      <template v-if="list.done.length">
        <p :class="heading" data-process-list-group="Done">Done</p>
        <button v-for="item in list.done" :key="item.id" type="button" :class="row" data-process-list-item @click="pick(item.id)">
          <span class="min-w-0 break-words">{{ titleOf(item.id) }}</span><span class="shrink-0 text-ink-soft" :class="metaText" data-process-list-outcome>{{ outcomeOf(item.id, item.outcome) }}</span>
        </button>
      </template>
      <template v-if="list.now">
        <p :class="heading" data-process-list-group="Now">Now</p>
        <button type="button" :class="[row, 'bg-hover font-medium']" aria-current="true" data-process-list-item data-process-list-now @click="pick(list.now)">
          <span class="min-w-0 break-words">{{ titleOf(list.now) }}</span>
        </button>
      </template>
      <template v-if="list.coming.length">
        <p :class="heading" data-process-list-group="Coming up">Coming up</p>
        <button v-for="id in list.coming" :key="id" type="button" :class="row" data-process-list-item @click="pick(id)">
          <span class="min-w-0 break-words">{{ titleOf(id) }}</span>
        </button>
      </template>
    </div>
  </PopoverMenu>
</template>
