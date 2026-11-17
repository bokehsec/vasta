<script setup lang="ts">
// Related task dates in the existing property picker. Each edit keeps the other date; moving
// that date as well is a separate, explicit action, offered when the edit leaves the plan after
// the deadline: a new deadline before the plan can pull the plan in ("Also plan for"), a plan
// after the deadline can push the deadline out. Repeating dates are never shifted here.
import { computed } from 'vue'
import { taskDatesOf, type Id, type ObjectRecord, type ObjectType, type PropertyValue } from '@vasta/core'
import { dayOfValue, moveDate } from '../lib/calendar.ts'
import { taskDate } from '../lib/calendar-tasks.ts'
import { formatDateShort } from '../lib/format.ts'

const props = defineProps<{ type: ObjectType | undefined; object: Pick<ObjectRecord, 'props'>; field: Id }>()
const emit = defineEmits<{ change: [values: Record<Id, PropertyValue>] }>()
const dates = computed(() => taskDatesOf(props.type))
const plan = computed(() => taskDate(props.object, dates.value.plan?.id))
const due = computed(() => taskDate(props.object, dates.value.deadline?.id))
const editsDue = computed(() => props.field === dates.value.deadline?.id && !!dates.value.plan)
const editsPlan = computed(() => props.field === dates.value.plan?.id)
const afterDue = computed(() => !!plan.value && !!due.value && dayOfValue(plan.value) > dayOfValue(due.value))
const canMove = computed(() => afterDue.value && !plan.value!.rrule && !due.value!.rrule)
function moveOther() {
  if (!canMove.value || !plan.value || !due.value || !dates.value.plan || !dates.value.deadline) return
  const value = editsDue.value ? moveDate(plan.value, { day: dayOfValue(due.value) }) : moveDate(due.value, { day: dayOfValue(plan.value) })
  emit('change', { [editsDue.value ? dates.value.plan.id : dates.value.deadline.id]: { kind: 'date', value } })
}
</script>

<template>
  <div v-if="(editsDue && plan) || (editsPlan && due)" class="space-y-2 border-t border-line pt-3 text-xs" data-task-date-options>
    <p class="text-ink-soft">{{ editsDue ? `Planned for ${formatDateShort(plan!)} · unchanged` : `Due by ${formatDateShort(due!)} · unchanged` }}</p>
    <p v-if="afterDue" class="text-amber-700 dark:text-amber-400">Planned after deadline</p>
    <button v-if="canMove" class="min-h-8 rounded-md px-2 py-1 text-left text-accent hover:bg-hover max-md:min-h-11" data-move-related-date @click="moveOther">
      {{ editsDue ? `Also plan for ${formatDateShort(due!)}` : `Also move deadline to ${formatDateShort(plan!)}` }}
    </button>
  </div>
</template>
