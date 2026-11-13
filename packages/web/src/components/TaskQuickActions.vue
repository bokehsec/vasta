<script setup lang="ts">
// A task's quick actions: Done, Defer (a day: tomorrow, next week or one picked on a small calendar)
// and Drop, on its page, and on its row in a view or query that turns them on (`variant` 'row':
// icons, plus the next step when the type names a field for it). What each sets comes from the type
// (Type settings › Quick actions, @vasta/core task-actions.ts); a button the type cannot do is left
// out, and closed tasks show none. The page or list applies the values; Undo in the notice puts the
// previous ones back, saving them itself once this is gone (the next task opened in the side pane, a
// row the list no longer shows).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { DateValue, Id, ObjectRecord, ObjectType, PropertyValue } from '@vasta/core'
import { DUE_PROPERTY_ID, addDays, isClosedTask, quickActionValues, resolveQuickActions, type QuickAction } from '@vasta/core'
import { dayKey, setProperties } from '../lib/actions.ts'
import { nextWeekStart } from '../lib/calendar.ts'
import { formatLongDay } from '../lib/format.ts'
import { lastError, notice } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import MiniMonth from './calendar/MiniMonth.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType; object: Pick<ObjectRecord, 'id' | 'props'>; variant?: 'page' | 'row' }>()
const emit = defineEmits<{ set: [values: Record<Id, PropertyValue | undefined>] }>()

const row = computed(() => props.variant === 'row')
const resolved = computed(() => resolveQuickActions(props.type))
const nextStepField = computed(() => (row.value ? resolved.value.nextStepField : undefined))
const shown = computed(() => !isClosedTask(props.type, props.object) && !!(resolved.value.done || resolved.value.deferField || resolved.value.drop || nextStepField.value))

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

// The next step: typed in a small box under its button; Enter saves, an empty one clears it.
const nextAnchor = ref<HTMLElement | null>(null)
const nextOpen = ref(false)
const nextText = ref('')
const nextInput = ref<HTMLInputElement | null>(null)
function openNextStep() {
  const value = props.object.props[nextStepField.value?.id ?? '']
  nextText.value = value?.kind === 'text' ? value.value : ''
  nextOpen.value = true
  void nextTick(() => nextInput.value?.select())
}
function saveNextStep() {
  nextOpen.value = false
  const field = nextStepField.value
  if (!field) return
  const current = props.object.props[field.id]
  if (nextText.value.trim() === (current?.kind === 'text' ? current.value : '')) return
  run({ kind: 'next-step', text: nextText.value }, nextText.value.trim() ? `${field.name} saved` : `${field.name} cleared`)
}

const pageButton = 'flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5'
const rowButton = 'grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink max-md:h-9 max-md:w-9'
</script>

<template>
  <!-- On a row inside a link, clicks stay here. -->
  <div v-if="shown" :class="row ? 'flex shrink-0 items-center' : 'mt-3 flex flex-wrap items-center gap-1.5 text-sm'" data-quick-actions @click.stop.prevent>
    <button v-if="resolved.done" :class="row ? rowButton : pageButton" :title="row ? resolved.done.label : undefined" @click="run({ kind: 'done' }, `Marked ${resolved.done.label.toLowerCase()}`)">
      <AppIcon fallback="ph:check-circle" :size="row ? 17 : 15" /><template v-if="!row"> {{ resolved.done.label }}</template>
    </button>
    <button v-if="resolved.deferField" ref="deferAnchor" :class="row ? rowButton : pageButton" :title="row ? 'Defer' : undefined" :aria-expanded="deferOpen" @click="deferOpen = !deferOpen">
      <AppIcon fallback="ph:clock-clockwise" :size="row ? 17 : 15" /><template v-if="!row"> Defer</template>
    </button>
    <button v-if="resolved.drop" :class="row ? rowButton : pageButton" :title="row ? 'Drop' : undefined" @click="run({ kind: 'drop' }, `Marked ${resolved.drop.label.toLowerCase()}`)">
      <AppIcon fallback="ph:x-circle" :size="row ? 17 : 15" /><template v-if="!row"> Drop</template>
    </button>
    <button v-if="nextStepField" ref="nextAnchor" :class="rowButton" :title="nextStepField.name" :aria-expanded="nextOpen" @click="openNextStep">
      <AppIcon fallback="ph:pencil-simple-line" :size="17" />
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
    <PopoverMenu v-if="nextStepField" v-model:open="nextOpen" :anchor="nextAnchor" placement="bottom-end" width="20rem">
      <form class="p-2" data-next-step @submit.prevent="saveNextStep">
        <label class="mb-1 block text-xs text-ink-faint" :for="`next-step-${object.id}`">{{ nextStepField.name }}</label>
        <input
          :id="`next-step-${object.id}`"
          ref="nextInput"
          v-model="nextText"
          class="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong"
          placeholder="What happens next"
          @keydown.escape.stop="nextOpen = false"
        />
      </form>
    </PopoverMenu>
  </div>
</template>
