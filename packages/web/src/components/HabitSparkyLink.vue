<script setup lang="ts">
// A habit's link to SparkyFitness, on its page (shown only when the space has a connection, or the
// habit is still linked): when it last synced and the last error, a preview of the last seven days
// before linking, and Unlink. Steps, water and sleep need a daily goal, or any amount would count
// as done. A hand entry always wins over what SparkyFitness gave (lib/habits.ts).
import { computed, onMounted, ref, watch } from 'vue'
import { HABIT_SPARKY_PROPERTY_ID, HABIT_SPARKY_WORKOUTS_PROPERTY_ID, HABIT_TARGET_PROPERTY_ID, HABIT_UNIT_PROPERTY_ID, habitSparkyKey, habitSparkyRule, habitTarget, habitUnit, sparkyRules, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { api, type SparkyFitnessStatus, type SparkyPreviewDay } from '../lib/api.ts'
import { setProperties } from '../lib/actions.ts'
import { formatRelative } from '../lib/format.ts'
import { choiceDialog } from '../lib/overlays.ts'
import { field, label, primary, secondary, errorText } from './settings/styles.ts'

const AMOUNT_RULES = ['steps', 'water', 'sleep']
const UNIT_HINT: Record<string, string> = { steps: 'steps', water: 'ml, L, oz, glasses or cups', sleep: 'hours or minutes' }

const props = defineProps<{ habit: ObjectRecord }>()
const status = ref<SparkyFitnessStatus | null>(null)
const loaded = ref(false)
const linked = computed(() => habitSparkyRule(props.habit))
const rule = ref(linked.value ?? 'steps')
const workouts = ref(props.habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID]?.kind === 'text' ? props.habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID].value : '')
const goal = ref(String(habitTarget(props.habit) ?? ''))
const unit = ref(habitUnit(props.habit))
const days = ref<SparkyPreviewDay[] | null>(null)
const busy = ref(false)
const error = ref('')
const saved = ref(false)
const needsGoal = computed(() => AMOUNT_RULES.includes(rule.value))
const goalNumber = computed(() => Number(goal.value.replace(',', '.')))
const goalOk = computed(() => !needsGoal.value || goalNumber.value > 0)
const importedDays = computed(() => Object.keys(props.habit.props).filter((key) => key.startsWith(habitSparkyKey(''))))
watch([rule, workouts, goal, unit], () => { days.value = null; saved.value = false })
onMounted(async () => {
  try { status.value = await api.sparkyFitness(props.habit.spaceId) } catch { error.value = 'Could not read the connection' }
  loaded.value = true
})
function addWorkout(name: string) {
  const names = workouts.value.split(',').map((n) => n.trim()).filter(Boolean)
  if (!names.includes(name)) workouts.value = [...names, name].join(', ')
}
async function preview() {
  busy.value = true; error.value = ''; days.value = null
  try {
    days.value = await api.previewSparkyFitness(props.habit.id, { rule: rule.value, workouts: workouts.value, ...(needsGoal.value ? { target: goalNumber.value, unit: unit.value } : {}) })
  } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
async function save() {
  if (!days.value) return
  busy.value = true; error.value = ''
  try {
    await setProperties(props.habit.id, {
      [HABIT_SPARKY_PROPERTY_ID]: { kind: 'select', value: [rule.value] },
      [HABIT_SPARKY_WORKOUTS_PROPERTY_ID]: { kind: 'text', value: workouts.value },
      ...(needsGoal.value ? { [HABIT_TARGET_PROPERTY_ID]: { kind: 'number', value: goalNumber.value }, [HABIT_UNIT_PROPERTY_ID]: { kind: 'text', value: unit.value.trim() } } : {}),
    })
    saved.value = true
  } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
/** Unlink: the habit goes back to hand entries; the days SparkyFitness filled can stay or go. */
async function unlink() {
  const answer = await choiceDialog({
    title: 'Unlink from SparkyFitness?',
    message: importedDays.value.length ? `${importedDays.value.length} days were filled from it.` : 'Nothing was filled from it yet.',
    choices: [
      { value: 'keep', label: 'Unlink, keep the filled days' },
      ...(importedDays.value.length ? [{ value: 'remove', label: 'Unlink and remove the filled days', danger: true }] : []),
    ],
  })
  if (!answer) return
  busy.value = true; error.value = ''
  try {
    const removed: Record<string, PropertyValue | undefined> = {}
    if (answer === 'remove') for (const key of importedDays.value) removed[key] = undefined
    await setProperties(props.habit.id, { [HABIT_SPARKY_PROPERTY_ID]: undefined, [HABIT_SPARKY_WORKOUTS_PROPERTY_ID]: undefined, ...removed })
    saved.value = false
    days.value = null
  } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
async function syncNow() {
  busy.value = true; error.value = ''
  try { status.value = await api.syncSparkyFitness(props.habit.spaceId) } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
const valueText = (value: PropertyValue | null) => {
  if (value?.kind === 'number') return `${Math.round(value.value * 100) / 100}${unit.value.trim() ? ` ${unit.value.trim()}` : rule.value === 'sleep' ? ' hours' : ''}`
  return value?.kind === 'checkbox' ? (value.value ? 'Done' : 'Not done') : 'Unavailable'
}
const manualText = (value: PropertyValue | null) => (value?.kind === 'number' ? `${Math.round(value.value * 100) / 100}` : value?.kind === 'checkbox' ? (value.value ? 'Done' : 'Not done') : '')
</script>

<template>
  <details v-if="loaded && (status || linked)" class="mt-4 rounded-xl border border-line p-3 text-sm" data-habit-sparky-link>
    <summary class="cursor-pointer font-medium">From SparkyFitness<span v-if="linked" class="font-normal text-ink-faint"> · {{ sparkyRules.find(([id]) => id === linked)?.[1] ?? linked }}</span></summary>
    <div class="mt-3 space-y-3">
      <template v-if="status">
        <p class="text-xs text-ink-faint" data-sparky-sync-status>{{ status.importing ? `Importing · ${status.importing.done} of ${status.importing.total} days` : status.syncedAt ? `Last synced ${formatRelative(status.syncedAt)}` : 'Waiting for the first sync' }}</p>
        <p v-if="status.error" :class="errorText" role="alert" data-sparky-sync-error>Last error: {{ status.error }}</p>
        <label :class="label">Use this data<select v-model="rule" :class="field" aria-label="SparkyFitness rule"><option v-for="[id, name] in sparkyRules" :key="id" :value="id">{{ name }}</option></select></label>
        <template v-if="rule === 'workout'">
          <label :class="label">Workout or routine names<input v-model="workouts" :class="field" aria-label="SparkyFitness workout names" placeholder="Names separated by commas" /></label>
          <div v-if="status.workouts.length" class="flex flex-wrap gap-2"><button v-for="name in status.workouts" :key="name" :class="secondary" @click="addWorkout(name)">{{ name }}</button></div>
        </template>
        <div v-if="needsGoal" class="grid grid-cols-2 gap-3">
          <label :class="label">Daily goal<input v-model="goal" :class="field" inputmode="decimal" aria-label="Daily goal" placeholder="8000" /></label>
          <label :class="label">Unit<input v-model="unit" :class="field" aria-label="Unit" :placeholder="UNIT_HINT[rule]" /></label>
          <p class="col-span-2 text-xs text-ink-faint">A day counts as done once it reaches the goal. Unit: {{ UNIT_HINT[rule] }}.</p>
        </div>
        <p class="text-xs text-ink-faint">Preview the last seven days before saving. Hand entries, including cleared days, take priority.</p>
        <div class="flex flex-wrap gap-2">
          <button :class="secondary" :disabled="busy || !goalOk || (rule === 'workout' && !workouts.trim())" @click="preview">Preview last 7 days</button>
          <button :class="secondary" :disabled="busy || !!status.importing" @click="syncNow">Sync now</button>
        </div>
        <div v-if="days" class="space-y-2" data-sparky-preview>
          <div v-for="day in days" :key="day.day" class="flex flex-wrap justify-between gap-x-3 border-b border-line pb-1 text-xs">
            <span>{{ day.day }}</span><span>{{ valueText(day.value) }}<span v-if="day.manual" class="text-ink-faint"> · hand entry wins: {{ manualText(day.manual) }}</span></span>
          </div>
          <button :class="primary" :disabled="busy || saved" @click="save">{{ saved ? 'Link saved' : 'Save link' }}</button>
        </div>
      </template>
      <p v-else class="text-ink-soft">SparkyFitness is not connected in this space anymore. <a href="/settings#space" class="underline">Connect it in space settings</a>, or unlink this habit.</p>
      <button v-if="linked" :class="secondary" :disabled="busy" data-sparky-unlink @click="unlink">Unlink</button>
      <p v-if="error" :class="errorText" role="alert">{{ error }}</p>
    </div>
  </details>
</template>
