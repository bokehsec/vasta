<script setup lang="ts">
// A link to an object. Its href is always the object's page, so ⌘/Ctrl-click, middle click and
// "Copy link" behave as links do; `opens="pane"` makes a plain click open it in the side pane
// instead (lib/open.ts decides when there is room for one), and marks the link of the object the
// pane shows.
import { computed } from 'vue'
import type { Id } from '@vasta/core'
import { router } from '../router.ts'
import { objectRoute, openObject, paneObjectId, type OpenPlace } from '../lib/open.ts'

const props = defineProps<{ id: Id; block?: Id | undefined; opens?: OpenPlace }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()

const href = computed(() => router.resolve(objectRoute(props.id, { block: props.block })).href)
const inPane = computed(() => props.opens === 'pane' && paneObjectId.value === props.id)

function onClick(event: MouseEvent) {
  emit('click', event)
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void openObject(props.id, { block: props.block, where: props.opens })
}
</script>

<template>
  <a :href="href" :aria-current="inPane ? 'true' : undefined" class="aria-[current=true]:bg-hover" @click="onClick"><slot /></a>
</template>
