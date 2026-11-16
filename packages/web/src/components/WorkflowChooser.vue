<script setup lang="ts">
import type { ObjectType } from '@vasta/core'
import { reviewEveryOf, triageOptionsOf } from '@vasta/core'
import type { ReviewSession, WorkflowKind } from '../lib/review-session.ts'
import AppIcon from './AppIcon.vue'
import PopoverMenu from './PopoverMenu.vue'

defineProps<{
  type: ObjectType
  anchor: HTMLElement | null
  mode: 'tasks' | 'view'
  spaceName: string
  viewScope: string
  newCount: number
  checkInCount: number
  spaceCount: number
  viewCount: number
  viewAllCount: number
  session: ReviewSession | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ start: [kind: WorkflowKind, scope: 'space' | 'view', all?: boolean]; resume: []; end: [] }>()
const choice = 'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent'
</script>

<template>
  <PopoverMenu v-model:open="open" :anchor="anchor" width="23rem" :label="type.system === 'task' ? 'Review tasks' : 'Review this view'">
    <div class="p-2" data-workflow-chooser>
      <h2 class="px-2 text-lg font-semibold">{{ type.system === 'task' ? 'Review tasks' : 'Review this view' }}</h2>
      <p class="break-words px-2 pb-3 pt-1 text-sm text-ink-soft">{{ mode === 'tasks' ? `All tasks in ${spaceName}, whatever this view shows.` : viewScope }}</p>
      <div v-if="session" class="mb-3 border-b border-line pb-3" data-workflow-paused>
        <button class="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-medium hover:bg-hover" data-process-resume @click="emit('resume')">
          <AppIcon fallback="ph:play" class="shrink-0" /><span class="min-w-0 break-words">Resume {{ session.scopeLabel ?? session.viewName }}</span>
        </button>
        <p class="px-3 text-sm text-ink-soft">{{ session.scopeLabel ?? session.viewName }} · {{ Math.min(session.index + 1, session.ids.length) }} of {{ session.ids.length }}</p>
        <div class="flex items-center justify-between gap-2 px-3 text-xs text-ink-soft">
          <span>Saved on this device</span>
          <button class="min-h-11 px-2 text-sm hover:text-ink" data-process-end-session @click="emit('end')">End session…</button>
        </div>
      </div>
      <template v-if="type.system === 'task'">
        <button :class="choice" :disabled="!newCount && !checkInCount" data-start-review :data-process="mode === 'view' ? '' : undefined" @click="emit('start', 'tasks', mode === 'view' ? 'view' : 'space')">
          <AppIcon fallback="ph:arrows-clockwise" :size="22" class="shrink-0 text-ink-soft" />
          <span class="min-w-0 flex-1"><span class="block font-medium">{{ newCount || checkInCount ? (session ? 'Start a new review' : mode === 'view' ? `Review ${newCount + checkInCount} ${(newCount + checkInCount === 1 ? type.name : type.pluralName).toLowerCase()}` : 'Start the review') : 'Nothing to review' }}</span><span class="block text-sm text-ink-soft">{{ newCount }} new · {{ checkInCount }} {{ checkInCount === 1 ? 'check-in' : 'check-ins' }}</span></span>
          <span class="tabular-nums">{{ newCount + checkInCount }}</span>
        </button>
        <p v-if="!newCount && !checkInCount" class="break-words px-3 pb-2 text-sm text-ink-soft" data-review-none>Nothing to review in {{ mode === 'view' ? viewScope : spaceName }}.</p>
        <button v-if="mode === 'view' && viewAllCount > newCount + checkInCount" :class="choice" data-process-all @click="emit('start', 'tasks', 'view', true)">Review all {{ viewAllCount }} — including recently reviewed</button>
        <dl class="space-y-2 px-3 pb-2 pt-1 text-xs leading-relaxed text-ink-soft">
          <div><dt class="inline font-medium text-ink">New first. </dt><dd class="inline">Tasks with no status<template v-if="triageOptionsOf(type).length"> or {{ triageOptionsOf(type).map((o) => o.label).join(', ') }}</template>: you choose where each one goes.</dd></div>
          <div><dt class="inline font-medium text-ink">Then check-ins. </dt><dd class="inline">{{ reviewEveryOf(type) ? `Open tasks not reviewed in the last ${reviewEveryOf(type)} ${reviewEveryOf(type) === 1 ? 'day' : 'days'}` : 'Every open task, each time' }}: keep the plan or change it. How often is in Type settings › Quick actions.</dd></div>
        </dl>
        <button v-if="mode === 'view'" :class="choice" data-start-space @click="emit('start', 'tasks', 'space')" :disabled="!spaceCount">
          <AppIcon fallback="ph:globe" class="shrink-0 text-ink-soft" />
          <span class="min-w-0 flex-1"><span class="block font-medium">Review all tasks in {{ spaceName }}</span><span class="block text-sm text-ink-soft">Across all views · filters don’t apply</span></span>
          <span class="tabular-nums">{{ spaceCount }}</span>
        </button>
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
