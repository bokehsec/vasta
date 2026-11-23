<script setup lang="ts">
// Today keeps its route; every other start choice resolves the viewer’s own Home.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { openToday, todayRoute } from '../lib/actions.ts'
import { greyButton } from '../lib/buttons.ts'
import { resolveHome } from '../lib/home.ts'
import { t } from '../lib/i18n.ts'
import { lastError, ui, workspace } from '../lib/state.ts'
import { bodyText, pageTitle } from '../lib/type-scale.ts'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
/** Looking up the page the space opens on: the welcome waits, so it does not flash before it. */
const looking = ref(false)

onMounted(async () => {
  const space = workspace.space
  if (!space) return
  const on = space.opensOn
  if (on?.kind === 'today') {
    void router.replace(todayRoute())
    return
  }
  looking.value = true
  try {
    const id = await resolveHome()
    if (id && workspace.space?.id === space.id && router.currentRoute.value.path === '/') await router.replace(`/o/${id}`)
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    looking.value = false
  }
})
</script>

<template>
  <div v-if="!looking" class="mx-auto max-w-xl px-8 py-24 text-center">
    <h1 :class="pageTitle">{{ workspace.space?.name }}</h1>
    <div class="mt-6 flex justify-center gap-2" :class="bodyText">
      <button :class="greyButton" @click="openToday">
        <AppIcon fallback="ph:calendar-check" /> {{ t('common.today') }}
      </button>
      <button :class="greyButton" @click="ui.paletteOpen = true">
        <AppIcon fallback="ph:magnifying-glass" /> {{ t('common.search') }}
      </button>
    </div>
  </div>
</template>
