<script setup lang="ts">
// A type's quick actions (Type settings › Quick actions, any type; @vasta/core task-actions.ts):
// the buttons on its page and, where a view shows them, its row, each with the changes it makes.
// A task starts from the defaults (Done, Defer, Drop, Next step); another type starts empty, and
// the first edit makes the list the type's own ("Use the defaults" on a task goes back). Also the
// text field shown under a task's title in lists (tasks only).
import { computed, ref } from 'vue'
import type { Id, ObjectType, PropertyDef, PropertyValue, QuickActionChange, QuickActionDef, QuickActions, QuickActionValue } from '@vasta/core'
import { CHANGEABLE_KINDS, defaultQuickActions, newId, quickActionsOf } from '@vasta/core'
import { clone } from '../lib/clone.ts'
import AppIcon from './AppIcon.vue'
import IconPicker from './IconPicker.vue'
import PopoverMenu from './PopoverMenu.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'

const props = defineProps<{ type: ObjectType }>()
const emit = defineEmits<{ update: [value: QuickActions | undefined] }>()

const own = computed(() => !!props.type.quickActions?.actions)
const actions = computed(() => props.type.quickActions?.actions ?? defaultQuickActions(props.type))
const fields = computed(() => props.type.properties.filter((p) => CHANGEABLE_KINDS.includes(p.kind)))
const textFields = computed(() => props.type.properties.filter((p) => p.kind === 'text'))
const defOf = (field: Id) => props.type.properties.find((p) => p.id === field)
/** Actions that would do nothing as they are (every change left out): said under them. */
const working = computed(() => new Set(quickActionsOf(props.type).map((a) => a.id)))

function emitSettings(patch: Partial<QuickActions>) {
  const next: QuickActions = { ...props.type.quickActions, ...patch }
  for (const key of Object.keys(next) as (keyof QuickActions)[]) if (next[key] === undefined || next[key] === '') delete next[key]
  emit('update', Object.keys(next).length ? next : undefined)
}
function edit(change: (list: QuickActionDef[]) => void) {
  const list = clone(actions.value)
  change(list)
  emitSettings({ actions: list })
}
const useDefaults = () => emitSettings({ actions: undefined })

