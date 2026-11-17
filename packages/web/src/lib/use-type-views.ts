// A type page's views: which one is open, the fixed ones some types have before and after the
// saved views, and changing the saved ones. A view's settings are saved on the type as a patch of
// its views (lib/type-patch.ts): they show at once, and changes made in quick succession go in
// one request. Which view a person last picked in a type is theirs, on every device.
import { newId, defaultViewFilter, statusProperty } from '@vasta/core'
import type { ObjectType, ViewDef } from '@vasta/core'
import { computed, ref, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { removeFromSidebar, viewItem } from './actions.ts'
import { clone } from './clone.ts'
import { confirmDialog, promptDialog } from './overlays.ts'
import { dropPreferences, preference } from './preferences.ts'
import { patchViews } from './type-patch.ts'

/**
 * Some built-in types get a fixed view before their saved views, and open on it: Tags a Tree of
 * nested tags (TagTree), Habits a Tracker of the last days (HabitBoard).
 */
const FIXED_VIEWS: Partial<Record<string, { id: string; label: string; icon: string }>> = {
  tag: { id: '__tree', label: 'Tree', icon: 'ph:tree-structure' },
  habit: { id: '__tracker', label: 'Tracker', icon: 'ph:check-square' },
}
/** A type with a status (tasks) also has its flow metrics, after its views. */
export const METRICS_VIEW = '__metrics'
/** Habits also have their Progress over the weeks, after the Tracker. */
export const PROGRESS_VIEW = '__progress'

export function useTypeViews(id: () => string, type: ComputedRef<ObjectType | undefined>) {
  const router = useRouter()
  const route = useRoute()
  const activeViewId = ref('')

  const fixedView = computed(() => FIXED_VIEWS[type.value?.system ?? ''])
  const hasMetrics = computed(() => !!statusProperty(type.value))
  const metricsActive = computed(() => hasMetrics.value && activeViewId.value === METRICS_VIEW)
  const hasProgress = computed(() => type.value?.system === 'habit')
  const progressActive = computed(() => hasProgress.value && activeViewId.value === PROGRESS_VIEW)
  const trackerActive = computed(() => !!fixedView.value && activeViewId.value === fixedView.value.id)
  const fixedActive = computed(() => metricsActive.value || progressActive.value || trackerActive.value)

  // A type opens on the view last picked in it (this person's choice, on every device).
  const lastView = preference(() => `type/${id()}/last-view`, '', { scope: 'account' })
  // Only a view picked is remembered, not one opened by default (the first view on a first visit).
  function pickView(viewId: string) {
    activeViewId.value = viewId
    lastView.value = viewId
  }

  watch(activeViewId, (viewId) => {
    // Opened from a view pinned in the sidebar (?view=), then another view picked: the link goes.
    if (route.query.view && route.query.view !== viewId) void router.replace({ query: { ...route.query, view: undefined } })
  })
  // A pinned view opens its view, also when this type's page is already open.
  const queryView = () => (typeof route.query.view === 'string' ? route.query.view : '')
  watch(queryView, (viewId) => {
    if (viewId) pickView(viewId)
  })
  watch(type, (t) => {
    if (!t) return
    const fixed = FIXED_VIEWS[t.system ?? '']
    if (!activeViewId.value) {
      if (queryView()) pickView(queryView())
      else activeViewId.value = lastView.value || fixed?.id || ''
    }
    const metrics = activeViewId.value === METRICS_VIEW && !!statusProperty(t)
    const progress = activeViewId.value === PROGRESS_VIEW && t.system === 'habit'
    if (activeViewId.value !== fixed?.id && !metrics && !progress && !t.views.some((v) => v.id === activeViewId.value)) activeViewId.value = t.views[0]?.id ?? ''
  }, { immediate: true })

  // A type without views shows one as a new view starts: closed objects left out (defaultViewFilter).
  const view = computed<ViewDef>(() => {
    const found = type.value?.views.find((v) => v.id === activeViewId.value)
    if (found) return found
    const filter = defaultViewFilter(type.value, { layout: 'list' })
    return { id: 'default', name: 'All', layout: 'list', ...(filter ? { filter } : {}) }
  })
  /** What the view button says on a phone. */
  const currentViewLabel = computed(() => (metricsActive.value ? 'Metrics' : progressActive.value ? 'Progress' : trackerActive.value && fixedView.value ? fixedView.value.label : view.value.name))

  const saveViews = (change: (views: ViewDef[]) => void) => (type.value ? patchViews(type.value, change) : Promise.resolve())

  function updateView(patch: Partial<ViewDef>) {
    if (!type.value) return
    void patchViews(type.value, (views) => {
      let target = views.find((v) => v.id === view.value.id)
      if (!target) {
        target = { ...clone(view.value), id: `${id()}:all` }
        views.push(target)
        activeViewId.value = target.id
      }
      Object.assign(target, patch)
      for (const key of Object.keys(patch) as (keyof ViewDef)[]) if (patch[key] === undefined) delete target[key]
    }, { delay: 400 })
  }

  async function addView() {
    if (!type.value) return
    const viewId = newId()
    const name = await promptDialog({ title: 'New view', value: 'New view', confirmLabel: 'Create' })
    if (!name || !type.value) return
    const filter = defaultViewFilter(type.value, { layout: view.value.layout })
    void saveViews((views) => views.push({ id: viewId, name, layout: view.value.layout, ...(filter ? { filter } : {}) }))
    pickView(viewId)
  }

  async function renameView() {
    const name = await promptDialog({ title: 'Rename view', value: view.value.name, confirmLabel: 'Rename' })
    if (!name) return
    void saveViews((views) => {
      const target = views.find((v) => v.id === view.value.id)
      if (target) target.name = name
    })
  }

  function duplicateView() {
    const copy: ViewDef = { ...clone(view.value), id: newId(), name: `${view.value.name} copy` }
    void saveViews((views) => views.push(copy))
    pickView(copy.id)
  }

  async function deleteView() {
    if ((type.value?.views.length ?? 0) <= 1) return
    const viewId = view.value.id
    if (!(await confirmDialog({ title: `Delete the view “${view.value.name}”?`, confirmLabel: 'Delete view', danger: true }))) return
    void saveViews((views) => views.splice(views.findIndex((v) => v.id === viewId), 1))
    activeViewId.value = type.value?.views[0]?.id ?? ''
    dropPreferences(`type/${id()}/view/${viewId}/`)
    void removeFromSidebar(viewItem(id(), viewId))
  }

  return { activeViewId, view, fixedView, hasMetrics, metricsActive, hasProgress, progressActive, trackerActive, fixedActive, currentViewLabel, pickView, updateView, saveViews, addView, renameView, duplicateView, deleteView }
}

export type TypeViews = ReturnType<typeof useTypeViews>
