<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ObjectRecord, ObjectSummary } from '@vasta/core'
import { RANK_PROPERTY_ID, sortKey as fieldSortKey, matchesFilter } from '@vasta/core'
import AppIcon from '../components/AppIcon.vue'
import ArrangeMenus from '../components/ArrangeMenus.vue'
import FiltersSheet from '../components/FiltersSheet.vue'
import FlowMetrics from '../components/FlowMetrics.vue'
import HabitBoard from '../components/HabitBoard.vue'
import HabitProgress from '../components/HabitProgress.vue'
import HabitProgressMenu from '../components/HabitProgressMenu.vue'
import MenuRow from '../components/MenuRow.vue'
import ObjectCollection from '../components/ObjectCollection.vue'
import PopoverMenu from '../components/PopoverMenu.vue'
import ProcessMode from '../components/ProcessMode.vue'
import ReviewButton from '../components/ReviewButton.vue'
import TagTree from '../components/TagTree.vue'
import TipsCard from '../components/TipsCard.vue'
import TypeSettings from '../components/TypeSettings.vue'
import ViewSwitcher from '../components/ViewSwitcher.vue'
import ViewToolbar from '../components/ViewToolbar.vue'
import WorkflowChooser from '../components/WorkflowChooser.vue'
import { isInSidebar, pinItems, setProperties, viewItem, deleteTypeFlow } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { mainButton, quietButton } from '../lib/buttons.ts'
import { chip } from '../lib/colors.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle } from '../lib/format.ts'
import { showsNewPlace, startNew } from '../lib/new-item.ts'
import { objectRowMenu } from '../lib/object-menu.ts'
import { openContextMenu, openMenuAt } from '../lib/overlays.ts'
import { queryContext } from '../lib/query.ts'
import { keysOf } from '../lib/shortcuts.ts'
import { loadWorkspace, primeSummaries, typesById, workspace } from '../lib/state.ts'
import { loadTemplates, newTemplate, templatesOf } from '../lib/templates.ts'
import { useCompletion } from '../lib/use-completion.ts'
import { useReviewSession } from '../lib/use-review-session.ts'
import { useTypeViews } from '../lib/use-type-views.ts'
import { useViewToolbar, viewFields } from '../lib/view-toolbar.ts'
import { isPhone } from '../lib/viewport.ts'

const props = defineProps<{ id: string }>()
const router = useRouter()
const route = useRoute()

const type = computed(() => typesById.value.get(props.id))
const objects = ref<ObjectSummary[]>([])
const loading = ref(true)

async function loadObjects() {
  // A type of another space (a link to it) opens that space: the page reads its type from that space's types.
  if (!typesById.value.has(props.id)) {
    const other = await api.type(props.id).catch(() => undefined)
    if (other && other.spaceId !== workspace.space?.id) await loadWorkspace(other.spaceId)
  }
  objects.value = await api.objectsOfType(props.id)
  completion.prune(new Set(objects.value.map((object) => object.id)))
  primeSummaries(objects.value)
  loading.value = false
}
onMounted(loadObjects)

// Objects of this type created, changed, deleted or restored elsewhere (another page, an undo, a capture).
let reloadTimer: ReturnType<typeof setTimeout> | undefined
const stopListening = onChange((event) => {
  if (event.kind !== 'object' || event.typeId !== props.id) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void loadObjects(), 300)
})
onBeforeUnmount(() => {
  stopListening()
  clearTimeout(reloadTimer)
})

// The views, and what the toolbar narrows and arranges them with.
const views = useTypeViews(() => props.id, type)
const { view, fixedActive } = views
const toolbar = useViewToolbar({ typeId: () => props.id, type, view, updateView: views.updateView, fixedActive })
const { filterText } = toolbar

// New, here or from the phone's "+", starts from this view: its filter, Mine, the group (lib/new-item.ts).
showsNewPlace({ typeId: props.id, filter: () => toolbar.viewFilter.value, mine: () => toolbar.showMine.value && toolbar.mineOnly.value })

const settingsOpen = ref(route.query.settings === '1')
watch(
  () => route.query.settings,
  (value) => {
    if (value === '1') settingsOpen.value = true
  }
)
function closeSettings() {
  settingsOpen.value = false
  if (route.query.settings) void router.replace({ query: {} })
}

// What the view shows: its filter and the narrowing, sorted, with completions kept in place.
const completion = useCompletion({
  type: () => type.value,
  rows: () => visible.value,
  replace: moved,
  // A type page showing an agenda leaves its completions to the agenda.
  enabled: () => !toolbar.agendaActive.value,
  resetOn: () => JSON.stringify([props.id, views.activeViewId.value, view.value.filter, toolbar.sort.value, toolbar.groupField.value, view.value.layout, view.value.agenda, view.value.flat, view.value.list, view.value.table, view.value.board?.swimlanes, toolbar.mineOnly.value, toolbar.showClosed.value]),
})

