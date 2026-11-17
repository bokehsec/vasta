<script setup lang="ts">
// The views of a type: tabs on a desktop (a tab drags into the sidebar and takes a right-click to
// pin the view), one button on a phone with the list in a sheet (the tabs would take rows of the
// screen). The fixed views some types have (Tree, Tracker, Progress, Metrics) sit with the saved ones.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ObjectType, ViewDef } from '@vasta/core'
import { pinMenu, viewItem } from '../lib/actions.ts'
import { greyButton } from '../lib/buttons.ts'
import { openContextMenu } from '../lib/overlays.ts'
import { METRICS_VIEW, PROGRESS_VIEW, type TypeViews } from '../lib/use-type-views.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import MenuRow from './MenuRow.vue'
import PopoverMenu from './PopoverMenu.vue'

const props = defineProps<{ type: ObjectType; views: TypeViews }>()
const router = useRouter()
const v = props.views
const pickerOpen = ref(false)
const pickerAnchor = ref<HTMLElement | null>(null)
const pick = (id: string) => {
  v.pickView(id)
  pickerOpen.value = false
}

/** A view's tab dragged out carries its link, which the sidebar pins where it is dropped. */
function dragTab(event: DragEvent, view: ViewDef) {
  const link = new URL(router.resolve(`/t/${viewItem(props.type.id, view.id)}`).href, location.href).href
  event.dataTransfer!.effectAllowed = 'copy'
  event.dataTransfer!.setData('text/uri-list', link)
  event.dataTransfer!.setData('text/plain', link)
}
/** Right-click on a view's tab: pin it. */
const tabMenu = (event: MouseEvent, view: ViewDef) => openContextMenu(event, [{ kind: 'heading', label: view.name }, pinMenu(viewItem(props.type.id, view.id))])

const tab = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm'
const tabState = (active: boolean) => (active ? 'bg-hover font-medium' : 'text-ink-soft hover:bg-hover')
</script>

<template>
  <template v-if="isPhone">
    <button ref="pickerAnchor" :class="greyButton" data-view-picker @click="pickerOpen = true">
      {{ v.currentViewLabel.value }} <AppIcon fallback="ph:caret-down" :size="14" class="text-ink-faint" />
    </button>
    <PopoverMenu v-model:open="pickerOpen" :anchor="pickerAnchor">
      <p class="px-2.5 pb-1 text-base font-semibold">Views</p>
      <MenuRow v-if="v.fixedView.value" :icon="v.fixedView.value.icon" :check="v.trackerActive.value" data-view-option @click="pick(v.fixedView.value.id)">{{ v.fixedView.value.label }}</MenuRow>
      <MenuRow v-if="v.hasProgress.value" icon="ph:chart-bar" :check="v.progressActive.value" data-view-option @click="pick(PROGRESS_VIEW)">Progress</MenuRow>
      <MenuRow v-for="view in type.views" :key="view.id" :check="view.id === v.view.value.id && !v.fixedActive.value" data-view-option @click="pick(view.id)">{{ view.name }}</MenuRow>
      <MenuRow v-if="v.hasMetrics.value" icon="ph:chart-line-up" :check="v.metricsActive.value" data-view-option @click="pick(METRICS_VIEW)">Metrics</MenuRow>
      <div class="my-1 border-t border-line" />
      <MenuRow icon="ph:plus" @click="(pickerOpen = false), v.addView()">New view</MenuRow>
    </PopoverMenu>
  </template>
  <template v-else>
    <button v-if="v.fixedView.value" :class="[tab, tabState(v.trackerActive.value)]" @click="v.pickView(v.fixedView.value.id)">
      <AppIcon :fallback="v.fixedView.value.icon" :size="14" /> {{ v.fixedView.value.label }}
    </button>
    <button v-if="v.hasProgress.value" :class="[tab, tabState(v.progressActive.value)]" data-progress-tab @click="v.pickView(PROGRESS_VIEW)">
      <AppIcon fallback="ph:chart-bar" :size="14" /> Progress
    </button>
    <!-- A div: WebKit does not start a drag on a button. -->
    <div
      v-for="view in type.views"
      :key="view.id"
      role="button"
      tabindex="0"
      draggable="true"
      class="cursor-default select-none"
      :class="[tab, tabState(view.id === v.view.value.id)]"
      @click="v.pickView(view.id)"
      @keydown.enter.space.prevent="v.pickView(view.id)"
      @contextmenu="tabMenu($event, view)"
      @dragstart="dragTab($event, view)"
    >
      {{ view.name }}
    </div>
    <button class="rounded-lg px-2 py-1.5 text-ink-faint hover:bg-hover hover:text-ink" title="Add view" aria-label="Add view" @click="v.addView">
      <AppIcon fallback="ph:plus" :size="14" />
    </button>
    <button v-if="v.hasMetrics.value" :class="[tab, tabState(v.metricsActive.value)]" @click="v.pickView(METRICS_VIEW)">
      <AppIcon fallback="ph:chart-line-up" :size="14" /> Metrics
    </button>
  </template>
</template>
