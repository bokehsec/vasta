<script setup lang="ts">
import type { ObjectType } from '@vasta/core'
import { reviewEveryOf, triageOptionsOf } from '@vasta/core'
import { workflowTitle, type ReviewSession, type WorkflowKind } from '../lib/review-session.ts'
import AppIcon from './AppIcon.vue'
import PopoverMenu from './PopoverMenu.vue'

defineProps<{
  type: ObjectType
  anchor: HTMLElement | null
  mode: 'tasks' | 'view'
  spaceName: string
  viewScope: string
  triageCount: number
  reviewCount: number
  viewCount: number
  viewAllCount: number
  session: ReviewSession | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ start: [kind: WorkflowKind, scope: 'space' | 'view', all?: boolean]; resume: []; end: [] }>()
const choice = 'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent'
</script>

<template>
  <PopoverMenu v-model:open="open" :anchor="anchor" width="23rem" :label="mode === 'tasks' ? 'Triage & review' : 'Review this view'">
    <div class="p-2" data-workflow-chooser>
      <h2 class="px-2 text-lg font-semibold">{{ mode === 'tasks' ? 'Triage & review' : 'Review this view' }}</h2>
      <p class="px-2 pb-3 pt-1 text-sm text-ink-soft">{{ mode === 'tasks' ? `All tasks in ${spaceName}. Your current view and filters do not limit these queues.` : viewScope }}</p>
      <div v-if="session" class="mb-3 border-b border-line pb-3" data-workflow-paused>
        <button class="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-medium hover:bg-hover" data-process-resume @click="emit('resume')">
          <AppIcon fallback="ph:play" class="shrink-0" />Resume {{ session.scope === 'space' ? workflowTitle(session).toLowerCase() : `review of ${session.viewName}` }}
        </button>
        <p class="px-3 text-sm text-ink-soft">{{ session.scopeLabel ?? session.viewName }} · {{ Math.min(session.index + 1, session.ids.length) }} of {{ session.ids.length }}</p>
        <div class="flex items-center justify-between gap-2 px-3 text-xs text-ink-soft">
          <span>Saved on this device</span>
          <button class="min-h-11 px-2 text-sm hover:text-ink" data-process-end-session @click="emit('end')">End session…</button>
        </div>
      </div>
      <template v-if="mode === 'tasks'">
        <button :class="choice" :disabled="!triageCount" data-start-triage @click="emit('start', 'triage', 'space')">
          <AppIcon fallback="ph:tray" :size="22" class="shrink-0 text-ink-soft" />
          <span class="min-w-0 flex-1"><span class="block font-medium">Triage incoming</span><span class="block text-sm text-ink-soft">{{ triageCount ? 'Decide what happens next' : 'No incoming tasks to triage' }}</span></span>
          <span class="tabular-nums">{{ triageCount }}</span>
        </button>
        <p class="px-3 pb-3 text-xs leading-relaxed text-ink-soft">No status<template v-if="triageOptionsOf(type).length"> or {{ triageOptionsOf(type).map((o) => o.label).join(', ') }}</template>. Recent reviews do not hide incoming work.</p>
        <div class="border-t border-line" />
        <button :class="choice" :disabled="!reviewCount" data-start-review @click="emit('start', 'review', 'space')">
          <AppIcon fallback="ph:arrows-clockwise" :size="22" class="shrink-0 text-ink-soft" />
          <span class="min-w-0 flex-1"><span class="block font-medium">Review commitments</span><span class="block text-sm text-ink-soft">{{ reviewCount ? 'Confirm or change the plan' : 'No commitments due for review' }}</span></span>
          <span class="tabular-nums">{{ reviewCount }}</span>
        </button>
        <p class="px-3 pb-2 text-xs leading-relaxed text-ink-soft">Open tasks outside Triage, including parked work. {{ reviewEveryOf(type) ? `Never reviewed, or last reviewed at least ${reviewEveryOf(type)} days ago.` : 'Every open commitment, each time.' }}</p>
      </template>
      <template v-else>
        <p class="px-3 pb-2 text-sm text-ink-soft">Open {{ type.pluralName.toLowerCase() }} matching this view, search and Mine. Reviewing does not settle incoming tasks.</p>
        <button :class="choice" :disabled="!viewCount" data-process @click="emit('start', 'review', 'view')">
          <AppIcon fallback="ph:play" class="shrink-0" /><span class="flex-1">Review {{ viewCount }} {{ (viewCount === 1 ? type.name : type.pluralName).toLowerCase() }}</span>
        </button>
        <p v-if="!viewCount" class="px-3 text-sm text-ink-soft" data-review-none>{{ viewAllCount ? 'None due for review in this view.' : 'No open items match this view.' }}</p>
        <button v-if="viewAllCount > viewCount" :class="choice" data-process-all @click="emit('start', 'review', 'view', true)">Review all {{ viewAllCount }} — including recently reviewed</button>
      </template>
    </div>
  </PopoverMenu>
</template>