const visible = computed(() => {
  const context = queryContext()
  const list = completion.keep(objects.value.filter((o) => matchesFilter(o, toolbar.viewFilter.value, context) && toolbar.minePasses(o)))
  const { field, direction } = toolbar.sort.value
  const factor = direction === 'asc' ? 1 : -1
  // Keys are read once per object (a formula would otherwise run at every comparison); titles
  // sort as shown, so daily notes and untitled objects take their place.
  // The board puts ranked cards in order itself; the others come by when they changed.
  const searched = (rows: ObjectSummary[]) => {
    const q = filterText.value.trim().toLowerCase()
    return completion.pin(rows).filter((object) => !q || displayTitle(object, type.value).toLowerCase().includes(q) || object.preview.toLowerCase().includes(q))
  }
  if (field === RANK_PROPERTY_ID) return searched([...list].sort((a, b) => (completion.placement(a).updatedAt < completion.placement(b).updatedAt ? 1 : -1)))
  const keyOf = (o: ObjectSummary) => (field === 'title' ? displayTitle(o, type.value).toLowerCase() : fieldSortKey(o, field, context))
  return searched(list
    .map((object) => ({ object, key: keyOf(completion.placement(object)) }))
    .sort((a, b) => {
      if (a.key === b.key) return 0
      if (a.key === '') return 1
      if (b.key === '') return -1
      return a.key < b.key ? -factor : factor
    })
    .map((k) => k.object))
})

function moved(saved: ObjectRecord | ObjectSummary) {
  const index = objects.value.findIndex((o) => o.id === saved.id)
  if (index >= 0) {
    const summary = { ...saved, preview: objects.value[index]!.preview } as ObjectSummary
    objects.value[index] = summary
    primeSummaries([summary])
  }
}
function created(object: ObjectRecord) {
  if (!objects.value.some((o) => o.id === object.id)) objects.value.push({ ...object, preview: '' } as ObjectSummary)
}

/** Right-click on an object in any layout (the ⋯ on a phone): the one row menu (lib/object-menu.ts). */
const objectMenu = (event: MouseEvent, object: ObjectSummary) =>
  openContextMenu(event, objectRowMenu(object, {
    type: type.value,
    completing: completion.entries.has(object.id),
    moved,
    trashed: (id) => (objects.value = objects.value.filter((o) => o.id !== id)),
  }))

// Review (lib/use-review-session.ts): the button, the chooser and the session on top of the page.
const review = useReviewSession({
  type,
  objects: () => objects.value,
  view: () => view.value,
  scopeLabel: () => `${view.value.name}${toolbar.mineOn.value ? ' · Mine' : ''}${filterText.value.trim() ? ` · Search: “${filterText.value.trim()}”` : ''}`,
  rows: () => visible.value.filter((o) => !completion.entries.has(o.id)),
  listed: () => !fixedActive.value && !toolbar.agendaActive.value,
  pickView: views.pickView,
})
// A review of another type's view shows that view's fields.
const reviewFields = computed(() => viewFields(type.value?.views.find((v) => v.id === review.session.value?.viewId) ?? view.value, props.id))

// "…" menu
const menuAnchor = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const pinned = computed(() => isInSidebar(props.id))
const viewPinned = computed(() => isInSidebar(viewItem(props.id, view.value.id)))
/** Runs a menu row's work after closing the menu. */
const choose = (work: () => unknown) => {
  menuOpen.value = false
  void work()
}
/** The sections to pin `item` in, beside the More menu's row. */
function pinFrom(event: MouseEvent, item: string) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuOpen.value = false
  openMenuAt(rect.left, rect.top, pinItems(item))
}

// New: the quick card for a plain object (nothing is made until it is saved), or the type's default
// template (lib/new-item.ts); the chevron picks another, or none.
const typeTemplates = computed(() => (type.value ? templatesOf(type.value.id) : []))
const defaultTemplate = computed(() => typeTemplates.value.find((t) => t.template?.kind === 'template' && t.template.default))
const createNew = () => type.value && startNew(type.value.id)
async function newMenu(event: MouseEvent) {
  if (!type.value) return
  const t = type.value
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  await loadTemplates()
  openMenuAt(rect.right - 224, rect.bottom + 4, [
    { label: `Blank ${t.name.toLowerCase()}`, icon: 'ph:file', run: () => startNew(t.id, { template: 'blank' }) },
    ...typeTemplates.value.map((template) => ({
      label: template.template!.name,
      icon: template === defaultTemplate.value ? 'ph:star-fill' : 'ph:copy-simple',
      ...(template === defaultTemplate.value ? { hint: 'Default' } : {}),
      run: () => startNew(t.id, { template }),
    })),
    { kind: 'separator' as const },
    { label: 'New template…', icon: 'ph:plus', run: () => newTemplate(t) },
    { label: 'Manage templates…', icon: 'ph:gear-six', run: () => (settingsOpen.value = true) },
  ])
}
</script>

