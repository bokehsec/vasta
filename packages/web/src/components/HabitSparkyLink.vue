<script setup lang="ts">
// Preview a rule before linking a habit; checking a day by hand always wins.
import { ref, watch } from 'vue'
import { HABIT_SPARKY_PROPERTY_ID, HABIT_SPARKY_WORKOUTS_PROPERTY_ID, habitSparkyRule, habitUnit, sparkyRules, type ObjectRecord, type PropertyValue } from '@vasta/core'
import { api, type SparkyFitnessStatus, type SparkyPreviewDay } from '../lib/api.ts'
import { setProperties } from '../lib/actions.ts'
import { field, label, primary, secondary, errorText } from './settings/styles.ts'

const props = defineProps<{ habit: ObjectRecord }>()
const status = ref<SparkyFitnessStatus | null>(null)
const rule = ref(habitSparkyRule(props.habit) ?? 'steps')
const workouts = ref(props.habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID]?.kind === 'text' ? props.habit.props[HABIT_SPARKY_WORKOUTS_PROPERTY_ID].value : '')
const days = ref<SparkyPreviewDay[] | null>(null)
const busy = ref(false)
const error = ref('')
const saved = ref(false)
watch([rule, workouts], () => { days.value = null; saved.value = false })
async function open(event: Event) {
  if (!(event.currentTarget as HTMLDetailsElement).open) return
  try { status.value = await api.sparkyFitness(props.habit.spaceId) } catch { error.value = 'Could not read the connection' }
}
function addWorkout(name: string) {
  const names = workouts.value.split(',').map((n) => n.trim()).filter(Boolean)
  if (!names.includes(name)) workouts.value = [...names, name].join(', ')
}
async function preview() {
  busy.value = true; error.value = ''; days.value = null
  try { days.value = await api.previewSparkyFitness(props.habit.id, { rule: rule.value, workouts: workouts.value }) } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
async function save() {
  if (!days.value) return
  busy.value = true; error.value = ''
  try {
    await setProperties(props.habit.id, {
      [HABIT_SPARKY_PROPERTY_ID]: { kind: 'select', value: [rule.value] },
      [HABIT_SPARKY_WORKOUTS_PROPERTY_ID]: { kind: 'text', value: workouts.value },
    })
    saved.value = true
  } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
const valueText = (value: PropertyValue | null) => value?.kind === 'number' ? `${Math.round(value.value * 100) / 100}${rule.value === 'sleep' ? ' hours' : habitUnit(props.habit) ? ` ${habitUnit(props.habit)}` : ''}` : value?.kind === 'checkbox' ? value.value ? 'Done' : 'Not done' : 'Unavailable'
</script>

<template>
  <details class="mt-4 rounded-xl border border-line p-3 text-sm" data-habit-sparky-link @toggle="open">
    <summary class="cursor-pointer font-medium">From SparkyFitness</summary>
    <div class="mt-3 space-y-3">
      <template v-if="status">
        <label :class="label">Use this data<select v-model="rule" :class="field" aria-label="SparkyFitness rule"><option v-for="[id, name] in sparkyRules" :key="id" :value="id">{{ name }}</option></select></label>
        <template v-if="rule === 'workout'">
          <label :class="label">Workout or routine names<input v-model="workouts" :class="field" aria-label="SparkyFitness workout names" placeholder="Names separated by commas" /></label>
          <div v-if="status.workouts.length" class="flex flex-wrap gap-2"><button v-for="name in status.workouts" :key="name" :class="secondary" @click="addWorkout(name)">{{ name }}</button></div>
        </template>
        <p class="text-xs text-ink-faint">Preview the last seven days before saving. Hand entries, including cleared days, take priority.</p>
        <button :class="secondary" :disabled="busy || (rule === 'workout' && !workouts.trim())" @click="preview">Preview last 7 days</button>
        <div v-if="days" class="space-y-2" data-sparky-preview>
          <div v-for="day in days" :key="day.day" class="flex flex-wrap justify-between gap-x-3 border-b border-line pb-1 text-xs">
            <span>{{ day.day }}</span><span>{{ valueText(day.value) }}<span v-if="day.manual" class="text-ink-faint"> · hand entry wins: {{ valueText(day.manual) }}</span></span>
          </div>
          <button :class="primary" :disabled="busy || saved" @click="save">{{ saved ? 'Link saved' : 'Save link' }}</button>
        </div>
      </template>
      <p v-else class="text-ink-soft">Connect SparkyFitness in <a href="/settings#space" class="underline">space settings</a> first.</p>
      <p v-if="error" :class="errorText" role="alert">{{ error }}</p>
    </div>
  </details>
</template>
