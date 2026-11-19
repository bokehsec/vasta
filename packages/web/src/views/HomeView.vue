<script setup lang="ts">
// Opens what the space opens on (Settings › Space): Today or a page; when unset, the person's Home.
// A chosen page that is gone keeps the pinned-item/welcome fallback.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { openToday, sidebarItemPath, todayRoute } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton } from '../lib/buttons.ts'
import { resolveHome } from '../lib/home.ts'
import { startPage } from '../lib/start-page.ts'
import { lastError, typesById, ui, workspace } from '../lib/state.ts'
import { bodyText, pageTitle } from '../lib/type-scale.ts'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
/** Looking up the page the space opens on: the welcome waits, so it does not flash before it. */
const looking = ref(false)

onMounted(async () => {
  const space = workspace.space
  if (!space) return
  const on = space.opensOn
  if (!on) {
    looking.value = true
    try {
      const id = await resolveHome()
      if (id && workspace.space?.id === space.id && router.currentRoute.value.path === '/') await router.replace(`/o/${id}`)
    } catch (error) {
      lastError.value = (error as Error).message
    } finally {
      looking.value = false
    }
    return
  }
  looking.value = on?.kind === 'object'
  const opened = on?.kind === 'object' ? await api.summaries([on.id]).then((found) => found[0], () => undefined) : undefined
  looking.value = false
  if (router.currentRoute.value.path === '/') open(startPage(space, opened, (id) => typesById.value.has(id)))
})

function open(page: ReturnType<typeof startPage>) {
  if (page.kind === 'today') void router.replace(todayRoute())
  // A sidebar item may also be a pinned view; sidebarItemPath knows each kind.
  else if (page.kind !== 'welcome') void router.replace(sidebarItemPath(page.id))
}
</script>

<template>
  <div v-if="!looking" class="mx-auto max-w-xl px-8 py-24 text-center">
    <h1 :class="pageTitle">{{ workspace.space?.name }}</h1>
    <div class="mt-6 flex justify-center gap-2" :class="bodyText">
      <button :class="greyButton" @click="openToday">
        <AppIcon fallback="ph:calendar-check" /> Today
      </button>
      <button :class="greyButton" @click="ui.paletteOpen = true">
        <AppIcon fallback="ph:magnifying-glass" /> Search
      </button>
    </div>
  </div>
</template>
