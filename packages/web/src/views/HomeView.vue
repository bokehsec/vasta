<script setup lang="ts">
// Opens what the space opens on (Settings › Space): Today or a page; else the first pinned item,
// like a start page. Falls back to a short welcome.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { openToday, todayRoute } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { startPage } from '../lib/start-page.ts'
import { typesById, ui, workspace } from '../lib/state.ts'
import AppIcon from '../components/AppIcon.vue'
import { objectPath } from '../lib/open.ts'

const router = useRouter()
/** Looking up the page the space opens on: the welcome waits, so it does not flash before it. */
const looking = ref(false)

onMounted(async () => {
  const space = workspace.space
  if (!space) return
  const on = space.opensOn
  looking.value = on?.kind === 'object'
  const opened = on?.kind === 'object' ? await api.summaries([on.id]).then((found) => found[0], () => undefined) : undefined
  looking.value = false
  if (router.currentRoute.value.path === '/') open(startPage(space, opened, (id) => typesById.value.has(id)))
})

function open(page: ReturnType<typeof startPage>) {
  if (page.kind === 'today') void router.replace(todayRoute())
  else if (page.kind === 'type') void router.replace(`/t/${page.id}`)
  else if (page.kind === 'object') void router.replace(objectPath(page.id))
}
</script>

<template>
  <div v-if="!looking" class="mx-auto max-w-xl px-8 py-24 text-center">
    <h1 class="text-2xl font-semibold">{{ workspace.space?.name }}</h1>
    <div class="mt-6 flex justify-center gap-2 text-sm">
      <button class="flex items-center gap-2 rounded-lg border border-line px-3 py-2 hover:bg-hover" @click="openToday">
        <AppIcon fallback="ph:calendar-check" /> Today
      </button>
      <button class="flex items-center gap-2 rounded-lg border border-line px-3 py-2 hover:bg-hover" @click="ui.paletteOpen = true">
        <AppIcon fallback="ph:magnifying-glass" /> Search
      </button>
    </div>
  </div>
</template>
