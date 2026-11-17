// Everything a type page does to start, resume and end a review (ProcessMode): which tasks it goes
// through, the button that says where it stands, and the paused session. A review of tasks always
// starts with every new task in the space, then the check-ins of the place it started from (a view,
// or the whole space for "Review all"): core's reviewQueues. A review of any other type goes through
// the view's open objects due for one. One session is kept per type on this device, so a review of
// another type never replaces it; starting another of the same type asks first.
import { dueForReview, isClosedTask, needsTriage, reviewFieldOf, reviewQueues, quickActionsOf } from '@vasta/core'
import type { Id, ObjectSummary, ObjectType } from '@vasta/core'
import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { dayKey } from './actions.ts'
import { openObject } from './open.ts'
import { confirmDialog } from './overlays.ts'
import { readSession, writeSession } from './review-storage.ts'
import { startSession, undoOutcome, workflowTitle, type ReviewKind, type ReviewSession } from './review-session.ts'
import { session as login } from './session.ts'
import { workspace } from './state.ts'

export interface ReviewHost {
  type: ComputedRef<ObjectType | undefined>
  /** Every object of the type. */
  objects: () => ObjectSummary[]
  view: () => { id: string; name: string }
  /** The view's name and what narrows it (Mine, a search), to say what is reviewed. */
  scopeLabel: () => string
  /** The open objects the view shows now (kept completions left out). */
  rows: () => ObjectSummary[]
  /** The page lists this view's objects (not Metrics, Progress or an agenda, which have none). */
  listed: () => boolean
  /** Shows a view of the type (the one a finished review began in). */
  pickView: (id: string) => void
}

export type ReviewControl = ReturnType<typeof useReviewSession>

