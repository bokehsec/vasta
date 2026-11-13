<script setup lang="ts">
// A task's quick actions (Type settings › Quick actions, @vasta/core task-actions.ts): a button per
// action, on its page (icon and name) and on its row in a list or table that shows them (`variant`
// 'row': icons). An action that asks for a value opens a small box first: a day (tomorrow, next week
// or one picked on a calendar, with the due date shown when it sets another date) or a line of text;
// an empty line clears the field. Closed tasks show none. The page or list applies the values; Undo
// in the notice puts the previous ones back, saving them itself once this is gone (the next task
// opened in the side pane, a row the list no longer shows).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { DateValue, Id, ObjectRecord, ObjectType, PropertyDef, PropertyValue, QuickActionDef } from '@vasta/core'
import { DUE_PROPERTY_ID, addDays, askOf, isClosedTask, quickActionChanges, quickActionsOf } from '@vasta/core'
import { dayKey, setProperties } from '../lib/actions.ts'
import { nextWeekStart } from '../lib/calendar.ts'
import { formatLongDay } from '../lib/format.ts'
import { session } from '../lib/session.ts'
import { lastError, notice } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'
import MiniMonth from './calendar/MiniMonth.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType; object: Pick<ObjectRecord, 'id' | 'props'>; variant?: 'page' | 'row' }>()
const emit = defineEmits<{ set: [values: Record<Id, PropertyValue | undefined>] }>()

const row = computed(() => props.variant === 'row')
const actions = computed(() => quickActionsOf(props.type))
const shown = computed(() => actions.value.length > 0 && !isClosedTask(props.type, props.object))

/** The day a date value falls on, here. */
const dayOf = (value: PropertyValue | undefined) => {
  if (value?.kind !== 'date') return undefined
  const date: DateValue = value.value
  return date.resolution === 'day' ? date.start.slice(0, 10) : dayKey(new Date(date.start))
}
const longDay = (day: string) => formatLongDay(`${day}T00:00:00.000Z`)
const due = computed(() => dayOf(props.object.props[DUE_PROPERTY_ID]))

let mounted = true
onBeforeUnmount(() => (mounted = false))

function apply(action: QuickActionDef, answer?: PropertyValue, clearAsked = false) {
  const ask = askOf(props.type, action)
  const run = clearAsked && ask ? { ...action, changes: action.changes.map((c) => (c === ask.change ? { ...c, value: { kind: 'clear' as const } } : c)) } : action
  const values = quickActionChanges(props.type, props.object, run, { today: dayKey(), nextWeek: nextWeekStart(), me: session.user?.id }, answer)
  if (!values) return
  const id = props.object.id
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, props.object.props[key]]))
  emit('set', values)
  // The message names the action and the days it set; a date set past the due date is said.
  const days = Object.entries(values).flatMap(([field, value]) => {
    const day = dayOf(value)
    const def = props.type.properties.find((p) => p.id === field)
    return day && def ? [{ field, day, name: def.name }] : []
  })
  const late = days.find((d) => d.field !== DUE_PROPERTY_ID && due.value && d.day > due.value)
  const message = [action.name, ...days.map((d) => `${d.name} ${longDay(d.day)}`)].join(' · ') + (late && due.value ? ` (after its due date, ${longDay(due.value)})` : '')
  const undo = () => (mounted && props.object.id === id ? emit('set', before) : setProperties(id, before).catch((error: Error) => (lastError.value = error.message)))
  notice.value = { message, action: { label: 'Undo', run: undo } }
}

// Asking: one box at a time, under the button pressed.
const asking = ref<{ action: QuickActionDef; def: PropertyDef } | null>(null)
const askAnchor = ref<HTMLElement | null>(null)
const askOpen = computed({ get: () => !!asking.value, set: (open) => !open && (asking.value = null) })
const text = ref('')
const textInput = ref<HTMLInputElement | null>(null)

