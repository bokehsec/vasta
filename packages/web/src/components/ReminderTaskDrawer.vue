<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api.ts'
import { closesOnBack } from '../lib/back.ts'
import { activeDialog } from '../lib/overlays.ts'
import { loadWorkspace, workspace } from '../lib/state.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const ObjectPage = defineAsyncComponent(() => import('../views/ObjectPage.vue'))
const props = defineProps<{ id: string; popup: boolean }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const panel = ref<HTMLElement | null>(null)
const ready = ref(false)
const error = ref('')
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

closesOnBack(() => true, () => emit('close'))
const removeGuard = router.beforeEach(() => {
  emit('close')
  return false
})

watch(() => props.id, async (id) => {
  ready.value = false
  error.value = ''
  try {
    const object = await api.object(id)
    if (workspace.space?.id !== object.spaceId || !workspace.ready) await loadWorkspace(object.spaceId)
    if (workspace.space?.id !== object.spaceId || !workspace.ready) throw new Error(workspace.error || 'Could not load this task’s space.')
    if (props.id === id) ready.value = true
  } catch (failure) {
    if (props.id === id) error.value = (failure as Error).message
  }
}, { immediate: true })

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && !activeDialog.value) {
    event.preventDefault()
    emit('close')
  }
  if (event.key !== 'Tab' || !(props.popup || isPhone.value) || !panel.value?.contains(document.activeElement)) return
  const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], [contenteditable="true"]')].filter((element) => element.getClientRects().length)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await nextTick()
  panel.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  removeGuard()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <section ref="panel" role="dialog" :aria-modal="popup || isPhone ? true : undefined" aria-label="Task beside the reminder" tabindex="-1" class="fixed z-30 flex flex-col border-l border-line bg-surface pt-[env(safe-area-inset-top)] shadow-xl outline-none" :class="popup || isPhone ? 'inset-0' : 'inset-y-0 right-0 w-1/2'" data-reminder-task-drawer>
      <div class="shrink-0 border-b border-line px-3 py-2">
        <button type="button" class="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-ink-soft hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11" @click="emit('close')"><AppIcon fallback="ph:arrow-left" :size="18" /> Back to reminder</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <p v-if="error" class="p-5 text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        <ObjectPage v-else-if="ready" :id="id" :key="id" variant="pane" />
        <p v-else class="p-5 text-sm text-ink-faint">Loading task…</p>
      </div>
    </section>
  </Teleport>
</template>
