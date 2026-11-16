<script setup lang="ts">
// Related task dates in the existing property picker. Each edit keeps the other date; moving
// that date as well is a separate, explicit action. Repeating dates are never shifted here.
import { computed } from 'vue'
import { plannedDateFieldOf, type Id, type ObjectRecord, type ObjectType, type PropertyValue } from '@vasta/core'
import { dayKey } from '../lib/actions.ts'
import { moveDate } from '../lib/calendar.ts'
import { taskDate } from '../lib/calendar-tasks.ts'
import { formatDateShort } from '../lib/format.ts'

const props = defineProps<{ type: ObjectType | undefined; object: Pick<ObjectRecord, 'props'>; field: Id }>()
const emit = defineEmits<{ change: [values: Record<Id, PropertyValue>] }>()
const planField = computed(() => plannedDateFieldOf(props.type))
const plan = computed(() => taskDate(props.object, planField.value?.id))
const due = computed(() => taskDate(props.object, 'due'))
const dayOf = (value: NonNullable<typeof due.value>) => value.resolution === 'day' ? value.start.slice(0, 10) : dayKey(new Date(value.start))
const editsDue = computed(() => props.field === 'due' && !!planField.value)
const editsPlan = computed(() => props.field === planField.value?.id)
const afterDue = computed(() => !!plan.value && !!due.value && dayOf(plan.value) > dayOf(due.value))
const canMove = computed(() => !!plan.value && !!due.value && !plan.value.rrule && !due.value.rrule && dayOf(plan.value) !== dayOf(due.value))
function moveOther() {
  if (!canMove.value || !plan.value || !due.value || !planField.value) return
  const field = editsDue.value ? planField.value.id : 'due'
  const value = editsDue.value ? moveDate(plan.value, { day: dayOf(due.value) }) : moveDate(due.value, { day: dayOf(plan.value) })
  emit('change', { [field]: { kind: 'date', value } })
}
</script>

<template>
  <div v-if="(editsDue && plan) || (editsPlan && due)" class="space-y-2 border-t border-line pt-3 text-xs" data-task-date-options>
    <p class="text-ink-soft">{{ editsDue ? `Planned for ${formatDateShort(plan!)} · unchanged` : `Due by ${formatDateShort(due!)} · unchanged` }}</p>
    <p v-if="afterDue" class="text-amber-700 dark:text-amber-400">Planned after deadline</p>
    <button v-if="canMove && (editsDue || afterDue)" class="min-h-8 rounded-md px-2 py-1 text-left text-accent hover:bg-hover max-md:min-h-11" data-move-related-date @click="moveOther">
      {{ editsDue ? `Also plan for ${formatDateShort(due!)}` : `Also move deadline to ${formatDateShort(plan!)}` }}
    </button>
  </div>
</template>
