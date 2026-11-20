<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { addDays, canonicalJson, taskDatesOf, type ObjectType, type PropertyValue } from '@vasta/core'
import { api, type NagView } from '../lib/api.ts'
import { dayKey, setProperties } from '../lib/actions.ts'
import { formatDayShort, formatWeekday } from '../lib/calendar.ts'
import { lastError, notice, typesById } from '../lib/state.ts'
import { setTaskDone } from '../lib/task-completion.ts'
import { mergeReminderTasks, useHandledReminderTasks, type ReminderTask } from '../lib/reminder-tasks.ts'
import AppIcon from './AppIcon.vue'
import ObjectLink from './ObjectLink.vue'
import PopoverMenu from './PopoverMenu.vue'
import MiniMonth from './calendar/MiniMonth.vue'

const props = defineProps<{ nag: NagView; disabled: boolean }>()
const emit = defineEmits<{ open: [id: string]; handled: [] }>()
const rows = ref<ReminderTask[]>([])
const types = ref(new Map<string, ObjectType>())
const previousPlans = new Map<string, { field: string; value: PropertyValue | undefined }>()
const picker = ref<ReminderTask | null>(null)
const anchor = ref<HTMLElement | null>(null)
const pickerOpen = ref(false)
const groups = computed(() => (['due', 'planned'] as const).map((id) => ({ id, title: id === 'due' ? 'Due' : 'Planned', rows: rows.value.filter((row) => row.group === id) })).filter((group) => group.rows.length))

async function typeOf(row: ReminderTask) {
  const known = typesById.value.get(row.typeId) ?? types.value.get(row.typeId)
  if (known) return known
  const type = await api.type(row.typeId)
  types.value.set(type.id, type)
  return type
}

watch(() => props.nag, (view, before) => {
  if (view.id !== before?.id) {
    rows.value = []
    previousPlans.clear()
    pickerOpen.value = false
  }
  rows.value = mergeReminderTasks(rows.value, view)
}, { immediate: true })

useHandledReminderTasks(() => rows.value, () => !props.disabled && !props.nag.outcome && (props.nag.ack === 'done' || props.nag.ack === 'ok'), () => emit('handled'))

async function change(row: ReminderTask, save: () => Promise<void>) {
  if (row.busy || props.disabled) return
  row.busy = true
  row.error = ''
  try {
    await save()
  } catch (error) {
    row.error = (error as Error).message
  } finally {
    row.busy = false
  }
}

async function toggle(row: ReminderTask) {
  await change(row, async () => {
    lastError.value = ''
    const saved = await setTaskDone(row.id, await typeOf(row), !row.done)
    if (!saved) {
      if (lastError.value) throw new Error(lastError.value)
      return
    }
    row.done = !row.done
    const undo = notice.value?.action
    if (undo) undo.run = ((run) => () => change(row, async () => {
      lastError.value = ''
      await run()
      const restored = await api.object(row.id)
      if (canonicalJson(restored.props) !== canonicalJson(saved.props)) row.done = !row.done
      if (lastError.value) throw new Error(lastError.value)
    }))(undo.run)
  })
}

async function move(row: ReminderTask, day: string) {
  pickerOpen.value = false
  await change(row, async () => {
    const plan = taskDatesOf(await typeOf(row)).plan
    if (!plan) throw new Error('This task type has no Do date. Add one in its type settings to move tasks.')
    const object = await api.object(row.id)
    const before = { field: plan.id, value: object.props[plan.id] }
    await setProperties(row.id, { [plan.id]: { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } } })
    if (!previousPlans.has(row.id)) previousPlans.set(row.id, before)
    row.movedTo = day
  })
}

async function undoMove(row: ReminderTask) {
  await change(row, async () => {
    const before = previousPlans.get(row.id)
    if (!before) return
    await setProperties(row.id, { [before.field]: before.value })
    row.movedTo = undefined
    previousPlans.delete(row.id)
  })
}

function pick(row: ReminderTask, event: MouseEvent) {
  picker.value = row
  anchor.value = event.currentTarget as HTMLElement
  pickerOpen.value = true
}

function openTask(id: string, event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('open', id)
}

const movedLabel = (day: string) => `Moved to ${day === addDays(dayKey(), 1) ? 'tomorrow' : `${formatWeekday(day)} ${formatDayShort(day)}`}`
</script>

<template>
  <div class="space-y-3" data-reminder-tasks>
    <section v-for="group in groups" :key="group.id">
      <h2 v-if="groups.length > 1" class="mb-2 text-sm font-semibold text-ink-soft">{{ group.title }}</h2>
      <ul class="divide-y divide-line rounded-2xl border border-line bg-surface shadow-sm">
        <li v-for="row in group.rows" :key="row.id" class="px-3 py-2" :data-task="row.id" :aria-busy="row.busy">
          <div class="flex items-center gap-1">
            <button type="button" role="checkbox" :aria-checked="row.done" :aria-label="`${row.done ? 'Reopen' : 'Complete'} ${row.title}`" :title="row.done ? 'Mark not done' : 'Mark done'" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 max-md:h-11 max-md:w-11" :class="row.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-faint'" :disabled="disabled || row.busy" @click="toggle(row)">
              <AppIcon :fallback="row.done ? 'ph:check-circle-fill' : 'ph:circle'" :size="21" />
            </button>
            <div class="min-w-0 flex-1" :class="row.done || row.movedTo ? 'text-ink-faint' : ''">
              <ObjectLink :id="row.id" class="block break-words rounded py-1 text-sm hover:underline max-md:min-h-11 max-md:py-3" :class="row.done ? 'line-through' : ''" @click="openTask(row.id, $event)">{{ row.title }}</ObjectLink>
              <p v-if="row.movedTo" class="text-xs" role="status">{{ movedLabel(row.movedTo) }}</p>
            </div>
            <button v-if="row.movedTo" type="button" class="h-8 rounded-lg px-2 text-xs text-ink-soft hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 max-md:h-11 max-md:min-w-11" :disabled="disabled || row.busy" :aria-label="`Undo moving ${row.title}`" @click="undoMove(row)">Undo</button>
            <template v-if="!row.done">
              <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 max-md:h-11 max-md:w-11" title="Move to tomorrow" :aria-label="`Move ${row.title} to tomorrow`" :disabled="disabled || row.busy" @click="move(row, addDays(dayKey(), 1))"><AppIcon fallback="ph:arrow-right" :size="18" /></button>
              <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 max-md:h-11 max-md:w-11" title="Pick another day" :aria-label="`Pick a Do date for ${row.title}`" :disabled="disabled || row.busy" @click="pick(row, $event)"><AppIcon fallback="ph:calendar-blank" :size="18" /></button>
            </template>
          </div>
          <p v-if="row.error" class="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{{ row.error }}</p>
        </li>
      </ul>
    </section>
    <p v-if="!rows.length" class="rounded-2xl border border-line bg-surface px-5 py-3 text-ink-faint">No tasks due or planned today.</p>
    <PopoverMenu v-model:open="pickerOpen" :anchor="anchor" width="340px" label="Pick a Do date">
      <MiniMonth :selected="picker?.movedTo ?? dayKey()" @pick="picker && move(picker, $event)" />
    </PopoverMenu>
  </div>
</template>
