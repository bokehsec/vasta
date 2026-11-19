<script setup lang="ts">
// A one-line entrance to the same capture pipeline as QuickCapture (including food and /Type).
import { ref } from 'vue'
import { captureAsks, captureSpace, captureText } from '../lib/actions.ts'
import { greyButton } from '../lib/buttons.ts'
import { asksDialog } from '../lib/overlays.ts'
import { notice } from '../lib/state.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'

const text = ref('')
const saving = ref(false)
const error = ref('')
async function save() {
  if (!text.value.trim() || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const pending = await captureAsks(text.value)
    const answers = pending.length ? await asksDialog({ title: 'Quick capture', fields: pending, confirmLabel: 'Save capture' }) : undefined
    if (answers === null) return
    const saved = await captureText(text.value, 'app', answers)
    notice.value = { message: saved.food?.summary ?? `${saved.answer.summary || 'Capture saved'} in ${saved.space.name}.` }
    text.value = ''
  } catch (failure) { error.value = (failure as Error).message }
  finally { saving.value = false }
}
</script>

<template>
  <form class="vasta-ui" @submit.prevent="save">
    <div class="flex items-center gap-2" :class="bodyText">
      <input v-model="text" aria-label="Quick capture" :placeholder="`Capture in ${captureSpace()?.name ?? 'today’s note'}…`" class="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 outline-none focus:border-line-strong max-md:min-h-11" :disabled="saving" />
      <button :class="greyButton" :disabled="!text.trim() || saving" type="submit" aria-label="Save capture"><AppIcon fallback="ph:arrow-up" /> {{ saving ? 'Saving…' : 'Save' }}</button>
    </div>
    <p v-if="error" class="mt-1 text-red-600" :class="metaText" role="alert">{{ error }}</p>
  </form>
</template>