// What a change can do, by the kind of property it changes.
type Mode = 'ask' | 'today' | 'tomorrow' | 'days' | 'next-week' | 'me' | 'option' | 'fixed' | 'on' | 'off' | 'clear'
const MODES: Partial<Record<PropertyDef['kind'], [Mode, string][]>> = {
  select: [['option', 'Set to'], ['clear', 'Clear']],
  date: [['ask', 'Ask (calendar)'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['next-week', 'Next week'], ['days', 'In days'], ['clear', 'Clear']],
  text: [['ask', 'Ask'], ['fixed', 'Set to'], ['clear', 'Clear']],
  url: [['ask', 'Ask'], ['fixed', 'Set to'], ['clear', 'Clear']],
  number: [['ask', 'Ask'], ['fixed', 'Set to'], ['clear', 'Clear']],
  checkbox: [['on', 'Check'], ['off', 'Uncheck']],
  person: [['me', 'Me'], ['fixed', 'Set to'], ['clear', 'Clear']],
  relation: [['fixed', 'Set to'], ['clear', 'Clear']],
}
const modesOf = (def: PropertyDef | undefined) => (def ? (MODES[def.kind] ?? []) : [])

function modeOf(change: QuickActionChange): Mode {
  const value = change.value
  if (value.kind === 'day') return value.days === 0 ? 'today' : value.days === 1 ? 'tomorrow' : 'days'
  if (value.kind !== 'value') return value.kind
  if (value.value.kind === 'checkbox') return value.value.value ? 'on' : 'off'
  return value.value.kind === 'select' ? 'option' : 'fixed'
}

function valueFor(def: PropertyDef, mode: Mode): QuickActionValue {
  switch (mode) {
    case 'ask':
    case 'next-week':
    case 'me':
    case 'clear':
      return { kind: mode }
    case 'today':
      return { kind: 'day', days: 0 }
    case 'tomorrow':
      return { kind: 'day', days: 1 }
    case 'days':
      return { kind: 'day', days: 7 }
    case 'on':
    case 'off':
      return { kind: 'value', value: { kind: 'checkbox', value: mode === 'on' } }
    case 'option':
      return { kind: 'value', value: { kind: 'select', value: def.kind === 'select' && def.options[0] ? [def.options[0].id] : [] } }
    case 'fixed': {
      const empty: PropertyValue =
        def.kind === 'number' ? { kind: 'number', value: 0 } : def.kind === 'url' ? { kind: 'url', value: '' } : def.kind === 'person' ? { kind: 'person', value: [] } : def.kind === 'relation' ? { kind: 'relation', value: [] } : { kind: 'text', value: '' }
      return { kind: 'value', value: empty }
    }
  }
}

/** A change of the first field the action does not change yet. */
function newChange(used: QuickActionChange[] = []): QuickActionChange | undefined {
  const def = fields.value.find((p) => !used.some((c) => c.field === p.id)) ?? fields.value[0]
  const mode = modesOf(def)[0]?.[0]
  return def && mode ? { field: def.id, value: valueFor(def, mode) } : undefined
}

const expanded = ref<Id | null>(null)
function addAction() {
  const change = newChange()
  const action: QuickActionDef = { id: newId(), name: 'New action', icon: { kind: 'icon', value: 'ph:lightning' }, changes: change ? [change] : [] }
  edit((list) => list.push(action))
  expanded.value = action.id
}
const move = (index: number, delta: number) =>
  edit((list) => {
    const target = index + delta
    if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target]!, list[index]!]
  })
const editAction = (index: number, change: (action: QuickActionDef) => void) => edit((list) => change(list[index]!))

function setField(index: number, at: number, field: Id) {
  const def = defOf(field)
  const mode = modesOf(def)[0]?.[0]
  if (def && mode) editAction(index, (a) => (a.changes[at] = { field, value: valueFor(def, mode) }))
}
function setMode(index: number, at: number, mode: Mode) {
  const def = defOf(actions.value[index]!.changes[at]!.field)
  if (def) editAction(index, (a) => (a.changes[at]!.value = valueFor(def, mode)))
}
const setValue = (index: number, at: number, value: QuickActionValue) => editAction(index, (a) => (a.changes[at]!.value = value))
function setFixed(index: number, at: number, def: PropertyDef, raw: string) {
  const value: PropertyValue = def.kind === 'number' ? { kind: 'number', value: Number(raw.replace(',', '.')) || 0 } : def.kind === 'url' ? { kind: 'url', value: raw } : { kind: 'text', value: raw }
  setValue(index, at, { kind: 'value', value })
}
const fixedText = (change: QuickActionChange) => {
  const value = change.value.kind === 'value' ? change.value.value : undefined
  return value?.kind === 'text' || value?.kind === 'url' ? value.value : value?.kind === 'number' ? String(value.value) : ''
}
const selectedOption = (change: QuickActionChange) => (change.value.kind === 'value' && change.value.value.kind === 'select' ? (change.value.value.value[0] ?? '') : '')

/** "Status → Waiting", "Check back → in 7 days": a change in a few words. */
function describe(change: QuickActionChange): string {
  const def = defOf(change.field)
  if (!def) return ''
  const value = change.value
  const what = (() => {
    switch (value.kind) {
      case 'ask':
        return 'ask'
      case 'clear':
        return 'clear'
      case 'me':
        return 'me'
      case 'next-week':
        return 'next week'
      case 'day':
        return value.days === 0 ? 'today' : value.days === 1 ? 'tomorrow' : `in ${value.days} days`
      case 'value': {
        const v = value.value
        if (v.kind === 'select' && def.kind === 'select') return v.value.map((id) => def.options.find((o) => o.id === id)?.label ?? '?').join(', ')
        if (v.kind === 'checkbox') return v.value ? 'checked' : 'unchecked'
        if (v.kind === 'text' || v.kind === 'url') return `“${v.value}”`
        if (v.kind === 'number') return String(v.value)
        if (v.kind === 'person' || v.kind === 'relation') return `${v.value.length} chosen`
        return ''
      }
    }
  })()
  return `${def.name} → ${what}`
}