function press(event: MouseEvent, action: QuickActionDef) {
  const ask = askOf(props.type, action)
  if (!ask) return apply(action)
  askAnchor.value = event.currentTarget as HTMLElement
  const current = props.object.props[ask.def.id]
  text.value = current?.kind === 'text' || current?.kind === 'url' ? current.value : current?.kind === 'number' ? String(current.value) : ''
  asking.value = { action, def: ask.def }
  if (ask.def.kind !== 'date') void nextTick(() => textInput.value?.select())
}

const askDay = computed(() => (asking.value ? (dayOf(props.object.props[asking.value.def.id]) ?? dayKey()) : dayKey()))
const askDue = computed(() => (asking.value && asking.value.def.id !== DUE_PROPERTY_ID ? due.value : undefined))
const tomorrow = computed(() => addDays(dayKey(), 1))
const nextWeek = computed(() => nextWeekStart())

function answerDay(day: string) {
  const ask = asking.value
  asking.value = null
  if (ask) apply(ask.action, { kind: 'date', value: { start: `${day}T00:00:00.000Z`, resolution: 'day' } })
}

function answerText() {
  const ask = asking.value
  asking.value = null
  if (!ask) return
  const value = text.value.trim()
  const current = props.object.props[ask.def.id]
  const before = current?.kind === 'text' || current?.kind === 'url' ? current.value : current?.kind === 'number' ? String(current.value) : ''
  if (value === before && ask.action.changes.length === 1) return
  if (!value) return apply(ask.action, undefined, true)
  if (ask.def.kind === 'number') {
    const number = Number(value.replace(',', '.'))
    if (Number.isFinite(number)) apply(ask.action, { kind: 'number', value: number })
  } else apply(ask.action, { kind: ask.def.kind === 'url' ? 'url' : 'text', value })
}

const pageButton = 'flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink max-md:py-1.5'
const rowButton = 'grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink max-md:h-9 max-md:w-9'
</script>

<template>
  <!-- On a row inside a link, clicks stay here. -->
  <div v-if="shown" :class="row ? 'flex shrink-0 flex-wrap items-center' : 'mt-3 flex flex-wrap items-center gap-1.5 text-sm'" data-quick-actions @click.stop.prevent>
    <button
      v-for="action in actions"
      :key="action.id"
      :class="row ? rowButton : pageButton"
      :title="row ? action.name : undefined"
      :aria-expanded="asking?.action.id === action.id || undefined"
      :data-action="action.id"
      @click="press($event, action)"
    >
      <AppIcon :icon="action.icon" fallback="ph:lightning" :size="row ? 17 : 15" /><template v-if="!row"> {{ action.name }}</template>
    </button>
    <PopoverMenu v-model:open="askOpen" :anchor="askAnchor" :placement="asking?.def.kind === 'date' ? 'bottom-start' : 'bottom-end'" :width="asking?.def.kind === 'date' ? '17rem' : '20rem'">
      <div v-if="asking?.def.kind === 'date'" class="space-y-3 p-2 text-sm" data-defer-menu>
        <div class="flex gap-2">
          <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="answerDay(tomorrow)">Tomorrow</button>
          <button class="flex-1 rounded-lg bg-hover px-2.5 py-1.5 hover:bg-line" @click="answerDay(nextWeek)">Next week</button>
        </div>
        <MiniMonth :selected="askDay" @pick="answerDay" />
        <p v-if="askDue" class="flex items-center gap-1.5 text-xs text-ink-faint">
          <AppIcon fallback="ph:flag" :size="12" /> Due {{ longDay(askDue) }}
        </p>
      </div>
      <form v-else-if="asking" class="p-2" data-next-step @submit.prevent="answerText">
        <label class="mb-1 block text-xs text-ink-faint" :for="`quick-ask-${object.id}`">{{ asking.def.name }}</label>
        <input
          :id="`quick-ask-${object.id}`"
          ref="textInput"
          v-model="text"
          :inputmode="asking.def.kind === 'number' ? 'decimal' : asking.def.kind === 'url' ? 'url' : 'text'"
          class="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong"
          :placeholder="asking.def.kind === 'text' ? 'What happens next' : ''"
          @keydown.escape.stop="asking = null"
        />
      </form>
    </PopoverMenu>
  </div>
</template>