<template>
  <div v-if="type" class="px-4 pb-24 pt-6 md:px-10 md:pt-10">
    <header class="flex items-center gap-3">
      <button class="grid h-10 w-10 place-items-center rounded-xl hover:ring-2 hover:ring-line max-md:h-11 max-md:w-11" :class="chip(type.color)" title="Type settings" @click="settingsOpen = true">
        <AppIcon :icon="type.icon" fallback="ph:cube" :size="22" />
      </button>
      <!-- A phone's top bar already names the page. -->
      <h1 class="min-w-0 text-2xl font-bold tracking-tight max-md:sr-only md:truncate">{{ type.pluralName }}</h1>
      <span class="text-sm text-ink-faint max-md:hidden" data-type-count>{{ visible.length }}</span>
      <span class="flex-1" />
      <ReviewButton v-if="!isPhone" :review="review" :loading="loading" />
      <button ref="menuAnchor" :class="quietButton" class="max-md:px-3" title="More" aria-label="More" @click="menuOpen = !menuOpen">
        <AppIcon fallback="ph:dots-three" :size="18" />
      </button>
      <!-- A phone has one "+", the floating one (PhoneTabBar): it starts New from this view. Templates stay here. -->
      <button v-if="isPhone && typeTemplates.length" :class="quietButton" class="max-md:px-3" title="New from a template" aria-label="New from a template" data-new-templates @click="newMenu">
        <AppIcon fallback="ph:copy-simple" :size="18" />
      </button>
      <div v-else-if="!isPhone" class="flex shrink-0 items-stretch" data-new-split>
        <button :class="mainButton" class="rounded-r-none" :title="defaultTemplate ? `New ${type.name} from “${defaultTemplate.template!.name}”` : `New ${type.name}`" @click="createNew">
          <AppIcon fallback="ph:plus" /> <span :class="review.isTask.value ? 'max-lg:hidden' : 'max-sm:hidden'">New {{ type.name }}</span>
        </button>
        <button :class="mainButton" class="rounded-l-none border-l border-surface/25 !px-1.5" title="Templates" aria-label="New from a template" @click="newMenu">
          <AppIcon fallback="ph:caret-down" :size="13" />
        </button>
      </div>
    </header>
    <PopoverMenu v-model:open="menuOpen" :anchor="menuAnchor" placement="bottom-end" width="15rem">
      <MenuRow icon="ph:gear-six" @click="(settingsOpen = true), (menuOpen = false)">Type settings…</MenuRow>
      <MenuRow icon="ph:push-pin" caret @click="pinFrom($event, props.id)">{{ pinned ? 'Pinned in sidebar' : 'Pin to sidebar' }}</MenuRow>
      <MenuRow v-if="review.isTask.value && review.reviewable.value" icon="ph:arrows-clockwise" data-workflows data-review-view @click="choose(() => review.choose('view', menuAnchor))">
        Review this view…
        <template #hint>{{ review.chooser.value.viewScope }}</template>
        <template #end><span class="tabular-nums text-ink-soft">{{ review.viewCount.value }}</span></template>
      </MenuRow>
      <MenuRow v-if="review.isTask.value && !review.reviewable.value && review.session.value" icon="ph:play" data-workflows @click="choose(() => review.choose('tasks', menuAnchor))">Paused review: {{ review.session.value.scopeLabel }}…</MenuRow>
      <MenuRow v-if="review.isTask.value" icon="ph:globe" data-review-all @click="choose(() => review.reviewSpace(menuAnchor))">
        Review all tasks in {{ workspace.space?.name }}
        <template #hint>Across all views · filters don’t apply</template>
        <template #end><span class="tabular-nums text-ink-soft">{{ review.spaceToReview.value }}</span></template>
      </MenuRow>
      <div class="my-1 border-t border-line" />
      <template v-if="!fixedActive">
        <div class="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">View “{{ view.name }}”</div>
        <MenuRow v-if="review.reviewable.value && !review.isTask.value" icon="ph:play" data-review-view @click="choose(() => review.choose('view', menuAnchor))">Review this view…</MenuRow>
        <MenuRow icon="ph:pencil-simple" @click="choose(views.renameView)">Rename view</MenuRow>
        <MenuRow icon="ph:copy" @click="choose(views.duplicateView)">Duplicate view</MenuRow>
        <MenuRow icon="ph:push-pin" caret @click="pinFrom($event, viewItem(props.id, view.id))">{{ viewPinned ? 'View pinned in sidebar' : 'Pin view to sidebar' }}</MenuRow>
        <MenuRow icon="ph:trash-simple" :disabled="type.views.length <= 1" @click="choose(views.deleteView)">Delete view</MenuRow>
      </template>
      <template v-if="!type.system">
        <div class="my-1 border-t border-line" />
        <MenuRow icon="ph:trash" danger @click="choose(() => deleteTypeFlow(type!))">Delete type…</MenuRow>
      </template>
    </PopoverMenu>
    <TypeSettings v-if="settingsOpen" :type="type" @close="closeSettings" />
    <p v-if="type.description" class="mt-2 max-w-2xl text-sm text-ink-soft">{{ type.description }}</p>

    <div class="mt-6 flex flex-wrap items-center gap-1 border-b border-line pb-2">
      <ViewSwitcher :type="type" :views="views" />
      <template v-if="isPhone">
        <FiltersSheet v-if="!views.metricsActive.value" :toolbar="toolbar" :shown="visible.length" />
        <HabitProgressMenu v-if="views.trackerActive.value && type.system === 'habit'" :type="type" />
        <!-- Review sits here on a phone: the header has no room beside the title. -->
        <ReviewButton :review="review" :loading="loading" class="ml-auto" />
      </template>
      <ViewToolbar v-else :toolbar="toolbar" />
      <ArrangeMenus :toolbar="toolbar" />
    </div>
    <div v-if="isPhone && review.isTask.value && toolbar.mineOn.value" class="mt-3 flex flex-wrap gap-2">
      <button :class="quietButton" class="bg-hover" aria-label="Remove Mine filter" data-review-mine @click="toolbar.toggleMine">Mine <AppIcon fallback="ph:x" :size="12" /></button>
    </div>
    <WorkflowChooser v-model:open="review.chooserOpen.value" :type="type" v-bind="review.chooser.value" @start="review.start" @resume="review.resume" @end="review.discard" />

    <p v-if="loading" class="py-10 text-sm text-ink-faint">Loading…</p>
    <div v-else-if="!objects.length" class="py-16 text-center text-sm text-ink-faint">
      No {{ type.pluralName.toLowerCase() }} yet.<template v-if="type.system === 'habit'"> Make one with New {{ type.name }}, then check it off each day from Today.</template
      ><template v-else> Make one with New {{ type.name }}, or press {{ keysOf('search') }} and type “/{{ type.name }}” and a title.</template>
      <TipsCard class="mx-auto mt-10 max-w-xl text-left" />
    </div>

    <FlowMetrics v-else-if="views.metricsActive.value" :type="type" />
    <HabitProgress v-else-if="views.progressActive.value" :type="type" :habits="objects" :filter="filterText" @menu="objectMenu" />
    <TagTree v-else-if="fixedActive && type.system === 'tag'" :tags="objects" :filter="filterText" @menu="objectMenu" />
    <HabitBoard v-else-if="fixedActive && type.system === 'habit'" :type="type" :habits="objects" :filter="filterText" @menu="objectMenu" />
    <p v-else-if="!visible.length && !toolbar.agendaActive.value" class="py-16 text-center text-sm text-ink-faint">No {{ type.pluralName.toLowerCase() }} match the filter.</p>
    <ObjectCollection
      v-else
      class="mt-6 max-md:mt-3"
      :objects="visible"
      :layout="view.layout"
      :group-field="toolbar.groupField.value"
      :fold-scope="`type/${id}/view/${view.id}`"
      :type-ids="[id]"
      :table="view.table"
      :board="view.board"
      :list="view.list"
      :manual="toolbar.manual.value"
      :agenda="view.agenda"
      :filter="toolbar.viewFilter.value"
      :open-in="view.openIn"
      :quick-actions="view.quickActions"
      :phone-table="toolbar.phoneTable.value"
      :flat="view.flat"
      @table="views.updateView({ table: $event })"
      @board="views.updateView({ board: $event })"
      @manual="views.updateView({ sort: undefined })"
      @menu="objectMenu"
      @moved="moved"
      @created="created"
    />
    <ProcessMode
      v-if="review.open.value && review.session.value && !loading"
      :session="review.session.value"
      :type="type"
      :objects="objects"
      :fields="reviewFields"
      :save="async (id, values) => moved(await setProperties(id, values))"
      :undone="review.undone"
      @update:session="review.setSession"
      @close="review.close"
      @end="review.end"
      @open="review.openFrom"
    />
  </div>
  <p v-else-if="loading" class="py-10 text-center text-sm text-ink-faint">Loading…</p>
  <div v-else class="grid h-full place-items-center text-sm text-ink-soft">Type not found.</div>
</template>