const iconAnchor = ref<HTMLElement | null>(null)
const iconFor = ref<number | null>(null)
const iconOpen = computed({ get: () => iconFor.value !== null, set: (open) => !open && (iconFor.value = null) })
function openIcon(event: MouseEvent, index: number) {
  iconAnchor.value = event.currentTarget as HTMLElement
  iconFor.value = index
}

const control = 'rounded-md bg-hover px-1.5 py-1 text-sm outline-none'
</script>

<template>
  <section class="mt-4" data-quick-action-settings>
    <div class="flex items-baseline gap-2">
      <div class="text-sm">Quick actions</div>
      <button v-if="own" class="ml-auto text-xs text-ink-faint hover:text-ink" data-quick-defaults @click="useDefaults">Use the defaults</button>
    </div>
    <p class="mt-0.5 text-xs text-ink-faint">Buttons on a {{ (type.name || 'task').toLowerCase() }}'s page and, where a view turns them on, its row. Each makes its changes in one click; one marked “Ask” asks for that value first.</p>
    <div class="mt-2 divide-y divide-line rounded-xl border border-line">
      <div v-for="(action, index) in actions" :key="action.id" data-quick-action>
        <div class="flex items-center gap-2 px-2 py-1.5">
          <div class="flex flex-col">
            <button class="text-ink-faint hover:text-ink disabled:opacity-30" :disabled="index === 0" title="Move up" @click="move(index, -1)"><AppIcon fallback="ph:caret-up" :size="12" /></button>
            <button class="text-ink-faint hover:text-ink disabled:opacity-30" :disabled="index === actions.length - 1" title="Move down" @click="move(index, 1)"><AppIcon fallback="ph:caret-down" :size="12" /></button>
          </div>
          <button class="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-hover" title="Icon" @click="openIcon($event, index)">
            <AppIcon :icon="action.icon" fallback="ph:lightning" />
          </button>
          <input
            :value="action.name"
            class="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm outline-none hover:bg-hover focus:bg-hover"
            aria-label="Name"
            data-quick-name
            @change="editAction(index, (a) => (a.name = ($event.target as HTMLInputElement).value.trim() || a.name))"
          />
          <button class="flex min-w-0 max-w-[45%] items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs text-ink-faint hover:bg-hover hover:text-ink" :aria-expanded="expanded === action.id" @click="expanded = expanded === action.id ? null : action.id">
            <span class="truncate">{{ action.changes.map(describe).filter(Boolean).join(' · ') || 'No changes' }}</span>
            <AppIcon :fallback="expanded === action.id ? 'ph:caret-up' : 'ph:caret-down'" :size="12" class="shrink-0" />
          </button>
          <button class="rounded-md p-1 text-ink-faint hover:bg-hover hover:text-red-600" title="Delete action" @click="edit((list) => list.splice(index, 1))"><AppIcon fallback="ph:trash" :size="14" /></button>
        </div>
        <p v-if="!working.has(action.id)" class="px-10 pb-1.5 text-xs text-amber-700 dark:text-amber-400">Does nothing yet: give it a change.</p>
        <div v-if="expanded === action.id" class="space-y-1.5 px-3 pb-3 pl-10" data-quick-changes>
          <div v-for="(change, at) in action.changes" :key="at" class="flex flex-wrap items-center gap-1.5 text-sm" data-quick-change>
            <span class="text-ink-faint">Set</span>
            <select :value="change.field" :class="control" aria-label="Field" @change="setField(index, at, ($event.target as HTMLSelectElement).value)">
              <option v-for="p in fields" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <select :value="modeOf(change)" :class="control" aria-label="To" @change="setMode(index, at, ($event.target as HTMLSelectElement).value as Mode)">
              <option v-for="[mode, label] in modesOf(defOf(change.field))" :key="mode" :value="mode">{{ label }}</option>
            </select>
            <template v-if="defOf(change.field)">
              <select v-if="modeOf(change) === 'option' && defOf(change.field)!.kind === 'select'" :value="selectedOption(change)" :class="control" aria-label="Option" @change="setValue(index, at, { kind: 'value', value: { kind: 'select', value: [($event.target as HTMLSelectElement).value] } })">
                <option v-for="o in (defOf(change.field) as Extract<PropertyDef, { kind: 'select' }>).options" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
              <input
                v-else-if="modeOf(change) === 'days' && change.value.kind === 'day'"
                type="number"
                min="0"
                :value="change.value.days"
                :class="[control, 'w-16']"
                aria-label="Days"
                @change="setValue(index, at, { kind: 'day', days: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })"
              />
              <input
                v-else-if="modeOf(change) === 'fixed' && ['text', 'url', 'number'].includes(defOf(change.field)!.kind)"
                :value="fixedText(change)"
                :type="defOf(change.field)!.kind === 'number' ? 'number' : 'text'"
                :class="[control, 'min-w-0 flex-1']"
                aria-label="Value"
                @change="setFixed(index, at, defOf(change.field)!, ($event.target as HTMLInputElement).value)"
              />
              <PropertyValueEditor
                v-else-if="modeOf(change) === 'fixed' && change.value.kind === 'value'"
                :def="defOf(change.field)!"
                :value="change.value.value"
                class="min-w-0 flex-1"
                @update="setValue(index, at, $event ? { kind: 'value', value: $event } : valueFor(defOf(change.field)!, 'fixed'))"
              />
            </template>
            <button class="ml-auto rounded-md p-1 text-ink-faint hover:bg-hover hover:text-ink" title="Remove change" @click="editAction(index, (a) => a.changes.splice(at, 1))"><AppIcon fallback="ph:x" :size="13" /></button>
          </div>
          <button v-if="fields.length" class="flex items-center gap-1 rounded px-1 py-1 text-xs text-ink-faint hover:text-ink" data-quick-add-change @click="editAction(index, (a) => { const c = newChange(a.changes); if (c) a.changes.push(c) })">
            <AppIcon fallback="ph:plus" :size="12" /> Add change
          </button>
        </div>
      </div>
      <p v-if="!actions.length" class="px-3 py-2 text-xs text-ink-faint">No quick actions.</p>
    </div>
    <button class="mt-1.5 flex items-center gap-1 rounded px-1 py-1 text-xs text-ink-faint hover:text-ink" data-quick-add @click="addAction"><AppIcon fallback="ph:plus" :size="12" /> Add action</button>
    <label v-if="type.system === 'task'" class="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span class="text-ink-soft">Next step under the title in lists</span>
      <select :value="type.quickActions?.nextStepField ?? ''" :class="control" data-next-step-field @change="emitSettings({ nextStepField: ($event.target as HTMLSelectElement).value })">
        <option value="">None</option>
        <option v-for="p in textFields" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>
    <PopoverMenu v-model:open="iconOpen" :anchor="iconAnchor" width="auto">
      <div class="p-2">
        <IconPicker
          :icon="iconFor !== null ? actions[iconFor]?.icon : undefined"
          @pick="(icon) => { const at = iconFor; iconFor = null; if (at !== null) editAction(at, (a) => (icon ? (a.icon = icon) : delete a.icon)) }"
        />
      </div>
    </PopoverMenu>
  </section>
</template>
