<script setup lang="ts">
import { newId } from '@vasta/core'
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FilterGroup, GroupRule, ObjectRecord, ObjectSummary, PropertyValue, SortRule, ViewDef, ViewLayout, ViewOpenIn } from '@vasta/core'
import { RANK_PROPERTY_ID, closedStatusIds, defaultViewFilter, dueForReview, fillFromFilter, hidesClosed, isClosedTask, matchesFilter, needsTriage, parentFieldOf, quickActionsOf, reviewFieldOf, taskWorkflowQueues, sortKey as fieldSortKey, statusProperty, withClosedHidden, withClosedShown } from '@vasta/core'
import AgendaMenu from '../components/AgendaMenu.vue'
import AppIcon from '../components/AppIcon.vue'
import TipsCard from '../components/TipsCard.vue'
import ColumnsMenu from '../components/ColumnsMenu.vue'
import ListFieldsMenu from '../components/ListFieldsMenu.vue'
import FilterGroupEditor from '../components/FilterGroupEditor.vue'
import FlowMetrics from '../components/FlowMetrics.vue'
import ObjectCollection from '../components/ObjectCollection.vue'
import ProcessMode from '../components/ProcessMode.vue'
import QuickAdd from '../components/QuickAdd.vue'
import WorkflowChooser from '../components/WorkflowChooser.vue'
import HabitBoard from '../components/HabitBoard.vue'
import HabitProgress from '../components/HabitProgress.vue'
import HabitProgressMenu from '../components/HabitProgressMenu.vue'
import TagTree from '../components/TagTree.vue'
import PopoverMenu from '../components/PopoverMenu.vue'
import TypeSettings from '../components/TypeSettings.vue'
import { dayKey, deleteObjectFlow, deleteTypeFlow, isInSidebar, pinItems, pinMenu, removeFromSidebar, setProperties, viewItem } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton, tintedButton } from '../lib/buttons.ts'
import { onChange } from '../lib/events.ts'
import { clone } from '../lib/clone.ts'
import { listFields, quickActionsColumnShown, rowFieldsFromTable, tableColumns, toggleQuickActionsColumn } from '../lib/columns.ts'
import { clearSelection } from '../lib/selection.ts'
import { chip } from '../lib/colors.ts'
import { displayTitle } from '../lib/format.ts'
import { confirmDialog, openContextMenu, openMenuAt, promptDialog, type MenuItem } from '../lib/overlays.ts'
import { groupOptions, queryContext } from '../lib/query.ts'
import { keysOf } from '../lib/shortcuts.ts'
import { meId, sharedSpace } from '../lib/people.ts'
import { loadWorkspace, primeSummaries, replaceType, typesById, unsavedTypes, workspace } from '../lib/state.ts'
import { session } from '../lib/session.ts'
import { readSession, startSession, undoOutcome, writeSession, workflowTitle, type WorkflowKind, type ReviewSession } from '../lib/review-session.ts'
import { createFromTemplate, currentTemplates, loadTemplates, newTemplate, templatesOf } from '../lib/templates.ts'
import { copyObjectLink, openObject } from '../lib/open.ts'
import { quickActionMenuItems } from '../lib/quick-actions.ts'
import { subtaskMenuItems } from '../lib/subtasks.ts'
import { selectMenuItem } from '../lib/selection.ts'
import { isPhone } from '../lib/viewport.ts'
import { COMPLETION_FEEDBACK, createCompletionFeedback } from '../lib/completion-feedback.ts'
import { onObjectSave } from '../lib/object-saves.ts'
import { notice } from '../lib/state.ts'

const props = defineProps<{ id: string }>()
const router = useRouter()
const route = useRoute()

const type = computed(() => typesById.value.get(props.id))
const objects = ref<ObjectSummary[]>([])
const loading = ref(true)
const filterText = ref('')
const activeViewId = ref<string>('')

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

/**
 * Some built-in types get a fixed view before their saved views, and open on it: Tags a Tree of
 * nested tags (TagTree), Habits a Tracker of the last days (HabitBoard).
 */
const FIXED_VIEWS: Partial<Record<string, { id: string; label: string; icon: string }>> = {
  tag: { id: '__tree', label: 'Tree', icon: 'ph:tree-structure' },
  habit: { id: '__tracker', label: 'Tracker', icon: 'ph:check-square' },
}
const fixedView = computed(() => FIXED_VIEWS[type.value?.system ?? ''])
// A type with a status (tasks) also has its flow metrics, after its views.
const METRICS_VIEW = '__metrics'
const hasMetrics = computed(() => !!statusProperty(type.value))
const metricsActive = computed(() => hasMetrics.value && activeViewId.value === METRICS_VIEW)
// Habits also have their Progress over the weeks, after the Tracker.
const PROGRESS_VIEW = '__progress'
const hasProgress = computed(() => type.value?.system === 'habit')
const progressActive = computed(() => hasProgress.value && activeViewId.value === PROGRESS_VIEW)
const trackerActive = computed(() => !!fixedView.value && activeViewId.value === fixedView.value.id)
const fixedActive = computed(() => metricsActive.value || progressActive.value || trackerActive.value)

// A type opens on the view last picked in it, per type, on this device.
const viewKey = `vasta.view.${props.id}`
function lastView() {
  try {
    return localStorage.getItem(viewKey) ?? ''
  } catch {
    return ''
  }
}
// Only a view picked is remembered, not one opened by default (the first view on a first visit).
function pickView(id: string) {
  activeViewId.value = id
  try {
    localStorage.setItem(viewKey, id)
  } catch {}
}
// On a phone a table view is drawn as rows, unless "Show as table on this phone" is ticked (per
// view, on this device).
const phoneTableKey = computed(() => `vasta.phoneTable.${props.id}.${activeViewId.value}`)
const phoneTables = ref<Record<string, boolean>>({})
function readPhoneTable(key: string) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const phoneTable = computed(() => phoneTables.value[phoneTableKey.value] ?? readPhoneTable(phoneTableKey.value))
function togglePhoneTable() {
  const on = !phoneTable.value
  phoneTables.value = { ...phoneTables.value, [phoneTableKey.value]: on }
  try {
    if (on) localStorage.setItem(phoneTableKey.value, '1')
    else localStorage.removeItem(phoneTableKey.value)
  } catch {}
}

watch(activeViewId, (id) => {
  // Another view shows other rows: what was picked in the last one goes.
  clearSelection()
  // Opened from a view pinned in the sidebar (?view=), then another view picked: the link goes.
  if (route.query.view && route.query.view !== id) void router.replace({ query: { ...route.query, view: undefined } })
})

// A pinned view opens its view, also when this type's page is already open.
const queryView = () => (typeof route.query.view === 'string' ? route.query.view : '')
watch(queryView, (id) => {
  if (id) pickView(id)
})

