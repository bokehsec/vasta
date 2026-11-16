<script setup lang="ts">
// A space's read-only fitness connection. The key is sent once and never read back.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, type SparkyFitnessStatus } from '../../lib/api.ts'
import { formatRelative } from '../../lib/format.ts'
import { choiceDialog } from '../../lib/overlays.ts'
import { field, label, primary, secondary, errorText } from './styles.ts'

const props = defineProps<{ spaceId: string }>()
const status = ref<SparkyFitnessStatus | null>(null)
const baseUrl = ref('')
const apiKey = ref('')
const history = ref(30)
const busy = ref(false)
const error = ref('')
let timer: ReturnType<typeof setInterval> | undefined
async function load() {
  status.value = await api.sparkyFitness(props.spaceId)
}
async function initialize() {
  await load()
  baseUrl.value = status.value?.baseUrl ?? ''
  history.value = status.value?.history ?? 30
  apiKey.value = ''
}
async function run(task: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try { await task(); await load() } catch (failure) { error.value = (failure as Error).message } finally { busy.value = false }
}
const connect = () => run(async () => {
  await api.connectSparkyFitness(props.spaceId, { baseUrl: baseUrl.value, apiKey: apiKey.value || undefined, history: history.value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  apiKey.value = ''
})
const sync = () => run(() => api.syncSparkyFitness(props.spaceId))
/** Disconnecting can leave the filled days and the links in place, or take away everything the connection brought. */
async function disconnect() {
  const answer = await choiceDialog({
    title: 'Disconnect SparkyFitness?',
    message: 'Habits stop filling from it. What it already filled can stay, or go.',
    choices: [
      { value: 'keep', label: 'Disconnect, keep the filled days' },
      { value: 'remove', label: 'Disconnect and remove the filled days, the habits’ links and the properties it added', danger: true },
    ],
  })
  if (answer) await run(() => api.disconnectSparkyFitness(props.spaceId, answer === 'remove'))
}
watch(() => props.spaceId, () => { void run(initialize) })
onMounted(() => {
  void run(initialize)
  timer = setInterval(() => { if (status.value?.importing) void run(load) }, 1500)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="mt-5 space-y-3 border-t border-line pt-4" data-sparkyfitness-settings>
    <h3 class="text-sm font-medium">SparkyFitness</h3>
    <p class="text-sm text-ink-soft">Fill habits from your fitness tracker. Hand entries, including cleared days, take priority. Refreshes every 30 minutes.</p>
    <form class="space-y-3" @submit.prevent="connect">
      <label :class="label">Server address<input v-model="baseUrl" :class="field" type="url" placeholder="https://fitness.example.com" required aria-label="SparkyFitness server address" /></label>
      <label :class="label">Read-only API key<input v-model="apiKey" :class="field" type="password" autocomplete="new-password" :placeholder="status?.hasKey ? 'Saved · leave blank to keep' : ''" :required="!status?.hasKey || baseUrl.replace(/\/$/, '') !== status.baseUrl" aria-label="SparkyFitness API key" /></label>
      <label :class="label">Bring in past data<select v-model="history" :class="field" aria-label="SparkyFitness history">
        <option :value="0">None (from today)</option><option :value="7">1 week</option><option :value="30">1 month</option><option :value="90">3 months</option><option :value="365">1 year</option>
      </select></label>
      <button :class="primary" :disabled="busy || !!status?.importing">{{ status ? 'Save connection' : 'Connect' }}</button>
    </form>
    <p v-if="error || status?.error" :class="errorText" role="alert">{{ error || status?.error }}</p>
    <template v-if="status">
      <p class="text-sm text-ink-soft" role="status">{{ status.importing ? `Importing · ${status.importing.done} of ${status.importing.total} days` : status.syncedAt ? `Connected · last synced ${formatRelative(status.syncedAt)}` : 'Connection saved · waiting to sync' }}</p>
      <div class="flex flex-wrap gap-2">
        <button :class="secondary" :disabled="busy || !!status.importing" @click="sync">Sync now</button>
        <button :class="secondary" :disabled="busy" @click="disconnect">Disconnect</button>
      </div>
      <p class="text-xs text-ink-faint">Pick From SparkyFitness on a habit page to start filling it. A linked steps, water or sleep habit needs a daily goal.</p>
      <div v-if="status.workouts.length" class="text-sm text-ink-soft"><p class="font-medium">Workouts seen in the last 30 days</p><p>{{ status.workouts.join(', ') }}</p></div>
    </template>
  </section>
</template>