export function useReviewSession(host: ReviewHost) {
  const type = host.type
  const isTask = computed(() => type.value?.system === 'task')
  const reviewable = computed(() => host.listed() && (quickActionsOf(type.value).length > 0 || !!reviewFieldOf(type.value)))
  const spaceScope = computed(() => `All tasks in ${workspace.space?.name ?? ''}`)
  const sorted = computed(() => [...host.objects()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))

  /** The paused session, and whether it is open. */
  const session = ref<ReviewSession | null>(null)
  const open = ref(false)
  function setSession(next: ReviewSession | null) {
    session.value = next
    writeSession(next, next?.typeId ?? type.value?.id)
  }

  // What each place would go through. A task type: the space's new tasks, then check-ins; another: the view's open objects.
  const openRows = computed(() => host.rows().filter((o) => !isClosedTask(type.value, o)))
  const viewQueues = computed(() => reviewQueues(type.value, host.objects(), openRows.value, dayKey()))
  const spaceQueues = computed(() => reviewQueues(type.value, host.objects(), sorted.value, dayKey()))
  const dueRows = computed(() => openRows.value.filter((o) => dueForReview(type.value, o, dayKey())))
  /** The place the button starts a review from: the view, or the whole space where the page has no list. */
  const primaryScope = computed(() => (reviewable.value ? ('view' as const) : ('space' as const)))
  const primaryLabel = computed(() => (primaryScope.value === 'view' ? host.scopeLabel() : spaceScope.value))
  const queues = (scope: 'space' | 'view') => (scope === 'view' ? viewQueues.value : spaceQueues.value)
  const count = (scope: 'space' | 'view') => queues(scope).incoming.length + queues(scope).checkIns.length
  /** What the button counts: the new tasks of the space and the check-ins of the place it starts from. */
  const toReview = computed(() => count(primaryScope.value))
  const spaceToReview = computed(() => count('space'))

  // The chooser (what a review would hold, and why there may be nothing).
  const chooserOpen = ref(false)
  const chooserMode = ref<'tasks' | 'view'>('tasks')
  const chooserAnchor = ref<HTMLElement | null>(null)
  function choose(mode: 'tasks' | 'view', anchor: HTMLElement | null) {
    chooserMode.value = mode
    chooserAnchor.value = anchor
    chooserOpen.value = true
  }
  const chooser = computed(() => {
    const scope = chooserMode.value === 'view' ? 'view' : 'space'
    return {
      mode: chooserMode.value,
      anchor: chooserAnchor.value,
      newCount: isTask.value ? queues(scope).incoming.length : 0,
      checkInCount: isTask.value ? queues(scope).checkIns.length : 0,
      spaceCount: spaceToReview.value,
      viewCount: dueRows.value.length,
      viewAllCount: openRows.value.length,
      viewScope: host.scopeLabel(),
      spaceName: workspace.space?.name ?? '',
      session: session.value,
    }
  })

  /** Starts a review, after asking when it would replace this type's paused one. `all`: the view's every open task, also those reviewed lately. */
  async function start(kind: ReviewKind, scope: 'space' | 'view', all = false) {
    if (scope === 'space' ? !isTask.value : !reviewable.value) return
    if (!login.user || !workspace.space || !type.value) return
    if (session.value && !(await confirmDialog({ title: 'Start a new session?', message: `This replaces your paused ${workflowTitle(session.value).toLowerCase()} position. Changes to tasks stay saved.`, confirmLabel: 'Start new session' }))) return
    const q = queues(scope)
    const list = kind === 'tasks'
      ? [...q.incoming, ...(all && scope === 'view' ? openRows.value.filter((o) => !needsTriage(type.value, o)) : q.checkIns)]
      : all ? openRows.value : dueRows.value
    if (!list.length || !login.user || !workspace.space) return
    setSession(startSession({
      spaceId: workspace.space.id, typeId: type.value.id, viewId: host.view().id, viewName: host.view().name, kind, scope,
      scopeLabel: scope === 'space' ? spaceScope.value : host.scopeLabel(),
      ...(kind === 'tasks' ? { newCount: q.incoming.length } : {}),
    }, list.map((o) => o.id)))
    chooserOpen.value = false
    open.value = true
  }

  // The button: resumes the paused session, else starts one; with nothing to review it opens the
  // chooser, which says why and offers the whole space.
  const position = computed(() => (session.value ? `${Math.min(session.value.index + 1, session.value.ids.length)} of ${session.value.ids.length}` : ''))
  /** The paused session covers somewhere else than the button would start from (another view, a search, the whole space). */
  const pausedElsewhere = computed(() => !!session.value && (session.value.scope !== primaryScope.value || session.value.scopeLabel !== primaryLabel.value))
  function press(anchor: HTMLElement | null) {
    if (session.value) resume()
    else if (toReview.value) void start('tasks', primaryScope.value)
    else choose(primaryScope.value === 'view' ? 'view' : 'tasks', anchor)
  }
  function reviewSpace(anchor: HTMLElement | null) {
    if (spaceToReview.value) void start('tasks', 'space')
    else choose('tasks', anchor)
  }
  /** "Review this view instead": a review from where the button starts, ending the paused one (asked first). */
  const startInstead = (anchor: HTMLElement | null) => (!isTask.value ? start('review', 'view') : toReview.value ? start('tasks', primaryScope.value) : choose(primaryScope.value === 'view' ? 'view' : 'tasks', anchor))
  function resume() {
    if (!session.value) return
    chooserOpen.value = false
    open.value = true
  }
  function close() {
    open.value = false
    if (session.value && session.value.index >= session.value.ids.length) setSession(null)
  }
  /** Finished with: the session is forgotten and the view it began in shows. */
  function end() {
    const origin = session.value?.viewId
    open.value = false
    setSession(null)
    if (origin && type.value?.views.some((v) => v.id === origin)) host.pickView(origin)
  }
  async function discard() {
    if (await confirmDialog({ title: 'End this session?', message: 'Your task changes stay saved. Only the saved queue and position are cleared.', confirmLabel: 'End session' })) end()
  }
  // Undo of a decision from the notice, also once the review (or this page) has closed: the stored
  // session loses the outcome too, so the end does not count it.
  let mounted = true
  onBeforeUnmount(() => (mounted = false))
  function undone(id: Id, name: string) {
    if (mounted && session.value) return setSession(undoOutcome(session.value, id, name))
    const stored = type.value && readSession(workspace.space?.id, type.value.id)
    if (stored) writeSession(undoOutcome(stored, id, name))
  }
  function openFrom(id: Id) {
    if (session.value) setSession({ ...session.value, openedId: id })
    open.value = false
    void openObject(id)
  }
  // This type's review, if there is one; back from the object opened in it (the history entry this
  // page left for it), the review opens again. Another account's or space's is never shown.
  function load() {
    session.value = type.value ? readSession(workspace.space?.id, type.value.id) : null
    const opened = session.value?.openedId
    if (!opened || !session.value) return
    const forward = (window.history.state as { forward?: unknown } | null)?.forward
    setSession({ ...session.value, openedId: undefined })
    if (typeof forward === 'string' && forward.startsWith(`/o/${opened}`)) open.value = true
  }
  onMounted(load)
  watch([() => type.value?.id, () => workspace.space?.id, () => login.user?.id], () => {
    open.value = false
    load()
  })

  return { isTask, reviewable, session, open, setSession, toReview, spaceToReview, primaryScope, primaryLabel, position, pausedElsewhere, viewCount: computed(() => count('view')), chooserOpen, chooser, choose, start, press, reviewSpace, startInstead, resume, close, end, discard, undone, openFrom }
}