watch(type, (t) => {
  if (!t) return
  const fixed = FIXED_VIEWS[t.system ?? '']
  if (!activeViewId.value) {
    if (queryView()) pickView(queryView())
    else activeViewId.value = lastView() || fixed?.id || ''
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

// View settings are saved on the type, debounced. Until the save answers, the edited copy is the
// type (unsavedTypes): a change event reloading the stored one meanwhile would undo the edit.
let saveTimer: ReturnType<typeof setTimeout> | undefined
function updateView(patch: Partial<ViewDef>) {
  if (!type.value) return
  const next = clone(type.value)
  let target = next.views.find((v) => v.id === view.value.id)
  if (!target) {
    target = { ...view.value, id: `${next.id}:all` }
    next.views.push(target)
    activeViewId.value = target.id
  }
  Object.assign(target, patch)
  for (const key of Object.keys(patch) as (keyof ViewDef)[]) if (patch[key] === undefined) delete target[key]
  unsavedTypes.set(next.id, next)
  replaceType(next)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const sending = unsavedTypes.get(next.id)
    if (!sending) return
    try {
      const saved = await api.saveType(sending)
      if (unsavedTypes.get(next.id) !== sending) return
      unsavedTypes.delete(next.id)
      replaceType(saved)
    } catch (error) {
      if (unsavedTypes.get(next.id) === sending) unsavedTypes.delete(next.id)
      throw error
    }
  }, 400)
}

async function addView() {
  if (!type.value) return
  const id = newId()
  const name = await promptDialog({ title: 'New view', value: 'New view', confirmLabel: 'Create' })
  if (!name || !type.value) return
  const next = clone(type.value)
  const filter = defaultViewFilter(next, { layout: view.value.layout })
  next.views.push({ id, name, layout: view.value.layout, ...(filter ? { filter } : {}) })
  replaceType(next)
  pickView(id)
  void api.saveType(next).then(replaceType)
}

// ---------------------------------------------------------------------------
// "…" menu

const menuAnchor = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const quickAdd = ref(false)
/** What the quick card's fields start with: what the view on show filters on (fillFromFilter). */
const quickFill = ref<Record<string, PropertyValue>>({})
function openQuickAdd() {
  const t = type.value
  quickFill.value = t ? fillFromFilter(t, view.value.filter, queryContext()) : {}
  quickAdd.value = true
}
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

function saveViews(mutate: (views: ViewDef[]) => void) {
  if (!type.value) return
  const next = clone(type.value)
  mutate(next.views)
  replaceType(next)
  void api.saveType(next).then(replaceType)
}

async function renameView() {
  menuOpen.value = false
  const name = await promptDialog({ title: 'Rename view', value: view.value.name, confirmLabel: 'Rename' })
  if (!name) return
  saveViews((views) => {
    const target = views.find((v) => v.id === view.value.id)
    if (target) target.name = name
  })
}

function duplicateView() {
  menuOpen.value = false
  const copy: ViewDef = { ...clone(view.value), id: newId(), name: `${view.value.name} copy` }
  saveViews((views) => views.push(copy))
  pickView(copy.id)
}

async function deleteView() {
  menuOpen.value = false
  if ((type.value?.views.length ?? 0) <= 1) return
  const id = view.value.id
  if (!(await confirmDialog({ title: `Delete the view “${view.value.name}”?`, confirmLabel: 'Delete view', danger: true }))) return
  saveViews((views) => views.splice(views.findIndex((v) => v.id === id), 1))
  activeViewId.value = type.value?.views[0]?.id ?? ''
  void removeFromSidebar(viewItem(props.id, id))
}

const pinned = computed(() => isInSidebar(props.id))
const viewPinned = computed(() => isInSidebar(viewItem(props.id, view.value.id)))

/** The sections to pin the type in, beside the More menu's row. */
function pinFrom(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuOpen.value = false
  openMenuAt(rect.left, rect.top, pinItems(props.id))
}

/** The sections to pin the open view in, so it opens from the sidebar on its own. */
function pinViewFrom(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuOpen.value = false
  openMenuAt(rect.left, rect.top, pinItems(viewItem(props.id, view.value.id)))
}

/** A view's tab dragged out carries its link, which the sidebar pins where it is dropped. */
function dragViewTab(event: DragEvent, v: ViewDef) {
  const link = new URL(router.resolve(`/t/${viewItem(props.id, v.id)}`).href, location.href).href
  event.dataTransfer!.effectAllowed = 'copy'
  event.dataTransfer!.setData('text/uri-list', link)
  event.dataTransfer!.setData('text/plain', link)
}

/** Right-click on a view's tab: pin it. */
function viewTabMenu(event: MouseEvent, v: ViewDef) {
  openContextMenu(event, [{ kind: 'heading', label: v.name }, pinMenu(viewItem(props.id, v.id))])
}

async function deleteType() {
  menuOpen.value = false
  if (type.value) await deleteTypeFlow(type.value)
}

// A phone's view picker: the views in a sheet behind one button.
const viewPickerOpen = ref(false)
const viewPickerAnchor = ref<HTMLElement | null>(null)
const currentViewLabel = computed(() => (metricsActive.value ? 'Metrics' : progressActive.value ? 'Progress' : trackerActive.value && fixedView.value ? fixedView.value.label : view.value.name))

// Review starts with this view's matching tasks. A whole-space sweep stays explicit in More.
// Both snapshot their scope/order/fields, with one paused session on this device.
const processOpen = ref(false)
const hasQuickActions = computed(() => quickActionsOf(type.value).length > 0)
const taskWorkflows = computed(() => type.value?.system === 'task')
const reviewable = computed(() => !fixedActive.value && !agendaActive.value && (hasQuickActions.value || !!reviewFieldOf(type.value)))
const openList = computed(() => visible.value.filter((o) => !completion.entries.has(o.id) && !isClosedTask(type.value, o)))
const processList = computed(() => openList.value.filter((o) => dueForReview(type.value, o, dayKey())))
const queues = computed(() => taskWorkflowQueues(type.value, [...objects.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), dayKey()))
const viewQueues = computed(() => taskWorkflowQueues(type.value, openList.value, dayKey()))
// Metrics and the calendar-fed agenda do not use `visible`: offer an explicitly named full sweep.
const primaryScope = computed(() => reviewable.value ? 'view' as const : 'space' as const)
const primaryQueues = computed(() => primaryScope.value === 'view' ? viewQueues.value : queues.value)
const chooserQueues = computed(() => workflowMode.value === 'view' ? viewQueues.value : queues.value)
const viewScope = computed(() => `${view.value.name}${showMine.value && mineOnly.value ? ' · Mine' : ''}${filterText.value.trim() ? ` · Search: “${filterText.value.trim()}”` : ''}`)
const spaceScope = computed(() => `All tasks in ${workspace.space?.name ?? ''}`)
const primaryScopeLabel = computed(() => primaryScope.value === 'view' ? viewScope.value : spaceScope.value)
const review = ref<ReviewSession | null>(null)
const currentFields = computed(() => view.value.layout === 'table' ? rowFieldsFromTable(tableColumns(view.value.table, [props.id])) : view.value.list?.fields ? listFields(view.value.list, [props.id]) : [])
const processFields = computed(() => review.value?.fieldIds ? listFields({ fields: review.value.fieldIds }, [props.id]) : currentFields.value)
const workflowOpen = ref(false)
const workflowMode = ref<'tasks' | 'view'>('tasks')
const workflowAnchor = ref<HTMLElement | null>(null)
function chooseWorkflow(mode: 'tasks' | 'view', anchor: HTMLElement | null) {
  menuOpen.value = false
  workflowMode.value = mode
  workflowAnchor.value = anchor
  workflowOpen.value = true
}
function setReview(next: ReviewSession | null) {
  review.value = next
  writeSession(next)
}
async function startProcess(kind: WorkflowKind, scope: 'space' | 'view', all = false) {
  if (scope === 'space' ? !taskWorkflows.value : !reviewable.value) return
  if (!session.user || !workspace.space) return
  if (review.value && !(await confirmDialog({ title: 'Start a new session?', message: `This replaces your paused ${workflowTitle(review.value).toLowerCase()} position. Changes to tasks stay saved.`, confirmLabel: 'Start new session' }))) return
  const selectedQueues = scope === 'view' ? viewQueues.value : queues.value
  const list = kind === 'tasks'
    ? [...selectedQueues.triage, ...(all && scope === 'view' ? openList.value.filter((o) => !needsTriage(type.value, o)) : selectedQueues.review)]
    : scope === 'view' ? (all ? openList.value : processList.value) : selectedQueues[kind]
  if (!list.length || !session.user || !workspace.space) return
  clearSelection()
  const fields = scope === 'space'
    ? ['status', 'due', ...(type.value?.quickActions?.deferField ? [type.value.quickActions.deferField] : []), 'assignee']
    : currentFields.value.filter((f) => f.on).map((f) => f.field)
  setReview(startSession({
    userId: session.user.id, spaceId: workspace.space.id, typeId: props.id,
    viewId: view.value.id, viewName: view.value.name, kind, scope,
    scopeLabel: scope === 'space' ? spaceScope.value : viewScope.value,
    fieldIds: [...new Set(fields)],
    ...(kind === 'tasks' ? { newCount: selectedQueues.triage.length } : {}),
  }, list.map((o) => o.id)))
  workflowOpen.value = false
  menuOpen.value = false
  processOpen.value = true
}
// Review tasks, one button in the header (beside the view picker on a phone; DESIGN_SYSTEM.md ›
// Buttons): tinted with the count while something waits (new tasks and check-ins together), grey
// without. A press resumes the paused session, else starts one; with nothing to review it opens the
// chooser, which says why and offers the whole space. Paused reviews keep their original scope.
const sessionAt = computed(() => review.value ? `${Math.min(review.value.index + 1, review.value.ids.length)} of ${review.value.ids.length}` : '')
const pausedScope = computed(() => review.value?.scopeLabel ?? review.value?.viewName ?? '')
const toReview = computed(() => primaryQueues.value.triage.length + primaryQueues.value.review.length)
const spaceToReview = computed(() => queues.value.triage.length + queues.value.review.length)
function pressReview(anchor: HTMLElement) {
  if (review.value) resumeReview()
  else if (toReview.value) void startProcess('tasks', primaryScope.value)
  else chooseWorkflow(primaryScope.value === 'view' ? 'view' : 'tasks', anchor)
}
function reviewSpace(anchor: HTMLElement | null) {
  if (spaceToReview.value) void startProcess('tasks', 'space')
  else chooseWorkflow('tasks', anchor)
}
function resumeReview() {
  if (!review.value) return
  clearSelection()
  workflowOpen.value = false
  processOpen.value = true
}
function closeReview() {
  processOpen.value = false
  if (review.value && review.value.index >= review.value.ids.length) setReview(null)
}
function endReview() {
  const origin = review.value?.viewId
  processOpen.value = false
  setReview(null)
  if (origin && type.value?.views.some((v) => v.id === origin)) pickView(origin)
}
async function discardReview() {
  if (await confirmDialog({ title: 'End this session?', message: 'Your task changes stay saved. Only the saved queue and position are cleared.', confirmLabel: 'End session' })) endReview()
}
// Undo of a decision from the notice, also once the review (or this page) has closed: the stored
// session loses the outcome too, so the end does not count it.
let mounted = true
onBeforeUnmount(() => (mounted = false))
function undoneInReview(id: string, name: string) {
  if (mounted && review.value) return setReview(undoOutcome(review.value, id, name))
  const stored = readSession(session.user?.id, workspace.space?.id)
  if (stored) writeSession(undoOutcome(stored, id, name))
}
function openFromReview(id: string) {
  if (review.value) setReview({ ...review.value, openedId: id })
  processOpen.value = false
  void openObject(id)
}
// This type's review, if there is one; back from the object opened in it (the history entry this
// page left for it), the review opens again. Another account's or space's is never shown.
function loadReview() {
  const stored = readSession(session.user?.id, workspace.space?.id)
  review.value = stored?.typeId === props.id ? stored : null
  const opened = review.value?.openedId
  if (!opened || !review.value) return
  const forward = (window.history.state as { forward?: unknown } | null)?.forward
  setReview({ ...review.value, openedId: undefined })
  if (typeof forward === 'string' && forward.startsWith(`/o/${opened}`)) processOpen.value = true
}
onMounted(loadReview)
watch([() => props.id, () => workspace.space?.id, () => session.user?.id], () => {
  processOpen.value = false
  loadReview()
})

/** An open task's quick actions, in its menu (a long press on a phone). */
function quickItems(object: ObjectSummary): MenuItem[] {
  const items = [...selectMenuItem(object.id), ...(completion.entries.has(object.id) ? [] : quickActionMenuItems(type.value, object, { save: async (id, values) => moved(await setProperties(id, values)) })), ...subtaskMenuItems(type.value, object, moved)]
  return items.length ? [{ kind: 'separator' }, ...items] : []
}

/** Right-click on an object in any layout. */
function objectMenu(event: MouseEvent, object: ObjectSummary) {
  openContextMenu(event, [
    { kind: 'heading', label: displayTitle(object, type.value) },
    { label: 'Open', icon: 'ph:arrow-square-out', run: () => openObject(object.id) },
    { label: 'Copy link to page', icon: 'ph:link', run: () => copyObjectLink(object.id) },
    pinMenu(object.id),
    ...quickItems(object),
    { kind: 'separator' },
    {
      label: 'Move to trash',
      icon: 'ph:trash',
      danger: true,
      run: async () => {
        if (await deleteObjectFlow(object.id)) objects.value = objects.value.filter((o) => o.id !== object.id)
      },
    },
  ])
}

// ---------------------------------------------------------------------------
// Fields

const valueProps = computed(() => (type.value?.properties ?? []).filter((p) => p.kind !== 'rich-text'))
const selectProps = computed(() => valueProps.value.filter((p) => p.kind === 'select'))
/** "Mine": only what one of the type's person fields (Assignee…) names the user in; per type, on this device. */
const personProps = computed(() => valueProps.value.filter((p) => p.kind === 'person'))
const mineKey = computed(() => `vasta.mine.${props.id}`)
const mineOnly = ref(false)
watch(
  mineKey,
  (key) => {
    try {
      mineOnly.value = localStorage.getItem(key) === '1'
    } catch {}
  },
  { immediate: true }
)
function toggleMine() {
  mineOnly.value = !mineOnly.value
  try {
    localStorage.setItem(mineKey.value, mineOnly.value ? '1' : '0')
  } catch {}
}
const showMine = computed(() => sharedSpace.value && personProps.value.length > 0)
const isMine = (o: ObjectSummary) => {
  const me = meId()
  return personProps.value.some((p) => {
    const value = o.props[p.id]
    return value?.kind === 'person' && !!me && value.value.includes(me)
  })
}

const sortFields = computed(() => [
  // A board keeps the order its cards were dragged into until it is sorted by a field.
  ...(view.value.layout === 'kanban' ? [{ field: RANK_PROPERTY_ID, label: 'Manual' }] : []),
  { field: 'updatedAt', label: 'Last edited' },
  { field: 'createdAt', label: 'Created' },
  { field: 'title', label: 'Title' },
  ...valueProps.value.filter((p) => ['date', 'number', 'text', 'select', 'formula'].includes(p.kind)).map((p) => ({ field: p.id, label: p.name })),
])
const groupFields = computed(() => [{ field: '', label: 'No grouping' }, ...groupOptions([props.id]).filter((f) => f.field !== 'type')])

const manual = computed(() => view.value.layout === 'kanban' && !view.value.sort?.length)
const sort = computed<SortRule>(() => (manual.value ? { field: RANK_PROPERTY_ID, direction: 'asc' } : (view.value.sort?.[0] ?? { field: 'updatedAt', direction: 'desc' })))
const groupField = computed(() => {
  if (view.value.layout === 'kanban') return view.value.groupBy?.[0]?.field ?? selectProps.value[0]?.id ?? 'tags'
  return view.value.groupBy?.[0]?.field ?? ''
})
// Closed tasks (Done, Dropped) are left out by a filter of the view's own, "Status is not Done,
// Dropped", that new views start with (closed-filter.ts). The switch in its filters adds or removes
// it; filter counts and Clear leave it out, as the view's resting state.
const viewFilter = computed(() => view.value.filter)
const canShowClosed = computed(() => closedStatusIds(type.value).length > 0)
const closedHidden = computed(() => hidesClosed(type.value, view.value.filter))
const closedLabel = computed(() => {
  const names = (statusProperty(type.value)?.options ?? []).filter((o) => o.status === 'done').map((o) => o.label.toLowerCase())
  return `Show ${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)}`
})
const toggleClosed = () => updateView({ filter: closedHidden.value ? withClosedShown(type.value, view.value.filter) : withClosedHidden(type.value, view.value.filter) })
const completion = createCompletionFeedback({
  type: () => type.value,
  rows: () => visible.value,
  replace: moved,
  save: setProperties,
  failed: (retry) => {
    notice.value = { message: 'The task was not saved. Try again.', action: { label: 'Retry', run: () => retry().catch(() => {}) } }
  },
})
provide(COMPLETION_FEEDBACK, completion)
const stopSaves = onObjectSave((object) => agendaActive.value ? undefined : completion.observe(object))
onBeforeUnmount(stopSaves)
watch(
  () => JSON.stringify([props.id, activeViewId.value, view.value.filter, sort.value, groupField.value, view.value.layout, view.value.agenda, view.value.flat, view.value.list, view.value.table, view.value.board?.swimlanes, mineOnly.value]),
  () => completion.clear(),
  { flush: 'sync' }
)

const visible = computed(() => {
  const context = queryContext()
  const list = objects.value.filter(
    (o) => completion.entries.has(o.id) || (matchesFilter(o, viewFilter.value, context) && (!showMine.value || !mineOnly.value || isMine(o)))
  )
  const { field, direction } = sort.value
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

function created(object: ObjectRecord) {
  if (!objects.value.some((o) => o.id === object.id)) objects.value.push({ ...object, preview: '' } as ObjectSummary)
}

// Board options: the fields cards show and the rows (swimlanes) they are in.
const boardAnchor = ref<HTMLElement | null>(null)
const boardOpen = ref(false)
const cardFieldChoices = computed(() => valueProps.value.filter((p) => p.id !== groupField.value))
const cardFieldIds = computed(() => view.value.board?.cardFields)
function toggleCardField(id: string) {
  const current = cardFieldIds.value ?? []
  const next = current.includes(id) ? current.filter((f) => f !== id) : cardFieldChoices.value.map((p) => p.id).filter((f) => f === id || current.includes(f))
  updateView({ board: { ...view.value.board, cardFields: next } })
}
function resetCardFields() {
  const { cardFields: _, ...rest } = view.value.board ?? {}
  updateView({ board: Object.keys(rest).length ? rest : undefined })
}
function setSwimlanes(field: string) {
  const { swimlanes: _, ...rest } = view.value.board ?? {}
  const next = field ? { ...rest, swimlanes: field } : rest
  updateView({ board: Object.keys(next).length ? next : undefined })
}

function moved(saved: ObjectRecord | ObjectSummary) {
  const index = objects.value.findIndex((o) => o.id === saved.id)
  if (index >= 0) {
    const summary = { ...saved, preview: objects.value[index]!.preview } as ObjectSummary
    objects.value[index] = summary
    primeSummaries([summary])
  }
}

// Filter: saved on the view, applied with the same engine as queries.
const filterAnchor = ref<HTMLElement | null>(null)
const filterOpen = ref(false)
const filterGroup = computed<FilterGroup>(() => view.value.filter ?? { kind: 'group', operator: 'and', items: [] })
const filterCount = computed(() => filterGroup.value.items.length - Number(closedHidden.value))
const setFilter = (group: FilterGroup) => updateView({ filter: group.items.length ? group : undefined })

// ---------------------------------------------------------------------------
// Menus

const layouts: { layout: ViewLayout; label: string; icon: string }[] = [
  { layout: 'list', label: 'List', icon: 'ph:list-dashes' },
  { layout: 'grid', label: 'Grid', icon: 'ph:grid-four' },
  { layout: 'wall', label: 'Wall', icon: 'ph:wall' },
  { layout: 'gallery', label: 'Gallery', icon: 'ph:images' },
  { layout: 'table', label: 'Table', icon: 'ph:table' },
  { layout: 'kanban', label: 'Board', icon: 'ph:kanban' },
  { layout: 'agenda', label: 'Agenda', icon: 'ph:calendar-dots' },
]
const layoutAnchor = ref<HTMLElement | null>(null)
const layoutOpen = ref(false)
/** Where the view opens what is clicked: as the type says (unset), or its own choice. */
// Quick actions for tasks: in a table, a column (shown, hidden and moved like the others); in a list,
// on each row.
const quickActionsOn = computed(() => (view.value.layout === 'table' ? quickActionsColumnShown(view.value.table, [props.id]) : !!view.value.quickActions))
function toggleQuickActions() {
  if (view.value.layout === 'table') updateView({ table: toggleQuickActionsColumn(view.value.table, [props.id]) })
  else updateView({ quickActions: view.value.quickActions ? undefined : true })
}

const openChoices = computed<{ openIn: ViewOpenIn | undefined; label: string }[]>(() => [
  { openIn: undefined, label: `Same as ${type.value?.name ?? 'the type'} (${type.value?.openIn === 'pane' ? 'side pane' : type.value?.openIn === 'page' ? 'full page' : 'window'})` },
  { openIn: 'popup', label: 'Window' },
  { openIn: 'pane', label: 'Side pane' },
  { openIn: 'page', label: 'Full page' },
])
const sortAnchor = ref<HTMLElement | null>(null)
const sortOpen = ref(false)
const columnsAnchor = ref<HTMLElement | null>(null)
const columnsOpen = ref(false)
const agendaAnchor = ref<HTMLElement | null>(null)
const agendaOpen = ref(false)
// The agenda is by day and time: sort, grouping, "Mine" and the text filter do not apply, so they hide.
const agendaActive = computed(() => view.value.layout === 'agenda' && !fixedActive.value)
const groupAnchor = ref<HTMLElement | null>(null)
const groupOpen = ref(false)

function setSort(field: string) {
  if (field === RANK_PROPERTY_ID) return updateView({ sort: undefined })
  const direction: SortRule['direction'] = sort.value.field === field ? (sort.value.direction === 'asc' ? 'desc' : 'asc') : field === 'title' ? 'asc' : 'desc'
  updateView({ sort: [{ field, direction }] })
}

function setGroup(field: string) {
  updateView({ groupBy: field ? [{ field } as GroupRule] : undefined })
  groupOpen.value = false
}

const currentLayout = computed(() => layouts.find((l) => l.layout === view.value.layout) ?? layouts[0]!)

// A phone's Filters sheet: search, Mine and the view's conditions, then Arrange (the menus the
// toolbar's buttons open on a desktop, each a sheet over this one). The button counts what is on.
const filtersOpen = ref(false)
const filtersAnchor = ref<HTMLElement | null>(null)
const searching = computed(() => !agendaActive.value && !!filterText.value.trim())
const mineOn = computed(() => showMine.value && mineOnly.value && !agendaActive.value && !fixedActive.value)
const activeFilterCount = computed(() => Number(searching.value) + Number(mineOn.value) + (fixedActive.value ? 0 : filterCount.value))
/** Clears search, Mine and the conditions; sort, grouping and layout stay. */
function clearFilters() {
  filterText.value = ''
  if (mineOnly.value) toggleMine()
  if (!fixedActive.value && filterCount.value) updateView({ filter: closedHidden.value ? withClosedHidden(type.value, undefined) : undefined })
}
const arrangeRows = computed(() => {
  const layout = view.value.layout
  const more =
    layout === 'table' ? { id: 'columns', label: 'Columns', icon: 'ph:columns', open: columnsOpen }
    : layout === 'list' ? { id: 'fields', label: 'Fields', icon: 'ph:list-checks', open: columnsOpen }
    : layout === 'kanban' ? { id: 'cards', label: 'Cards', icon: 'ph:cards', open: boardOpen }
    : layout === 'agenda' ? { id: 'options', label: 'Options', icon: 'ph:sliders-horizontal', open: agendaOpen }
    : undefined
  return [
    ...(agendaActive.value
      ? []
      : [
          { id: 'sort', label: 'Sort', icon: sort.value.direction === 'asc' ? 'ph:sort-ascending' : 'ph:sort-descending', value: sortFields.value.find((f) => f.field === sort.value.field)?.label ?? '', open: sortOpen },
          { id: 'group', label: 'Group', icon: 'ph:rows', value: groupField.value ? (groupFields.value.find((f) => f.field === groupField.value)?.label ?? 'Group') : 'None', open: groupOpen },
        ]),
    { id: 'layout', label: 'Layout', icon: currentLayout.value.icon, value: currentLayout.value.label, open: layoutOpen },
    ...(more ? [{ ...more, value: '' }] : []),
  ]
})

// "Select tasks" in a phone's More menu: selection mode with nothing picked, from the collection.
const collection = ref<InstanceType<typeof ObjectCollection> | null>(null)
function selectFromMenu() {
  menuOpen.value = false
  collection.value?.startSelecting()
}

// New: the quick card for a plain object (nothing is made until it is saved), or the type's default
// template (lib/templates.ts); the chevron picks another, or none.
const typeTemplates = computed(() => (type.value ? templatesOf(type.value.id) : []))
const defaultTemplate = computed(() => typeTemplates.value.find((t) => t.template?.kind === 'template' && t.template.default))

async function createNew() {
  const t = type.value
  if (!t) return
  await currentTemplates()
  if (defaultTemplate.value) void createFromTemplate(t, defaultTemplate.value)
  else openQuickAdd()
}

async function newMenu(event: MouseEvent) {
  if (!type.value) return
  const t = type.value
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  await loadTemplates()
  openMenuAt(rect.right - 224, rect.bottom + 4, [
    { label: `Blank ${t.name.toLowerCase()}`, icon: 'ph:file', run: openQuickAdd },
    ...typeTemplates.value.map((template) => ({
      label: template.template!.name,
      icon: template === defaultTemplate.value ? 'ph:star-fill' : 'ph:copy-simple',
      ...(template === defaultTemplate.value ? { hint: 'Default' } : {}),
      run: () => createFromTemplate(t, template),
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
      <h1 class="min-w-0 text-2xl font-bold tracking-tight max-md:break-words md:truncate">{{ type.pluralName }}</h1>
      <span class="text-sm text-ink-faint max-md:hidden">{{ objects.length }}</span>
      <span class="flex-1" />
      <button v-if="!loading && taskWorkflows && !isPhone" :class="review || toReview ? tintedButton : greyButton" class="min-w-0" :title="review ? `Resume ${pausedScope}` : primaryScopeLabel" data-review-tasks @click="pressReview($event.currentTarget as HTMLElement)">
        <template v-if="review"><AppIcon fallback="ph:play" /><span class="truncate">Resume review</span> <span class="tabular-nums" data-process-resume>{{ sessionAt }}</span></template>
        <template v-else><AppIcon fallback="ph:arrows-clockwise" />{{ primaryScope === 'view' ? 'Review' : 'Review all' }} <span v-if="toReview" class="tabular-nums">{{ toReview }}</span></template>
      </button>
      <button v-else-if="!loading && review && !taskWorkflows" :class="tintedButton" class="min-w-0" data-process-resume @click="resumeReview">
        <AppIcon fallback="ph:play" /> <span class="truncate">{{ isPhone ? 'Resume' : `Resume review of ${review.viewName}` }}</span> <span class="tabular-nums">{{ sessionAt }}</span>
      </button>
      <button ref="menuAnchor" class="rounded-lg p-2 text-ink-soft hover:bg-hover hover:text-ink max-md:p-3.5" title="More" @click="menuOpen = !menuOpen">
        <AppIcon fallback="ph:dots-three" :size="18" />
      </button>
      <div class="flex shrink-0 items-stretch rounded-lg bg-ink text-sm font-medium text-surface max-md:min-h-11" data-new-split>
        <button class="flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 hover:opacity-90" :title="defaultTemplate ? `New ${type.name} from “${defaultTemplate.template!.name}”` : `New ${type.name}`" @click="createNew">
          <AppIcon fallback="ph:plus" /> <span :class="taskWorkflows ? 'max-lg:hidden' : 'max-sm:hidden'">New {{ type.name }}</span>
        </button>
        <button class="grid place-items-center rounded-r-lg border-l border-surface/25 px-1.5 hover:opacity-90 max-md:min-w-11" title="Templates" aria-label="New from a template" @click="newMenu">
          <AppIcon fallback="ph:caret-down" :size="13" />
        </button>
      </div>
    </header>
    <PopoverMenu v-model:open="menuOpen" :anchor="menuAnchor" placement="bottom-end" width="15rem">
      <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="(settingsOpen = true), (menuOpen = false)">
        <AppIcon fallback="ph:gear-six" class="text-ink-soft" /> Type settings…
      </button>
      <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="pinFrom">
        <AppIcon fallback="ph:push-pin" class="text-ink-soft" /> {{ pinned ? 'Pinned in sidebar' : 'Pin to sidebar' }}
        <AppIcon fallback="ph:caret-right" :size="12" class="ml-auto text-ink-faint" />
      </button>
      <button v-if="taskWorkflows && reviewable" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover max-md:min-h-11" data-workflows data-review-view @click="chooseWorkflow('view', menuAnchor)">
        <AppIcon fallback="ph:arrows-clockwise" class="shrink-0 text-ink-soft" />
        <span class="min-w-0 flex-1"><span class="block">Review this view…</span><span class="block break-words text-xs text-ink-faint">{{ viewScope }}</span></span>
        <span class="tabular-nums text-ink-soft">{{ viewQueues.triage.length + viewQueues.review.length }}</span>
      </button>
      <button v-if="taskWorkflows && !reviewable && review" class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover" data-workflows @click="chooseWorkflow('tasks', menuAnchor)">
        <AppIcon fallback="ph:play" class="shrink-0 text-ink-soft" /><span class="min-w-0 break-words">Paused review: {{ pausedScope }}…</span>
      </button>
      <button v-if="taskWorkflows" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover max-md:min-h-11" data-review-all @click="reviewSpace(menuAnchor)">
        <AppIcon fallback="ph:globe" class="shrink-0 text-ink-soft" />
        <span class="min-w-0 flex-1"><span class="block">Review all tasks in {{ workspace.space?.name }}</span><span class="block text-xs text-ink-faint">Across all views · filters don’t apply</span></span>
        <span class="tabular-nums text-ink-soft">{{ spaceToReview }}</span>
      </button>
      <button v-if="isPhone && collection?.canSelect" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" data-select-mode @click="selectFromMenu">
        <AppIcon fallback="ph:check-square" class="text-ink-soft" /> Select {{ type.pluralName.toLowerCase() }}
      </button>
      <div class="my-1 border-t border-line" />
      <template v-if="!fixedActive">
      <div class="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">View “{{ view.name }}”</div>
      <button v-if="reviewable && !taskWorkflows" class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" data-review-view @click="chooseWorkflow('view', menuAnchor)">
        <AppIcon fallback="ph:play" class="text-ink-soft" /> Review this view…
      </button>
      <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="renameView">
        <AppIcon fallback="ph:pencil-simple" class="text-ink-soft" /> Rename view
      </button>
      <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="duplicateView">
        <AppIcon fallback="ph:copy" class="text-ink-soft" /> Duplicate view
      </button>
      <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="pinViewFrom">
        <AppIcon fallback="ph:push-pin" class="text-ink-soft" /> {{ viewPinned ? 'View pinned in sidebar' : 'Pin view to sidebar' }}
        <AppIcon fallback="ph:caret-right" :size="12" class="ml-auto text-ink-faint" />
      </button>
      <button
        class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="type.views.length <= 1"
        @click="deleteView"
      >
        <AppIcon fallback="ph:trash-simple" class="text-ink-soft" /> Delete view
      </button>
      </template>
      <template v-if="!type.system">
        <div class="my-1 border-t border-line" />
        <button class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-hover" @click="deleteType">
          <AppIcon fallback="ph:trash" /> Delete type…
        </button>
      </template>
    </PopoverMenu>
    <TypeSettings v-if="settingsOpen" :type="type" @close="closeSettings" />
    <p v-if="type.description" class="mt-2 max-w-2xl text-sm text-ink-soft">{{ type.description }}</p>

    <div class="mt-6 flex flex-wrap items-center gap-1 border-b border-line pb-2">
      <!-- A phone: one button for the view, its list in a sheet (the tabs would take rows of the screen). -->
      <template v-if="isPhone">
        <button ref="viewPickerAnchor" :class="greyButton" data-view-picker @click="viewPickerOpen = true">
          {{ currentViewLabel }} <AppIcon fallback="ph:caret-down" :size="14" class="text-ink-faint" />
        </button>
        <PopoverMenu v-model:open="viewPickerOpen" :anchor="viewPickerAnchor">
          <p class="px-2.5 pb-1 text-base font-semibold">Views</p>
          <button v-if="fixedView" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" data-view-option @click="pickView(fixedView.id), (viewPickerOpen = false)">
            <AppIcon :fallback="fixedView.icon" :size="16" class="text-ink-soft" /> {{ fixedView.label }}
            <AppIcon v-if="trackerActive" fallback="ph:check" class="ml-auto text-accent" />
          </button>
          <button v-if="hasProgress" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" data-view-option @click="pickView(PROGRESS_VIEW), (viewPickerOpen = false)">
            <AppIcon fallback="ph:chart-bar" :size="16" class="text-ink-soft" /> Progress
            <AppIcon v-if="progressActive" fallback="ph:check" class="ml-auto text-accent" />
          </button>
          <button v-for="v in type.views" :key="v.id" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" data-view-option @click="pickView(v.id), (viewPickerOpen = false)">
            {{ v.name }}
            <AppIcon v-if="v.id === view.id && !fixedActive && !metricsActive" fallback="ph:check" class="ml-auto text-accent" />
          </button>
          <button v-if="hasMetrics" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-soft" data-view-option @click="pickView(METRICS_VIEW), (viewPickerOpen = false)">
            <AppIcon fallback="ph:chart-line-up" :size="16" /> Metrics
            <AppIcon v-if="metricsActive" fallback="ph:check" class="ml-auto text-accent" />
          </button>
          <div class="my-1 border-t border-line" />
          <button class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-soft" @click="(viewPickerOpen = false), addView()">
            <AppIcon fallback="ph:plus" :size="16" /> New view
          </button>
        </PopoverMenu>
        <button
          v-if="!metricsActive"
          ref="filtersAnchor"
          :class="activeFilterCount ? tintedButton : greyButton"
          data-filters-button
          @click="filtersOpen = true"
        >
          <AppIcon fallback="ph:funnel" :size="16" /> Filters
          <span v-if="activeFilterCount" class="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-semibold text-white" data-filters-count>{{ activeFilterCount }}</span>
        </button>
        <HabitProgressMenu v-if="trackerActive && type.system === 'habit'" :type="type" />
        <!-- Review sits here on a phone: the header has no room beside the title. -->
        <button v-if="!loading && taskWorkflows" :class="[review || toReview ? tintedButton : greyButton, 'ml-auto']" :title="review ? `Resume ${pausedScope}` : primaryScopeLabel" data-review-tasks @click="pressReview($event.currentTarget as HTMLElement)">
          <template v-if="review"><AppIcon fallback="ph:play" /> Resume <span class="tabular-nums" data-process-resume>{{ sessionAt }}</span></template>
          <template v-else><AppIcon fallback="ph:arrows-clockwise" /> {{ primaryScope === 'view' ? 'Review' : 'Review all' }} <span v-if="toReview" class="tabular-nums">{{ toReview }}</span></template>
        </button>
        <PopoverMenu v-model:open="filtersOpen" :anchor="filtersAnchor" label="Search and filter">
          <!-- Changes apply as they are made: the count says what they leave, Done closes the sheet. -->
          <div class="flex items-center px-2.5 pb-1">
            <div class="min-w-0">
              <p class="text-base font-semibold">Search and filter</p>
              <p class="text-[13px] text-ink-faint" data-filters-shown>{{ visible.length }} {{ visible.length === 1 ? type.name.toLowerCase() : type.pluralName.toLowerCase() }} shown</p>
            </div>
            <button v-if="activeFilterCount" class="ml-auto h-11 rounded-lg px-2.5 text-[15px] text-accent" data-filters-clear @click="clearFilters">Clear</button>
            <button class="-mr-1 h-11 rounded-lg px-2.5 text-[15px] font-semibold text-accent" :class="activeFilterCount ? '' : 'ml-auto'" data-filters-done @click="filtersOpen = false">Done</button>
          </div>
          <div v-if="!agendaActive" class="mx-1.5 mb-2 flex items-center gap-2 rounded-lg bg-hover px-3 text-ink-faint focus-within:ring-1 focus-within:ring-accent/50">
            <AppIcon fallback="ph:magnifying-glass" :size="16" />
            <input v-model="filterText" class="h-11 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint" placeholder="Search this view" aria-label="Search this view" enterkeyhint="search" data-filters-search />
          </div>
          <button v-if="showMine && !agendaActive && !fixedActive" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" :aria-pressed="mineOnly" data-filters-mine @click="toggleMine">
            <AppIcon fallback="ph:user-circle" :size="16" class="text-ink-soft" /> Mine
            <AppIcon :fallback="mineOnly ? 'ph:check-square-fill' : 'ph:square'" :class="mineOnly ? 'text-accent' : 'text-ink-faint'" class="ml-auto" />
          </button>
          <button v-if="canShowClosed && !fixedActive" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" :aria-pressed="!closedHidden" data-show-closed @click="toggleClosed">
            <AppIcon fallback="ph:check-circle" :size="16" class="text-ink-soft" /> {{ closedLabel }}
            <AppIcon :fallback="!closedHidden ? 'ph:check-square-fill' : 'ph:square'" :class="!closedHidden ? 'text-accent' : 'text-ink-faint'" class="ml-auto" />
          </button>
          <template v-if="!fixedActive">
            <div class="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Filters</div>
            <div class="p-1.5">
              <FilterGroupEditor :group="filterGroup" :type-ids="[id]" @update="setFilter" />
            </div>
            <div class="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Arrange</div>
            <button v-for="row in arrangeRows" :key="row.id" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" :data-arrange="row.id" @click="row.open.value = true">
              <AppIcon :fallback="row.icon" :size="16" class="text-ink-soft" /> {{ row.label }}
              <span class="ml-auto truncate text-ink-faint">{{ row.value }}</span>
              <AppIcon fallback="ph:caret-right" :size="12" class="shrink-0 text-ink-faint" />
            </button>
          </template>
        </PopoverMenu>
      </template>
      <template v-else>
      <button
        v-if="fixedView"
        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
        :class="trackerActive ? 'bg-hover font-medium' : 'text-ink-soft hover:bg-hover'"
        @click="pickView(fixedView.id)"
      >
        <AppIcon :fallback="fixedView.icon" :size="14" /> {{ fixedView.label }}
      </button>
      <button
        v-if="hasProgress"
        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
        :class="progressActive ? 'bg-hover font-medium' : 'text-ink-soft hover:bg-hover'"
        data-progress-tab
        @click="pickView(PROGRESS_VIEW)"
      >
        <AppIcon fallback="ph:chart-bar" :size="14" /> Progress
      </button>
      <!-- A div: WebKit does not start a drag on a button. A tab drags into the sidebar to pin the view. -->
      <div
        v-for="v in type.views"
        :key="v.id"
        role="button"
        tabindex="0"
        draggable="true"
        class="cursor-default select-none rounded-lg px-3 py-1.5 text-sm"
        :class="v.id === view.id ? 'bg-hover font-medium' : 'text-ink-soft hover:bg-hover'"
        @click="pickView(v.id)"
        @keydown.enter.space.prevent="pickView(v.id)"
        @contextmenu="viewTabMenu($event, v)"
        @dragstart="dragViewTab($event, v)"
      >
        {{ v.name }}
      </div>
      <button class="rounded-lg px-2 py-1.5 text-ink-faint hover:bg-hover hover:text-ink" title="Add view" @click="addView">
        <AppIcon fallback="ph:plus" :size="14" />
      </button>
      <button
        v-if="hasMetrics"
        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
        :class="metricsActive ? 'bg-hover font-medium' : 'text-ink-soft hover:bg-hover'"
        @click="pickView(METRICS_VIEW)"
      >
        <AppIcon fallback="ph:chart-line-up" :size="14" /> Metrics
      </button>
      </template>

      <div v-if="!isPhone" class="ml-auto flex items-center gap-1 whitespace-nowrap text-sm [&>*]:shrink-0">
        <div v-if="!agendaActive" class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink-faint focus-within:bg-hover">
          <AppIcon fallback="ph:magnifying-glass" :size="14" />
          <input v-model="filterText" class="w-28 bg-transparent md:w-36 text-ink outline-none placeholder:text-ink-faint" placeholder="Filter…" />
        </div>
        <HabitProgressMenu v-if="trackerActive && type.system === 'habit'" :type="type" />
        <template v-if="!fixedActive">
        <button
          v-if="showMine && !agendaActive"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-hover"
          :class="mineOnly ? 'bg-accent/10 text-accent' : 'text-ink-soft'"
          :title="`Only what ${personProps.map((p) => p.name).join(' or ')} names you in`"
          @click="toggleMine"
        >
          <AppIcon fallback="ph:user-circle" /> Mine
        </button>
        <button
          ref="filterAnchor"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-hover"
          :class="filterCount ? 'text-accent' : 'text-ink-soft'"
          @click="filterOpen = !filterOpen"
        >
          <AppIcon fallback="ph:funnel" /> Filter<span v-if="filterCount"> · {{ filterCount }}</span>
        </button>
        <button v-if="!agendaActive" ref="sortAnchor" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover" @click="sortOpen = !sortOpen">
          <AppIcon :fallback="sort.direction === 'asc' ? 'ph:sort-ascending' : 'ph:sort-descending'" />
          {{ sortFields.find((f) => f.field === sort.field)?.label }}
        </button>
        <button v-if="!agendaActive" ref="groupAnchor" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover" @click="groupOpen = !groupOpen">
          <AppIcon fallback="ph:rows" />
          {{ groupField ? groupFields.find((f) => f.field === groupField)?.label ?? 'Group' : 'Group' }}
        </button>
        <button v-if="view.layout === 'kanban'" ref="boardAnchor" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover" @click="boardOpen = !boardOpen">
          <AppIcon fallback="ph:cards" /> Cards
        </button>
        <button
          v-if="view.layout === 'table'"
          ref="columnsAnchor"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover"
          @click="columnsOpen = !columnsOpen"
        >
          <AppIcon fallback="ph:columns" /> Columns
        </button>
        <button
          v-else-if="view.layout === 'list'"
          ref="columnsAnchor"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover"
          @click="columnsOpen = !columnsOpen"
        >
          <AppIcon fallback="ph:list-checks" /> Fields
        </button>
        <button v-if="view.layout === 'agenda'" ref="agendaAnchor" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover" @click="agendaOpen = !agendaOpen">
          <AppIcon fallback="ph:sliders-horizontal" /> Options
        </button>
        <button ref="layoutAnchor" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-soft hover:bg-hover" @click="layoutOpen = !layoutOpen">
          <AppIcon :fallback="currentLayout.icon" /> {{ currentLayout.label }}
        </button>
        </template>
      </div>
      <PopoverMenu v-model:open="filterOpen" :anchor="filterAnchor" placement="bottom-end" width="34rem">
        <button v-if="canShowClosed" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" :aria-pressed="!closedHidden" data-show-closed @click="toggleClosed">
          <AppIcon fallback="ph:check-circle" class="text-ink-soft" /> {{ closedLabel }}
          <AppIcon :fallback="!closedHidden ? 'ph:check-square-fill' : 'ph:square'" :class="!closedHidden ? 'text-accent' : 'text-ink-faint'" class="ml-auto" />
        </button>
        <div class="p-1.5">
          <FilterGroupEditor :group="filterGroup" :type-ids="[id]" @update="setFilter" />
        </div>
      </PopoverMenu>
      <PopoverMenu v-model:open="sortOpen" :anchor="sortAnchor" placement="bottom-end" width="13rem">
        <button v-for="f in sortFields" :key="f.field" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="setSort(f.field)">
          {{ f.label }}
          <AppIcon v-if="sort.field === f.field" :fallback="sort.direction === 'asc' ? 'ph:arrow-up' : 'ph:arrow-down'" class="ml-auto text-accent" />
        </button>
      </PopoverMenu>
      <PopoverMenu v-model:open="groupOpen" :anchor="groupAnchor" placement="bottom-end" width="13rem">
        <button v-for="f in groupFields" :key="f.field" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover" @click="setGroup(f.field)">
          {{ f.label }}
          <AppIcon v-if="groupField === f.field" fallback="ph:check" class="ml-auto text-accent" />
        </button>
      </PopoverMenu>
      <PopoverMenu v-model:open="boardOpen" :anchor="boardAnchor" placement="bottom-end" width="15rem">
        <div class="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Swimlanes</div>
        <select
          :value="view.board?.swimlanes ?? ''"
          class="mx-1.5 mb-2 w-[calc(100%-0.75rem)] rounded-md bg-hover px-2 py-1 text-sm outline-none"
          aria-label="Swimlanes"
          @change="setSwimlanes(($event.target as HTMLSelectElement).value)"
        >
          <option value="">None</option>
          <option v-for="f in groupFields.filter((g) => g.field && g.field !== groupField)" :key="f.field" :value="f.field">{{ f.label }}</option>
        </select>
        <div class="flex items-center px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Card fields
          <button v-if="cardFieldIds" class="ml-auto normal-case tracking-normal text-ink-faint hover:text-ink" @click="resetCardFields">Automatic</button>
        </div>
        <p v-if="!cardFieldIds" class="px-2.5 pb-1 text-xs text-ink-faint">The first two with a value. Pick to choose.</p>
        <button
          v-for="p in cardFieldChoices"
          :key="p.id"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover"
          @click="toggleCardField(p.id)"
        >
          <AppIcon :fallback="cardFieldIds?.includes(p.id) ? 'ph:check-square-fill' : 'ph:square'" :class="cardFieldIds?.includes(p.id) ? 'text-accent' : 'text-ink-faint'" />
          {{ p.name }}
        </button>
      </PopoverMenu>
      <PopoverMenu v-model:open="columnsOpen" :anchor="columnsAnchor" placement="bottom-end" width="17rem">
        <ColumnsMenu v-if="view.layout === 'table'" :table="view.table" :type-ids="[id]" @update="updateView({ table: $event })" />
        <ListFieldsMenu v-else :list="view.list" :type-ids="[id]" @update="updateView({ list: $event })" />
      </PopoverMenu>
      <PopoverMenu v-model:open="agendaOpen" :anchor="agendaAnchor" placement="bottom-end" width="18rem">
        <AgendaMenu :agenda="view.agenda" :type-ids="[id]" @update="updateView({ agenda: $event })" />
      </PopoverMenu>
      <PopoverMenu v-model:open="layoutOpen" :anchor="layoutAnchor" placement="bottom-end" width="15rem">
        <button
          v-for="l in layouts"
          :key="l.layout"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover"
          @click="updateView({ layout: l.layout }), (layoutOpen = false)"
        >
          <AppIcon :fallback="l.icon" class="text-ink-soft" /> {{ l.label }}
          <AppIcon v-if="view.layout === l.layout" fallback="ph:check" class="ml-auto text-accent" />
        </button>
        <div class="my-1 border-t border-line" />
        <div class="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Open in</div>
        <button
          v-for="o in openChoices"
          :key="o.label"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover"
          :aria-pressed="view.openIn === o.openIn"
          @click="updateView({ openIn: o.openIn }), (layoutOpen = false)"
        >
          {{ o.label }}
          <AppIcon v-if="view.openIn === o.openIn" fallback="ph:check" class="ml-auto text-accent" />
        </button>
        <template v-if="parentFieldOf(type) && (view.layout === 'list' || (isPhone && view.layout === 'table' && !phoneTable))">
          <div class="my-1 border-t border-line" />
          <button class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover max-md:py-2.5" :aria-pressed="!view.flat" data-nest-subtasks @click="updateView({ flat: view.flat ? undefined : true }), (layoutOpen = false)">
            <AppIcon fallback="ph:tree-structure" class="text-ink-soft" /> Nest subtasks
            <AppIcon v-if="!view.flat" fallback="ph:check" class="ml-auto text-accent" />
          </button>
        </template>
        <template v-if="isPhone && view.layout === 'table'">
          <div class="my-1 border-t border-line" />
          <button class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-hover" :aria-pressed="phoneTable" data-phone-table @click="togglePhoneTable(), (layoutOpen = false)">
            <AppIcon fallback="ph:table" class="text-ink-soft" /> Show as table on this phone
            <AppIcon v-if="phoneTable" fallback="ph:check" class="ml-auto text-accent" />
          </button>
        </template>
        <template v-if="hasQuickActions && (view.layout === 'list' || view.layout === 'table')">
          <div class="my-1 border-t border-line" />
          <button
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover"
            :aria-pressed="quickActionsOn"
            :title="view.layout === 'table' ? 'A column with the quick actions (Columns moves it)' : 'The quick actions on each row'"
            data-view-quick-actions
            @click="toggleQuickActions"
          >
            <AppIcon fallback="ph:lightning" class="text-ink-soft" /> Quick actions
            <AppIcon v-if="quickActionsOn" fallback="ph:check" class="ml-auto text-accent" />
          </button>
        </template>
      </PopoverMenu>
    </div>
    <div v-if="isPhone && taskWorkflows && mineOn" class="mt-3 flex flex-wrap gap-2">
      <button class="flex min-h-11 items-center gap-2 rounded-lg bg-hover px-3 text-sm text-ink-soft" aria-label="Remove Mine filter" data-review-mine @click="toggleMine">Mine <AppIcon fallback="ph:x" :size="12" /></button>
    </div>
    <div v-if="!loading && taskWorkflows" class="border-b border-line py-3 text-xs text-ink-soft" aria-live="polite" data-review-scope>
      <template v-if="review"><p class="break-words">Paused review: <span class="font-medium text-ink">{{ pausedScope }}</span></p><p class="mt-1 tabular-nums">{{ sessionAt }}</p></template>
      <template v-else><p class="break-words">Review scope: <span class="font-medium text-ink">{{ primaryScopeLabel }}</span></p><p class="mt-1" data-review-counts>{{ toReview ? `${primaryQueues.triage.length} new · ${primaryQueues.review.length} ${primaryQueues.review.length === 1 ? 'check-in' : 'check-ins'}` : `Nothing to review in ${primaryScope === 'view' ? viewScope : workspace.space?.name}.` }}</p></template>
    </div>
    <WorkflowChooser v-model:open="workflowOpen" :type="type" :anchor="workflowAnchor" :mode="workflowMode" :space-name="workspace.space?.name ?? ''" :view-scope="viewScope"
      :new-count="chooserQueues.triage.length" :check-in-count="chooserQueues.review.length" :space-count="spaceToReview" :view-count="processList.length" :view-all-count="openList.length" :session="review"
      @start="startProcess" @resume="resumeReview" @end="discardReview" />

    <p v-if="loading" class="py-10 text-sm text-ink-faint">Loading…</p>
    <div v-else-if="!objects.length" class="py-16 text-center text-sm text-ink-faint">
      No {{ type.pluralName.toLowerCase() }} yet.<template v-if="type.system === 'habit'"> Make one with New {{ type.name }}, then check it off each day from Today.</template
      ><template v-else> Make one with New {{ type.name }}, or press {{ keysOf('search') }} and type “/{{ type.name }}” and a title.</template>
      <TipsCard class="mx-auto mt-10 max-w-xl text-left" />
    </div>

    <FlowMetrics v-else-if="metricsActive" :type="type" />
    <HabitProgress v-else-if="progressActive" :type="type" :habits="objects" :filter="filterText" @menu="objectMenu" />
    <TagTree v-else-if="fixedActive && type.system === 'tag'" :tags="objects" :filter="filterText" @menu="objectMenu" />
    <HabitBoard v-else-if="fixedActive && type.system === 'habit'" :type="type" :habits="objects" :filter="filterText" @menu="objectMenu" />
    <p v-else-if="!visible.length && !agendaActive" class="py-16 text-center text-sm text-ink-faint">No {{ type.pluralName.toLowerCase() }} match the filter.</p>
    <ObjectCollection
      v-else
      ref="collection"
      class="mt-6 max-md:mt-3"
      :objects="visible"
      :layout="view.layout"
      :group-field="groupField"
      :type-ids="[id]"
      :table="view.table"
      :board="view.board"
      :list="view.list"
      :manual="manual"
      :agenda="view.agenda"
      :filter="viewFilter"
      :open-in="view.openIn"
      :quick-actions="view.quickActions"
      :phone-table="phoneTable"
      :flat="view.flat"
      @table="updateView({ table: $event })"
      @board="updateView({ board: $event })"
      @manual="updateView({ sort: undefined })"
      @menu="objectMenu"
      @trashed="(ids) => (objects = objects.filter((o) => !ids.includes(o.id)))"
      @moved="moved"
      @created="created"
    />
    <ProcessMode
      v-if="processOpen && review && !loading"
      v-model:session="review"
      :type="type"
      :objects="objects"
      :fields="processFields"
      :save="async (id, values) => moved(await setProperties(id, values))"
      :undone="undoneInReview"
      @update:session="writeSession"
      @close="closeReview"
      @end="endReview"
      @open="openFromReview"
    />
    <QuickAdd v-if="quickAdd" :type="type" :initial="quickFill" @close="quickAdd = false" />
  </div>
  <div v-else class="grid h-full place-items-center text-sm text-ink-soft">Type not found.</div>
</template>
