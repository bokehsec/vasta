<script setup lang="ts">
// A task's quick actions on its page: Done, Defer (a day: tomorrow, next week or one picked on a
// small calendar) and Drop. What each sets comes from the type (Type settings › Quick actions,
// @vasta/core task-actions.ts); a button the type cannot do is left out, and closed tasks show none.
// The page applies the values; Undo in the notice puts the previous ones back, saving them itself
// once the page is gone (the next task opened in the side pane).
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DateValue, Id, ObjectRecord, ObjectType, PropertyValue } from '@vasta/core'
import { DUE_PROPERTY_ID, addDays, isClosedTask, quickActionValues, resolveQuickActions, type QuickAction } from '@vasta/core'
import { dayKey, setProperties } from '../lib/actions.ts'
import { nextWeekStart } from '../lib/calendar.ts'
import { formatLongDay } from '../lib/format.ts'
import { lastError, notice } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import MiniMonth from './calendar/MiniMonth.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType; object: ObjectRecord }>()
const emit = defineEmits<{ set: [values: Record<Id, PropertyValue | undefined>] }>()

const resolved = computed(() => resolveQuickActions(props.type))
const shown = computed(() => !isClosedTask(props.type, props.object) && !!(resolved.value.done || resolved.value.deferField || resolved.value.drop))

/** The day a date value falls on, here. */
const dayOf = (value: PropertyValue | undefined) => {
  if (value?.kind !== 'date') return undefined
  const date: DateValue = value.value
  return date.resolution === 'day' ? date.start.slice(0, 10) : dayKey(new Date(date.start))
}
const longDay = (day: string) => formatLongDay(`${day}T00:00:00.000Z`)

/** The due date, when Defer sets another date: deferring past it is allowed, and said. */
const due = computed(() => (resolved.value.deferField?.id === DUE_PROPERTY_ID ? undefined : dayOf(props.object.props[DUE_PROPERTY_ID])))

const deferAnchor = ref<HTMLElement | null>(null)
const deferOpen = ref(false)
const deferDay = computed(() => dayOf(props.object.props[resolved.value.deferField?.id ?? '']) ?? dayKey())
const tomorrow = computed(() => addDays(dayKey(), 1))
const nextWeek = computed(() => nextWeekStart())

let mounted = true
onBeforeUnmount(() => (mounted = false))

function run(action: QuickAction, message: string) {
  const values = quickActionValues(props.type, props.object, action)
  if (!values) return
  const id = props.object.id
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, props.object.props[key]]))
  emit('set', values)
  const undo = () => (mounted && props.object.id === id ? emit('set', before) : setProperties(id, before).catch((error: Error) => (lastError.value = error.message)))
  notice.value = { message, action: { label: 'Undo', run: undo } }
}

function defer(day: string) {
  deferOpen.value = false
  const late = due.value && day > due.value ? ` (after its due date, ${longDay(due.value)})` : ''
  run({ kind: 'defer', day }, `Deferred to ${longDay(day)}${late}`)
}
</script>

<template>
  <div v-if="shown" class="mt-3 flex flex-wrap items-center gap-1.5 text-sm" data-quick-actions>
    <button
      v-if="resolved.done"
      class="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5"
      @click="run({ kind: 'done' }, `Marked ${resolved.done.label.toLowerCase()}`)"
    >
      <AppIcon fallback="ph:check-circle" :size="15" /> {{ resolved.done.label }}
    </button>
    <button
      v-if="resolved.deferField"
      ref="deferAnchor"
      class="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5"
      :aria-expanded="deferOpen"
      @click="deferOpen = !deferOpen"
    >
      <AppIcon fallback="ph:clock-clockwise" :size="15" /> Defer
    </button>
    <button
      v-if="resolved.drop"
      class="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5"
      @click="run({ kind: 'drop' }, `Marked ${resolved.drop.label.toLowerCase()}`)"
    >
      <AppIcon fallback="ph:x-circle" :size="15" /> Drop
    </button>
    <PopoverMenu v-model:open="deferOpen" :anchor="deferAnchor" width="17rem">
      <div class="space-y-3 p-2 text-sm" data-defer-menu>
        <div class="flex gap-2">
          <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="defer(tomorrow)">Tomorrow</button>
          <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="defer(nextWeek)">Next week</button>
        </div>
        <MiniMonth :selected="deferDay" @pick="defer" />
        <p v-if="due" class="flex items-center gap-1.5 text-xs text-ink-faint">
          <AppIcon fallback="ph:flag" :size="12" /> Due {{ longDay(due) }}
        </p>
      </div>
    </PopoverMenu>
  </div>
</template>
