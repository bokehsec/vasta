<script setup lang="ts">
// The agenda layout's settings: the date field to place objects by, how many days, and which
// subscribed calendars to include. Emits the whole new settings; the view or query saves them.
import { computed, onMounted, ref } from 'vue'
import type { AgendaSettings, CalendarSource, Id } from '@vasta/core'
import { agendaLength, MAX_AGENDA_DAYS, tidyAgenda } from '../lib/agenda.ts'
import { api } from '../lib/api.ts'
import { typesOf } from '../lib/query.ts'
import { workspace } from '../lib/state.ts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ agenda: AgendaSettings | undefined; typeIds: Id[] }>()
const emit = defineEmits<{ update: [agenda: AgendaSettings | undefined] }>()

const change = (patch: Partial<AgendaSettings>) => emit('update', tidyAgenda({ ...props.agenda, ...patch }))

// Date fields: every date property of the types (a name in several types shows once).
const dateFields = computed(() => {
  const seen = new Set<string>()
  const fields: { id: string; label: string }[] = []
  for (const type of typesOf(props.typeIds)) {
    for (const def of type.properties) {
      if (def.kind !== 'date' || seen.has(def.id)) continue
      seen.add(def.id)
      fields.push({ id: def.id, label: props.typeIds.length === 1 ? def.name : `${def.name} · ${type.name}` })
    }
  }
  return fields
})

const sources = ref<CalendarSource[]>([])
onMounted(async () => {
  if (workspace.space) sources.value = await api.calendarSources(workspace.space.id)
})
const mode = computed(() => (props.agenda?.calendars === true ? 'all' : Array.isArray(props.agenda?.calendars) ? 'some' : 'none'))
const chosen = computed(() => (Array.isArray(props.agenda?.calendars) ? props.agenda.calendars : []))
function setMode(value: string) {
  // Choosing starts from all of them, to untick what is not wanted.
  change({ calendars: value === 'all' ? true : value === 'some' ? sources.value.map((s) => s.id) : false })
}
function toggleSource(id: Id) {
  const next = chosen.value.includes(id) ? chosen.value.filter((c) => c !== id) : [...chosen.value, id]
  change({ calendars: next })
}

const control = 'rounded-md bg-hover px-1.5 py-1 text-sm outline-none'
</script>

<template>
  <div class="flex flex-col gap-2.5 p-2 text-sm">
    <label class="flex items-center justify-between gap-3 text-ink-soft">
      Date field
      <select :value="agenda?.field ?? ''" :class="control" aria-label="Date field" @change="change({ field: ($event.target as HTMLSelectElement).value })">
        <option value="">Any date</option>
        <option value="date">Date</option>
        <option v-for="f in dateFields" :key="f.id" :value="f.id">{{ f.label }}</option>
      </select>
    </label>
    <label class="flex items-center justify-between gap-3 text-ink-soft">
      Days from today
      <select :value="agendaLength(agenda)" :class="control" aria-label="Days" @change="change({ days: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="n in MAX_AGENDA_DAYS" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>
    <label class="flex items-center justify-between gap-3 text-ink-soft">
      Subscribed calendars
      <select :value="mode" :class="control" aria-label="Subscribed calendars" @change="setMode(($event.target as HTMLSelectElement).value)">
        <option value="none">None</option>
        <option value="all">All</option>
        <option value="some">Choose…</option>
      </select>
    </label>
    <template v-if="mode === 'some'">
      <p v-if="!sources.length" class="text-xs text-ink-faint">No calendars subscribed yet; add one on the Calendar page.</p>
      <button v-for="source in sources" :key="source.id" class="flex items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-hover" @click="toggleSource(source.id)">
        <AppIcon :fallback="chosen.includes(source.id) ? 'ph:check-square-fill' : 'ph:square'" :class="chosen.includes(source.id) ? 'text-accent' : 'text-ink-faint'" />
        <span class="truncate">{{ source.name }}</span>
      </button>
    </template>
  </div>
</template>
