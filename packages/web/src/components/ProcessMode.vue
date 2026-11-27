<script setup lang="ts">
// One focused session: Review tasks (new tasks first, then those due for a check-in), or a review
// of one view. Everything about the task is on screen (its text in full, steps, the plan's fields,
// editable in place) and so are its choices (ReviewDecisionBar: what is offered is
// lib/review-choices.ts): few and never the status it already has; a task already placed has Keep
// in that status (reviewed today, back in `review.every` days or once its date has passed, whichever is later). A task has Schedule… (its question
// offers Today first, then Tomorrow, Next week, any day, No date and Someday; Today is what the old
// Today button did, key T inside the question; a new task lands in the first open status, not
// Scheduled), Waiting… (a question of its own: the day to check back and a comment, which starts as
// what is in the comment box), Done, Drop and Snooze (hides it for `review.snooze` days, nothing
// else changes); where Snooze is offered it replaces Decide later, which then is only the way on
// past a task already decided here. Neither records a review. The plan is one plain line of the
// fields that have a value under the title (the status first, "Waiting · due Dec 15 · High"); pressing
// it opens the chips under it: every field with a value, an empty one a dashed "+ Name" that opens its
// editor (the next step only when it has one: it stays editable on the task's page). A task's newest
// comment shows under it, a small date line (and who wrote it when not you) over its text, with no box;
// under the task's text is a one-line comment box, an underline (key C, Escape leaves it). What is typed there is added as a comment in the same save as
// whatever decision is pressed (one Undo takes both back; Enter on a check-in is Keep as planned with
// it, on a new task it saves the comment alone and stays), and leaving the card without deciding
// (Decide later, Back, Pause) saves it alone, so typed text is never lost. On a big screen the review
// fills the window, the same size for every task: a header (the next task's button, which opens the
// list of the session's tasks and jumps to any of them, then Pause), one column of 37.5rem with the task
// scrolling in it and the choices pinned under it in a row (ReviewDecisionBar); on a phone it is
// the whole screen, the same button on a line of its own and the choices a tray at the bottom.
// The queue is stable, with Undo, explicit save, and the reading position kept across interruptions.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DateValue, Doc, ObjectSummary, ObjectType, PropertyDef, PropertyValue, QuickActionDef, SelectOption } from '@vasta/core'
import { STATUS_PROPERTY_ID, askOf, checkBackFieldOf, commentProp, commentsOf, docToPlainText, isClosedTask, lastReviewedDay, needsTriage, nextStepFieldOf, parentFieldOf, quickActionDoneName, reviewEveryOf, settlesTriage, snoozeDaysOf, SNOOZE_ACTION_ID, SNOOZED_PROPERTY_ID, taskDatesOf, waitingAction, withReviewed, withSnoozeCleared, type ReviewAlternative } from '@vasta/core'
import { addSelectOption, dayKey } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton, mainButton, quietButton } from '../lib/buttons.ts'
import type { ListField } from '../lib/columns.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle, formatDateShort, formatDayShort } from '../lib/format.ts'
import { contextMenu } from '../lib/overlays.ts'
import { viewerTimeZone } from '../lib/calendar.ts'
import { optionLabel } from '../lib/i18n.ts'
import { meId, personName } from '../lib/people.ts'
import { quickAsk, runQuickAction, type QuickSave } from '../lib/quick-actions.ts'
import { reviewDecisions } from '../lib/review-choices.ts'
import { savingWithComment } from '../lib/review-comment.ts'
import { currentId, isFinished, jumpTo, moveBy, outcomeWords, recordOutcome, skipCurrent, skippedSession, summarize, undoOutcome, workflowTitle, type ReviewSession } from '../lib/review-session.ts'
import { lastError, summaryOf, ui } from '../lib/state.ts'
import { addSubtask, subtasksOf } from '../lib/subtasks.ts'
import { cardRelease, DECIDE, tracker } from '../lib/swipe.ts'
import { closesOnBack } from '../lib/back.ts'
import { isPhone, keyboardInset } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import DocPreview from './DocPreview.ts'
import { bodyText, metaText, sheetTitle } from '../lib/type-scale.ts'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'
import ReviewDecisionBar from './ReviewDecisionBar.vue'
import ReviewTaskList from './ReviewTaskList.vue'
import WaitingAsk from './WaitingAsk.vue'

/** `undone`: Undo of a decision, which may come from the notice after the review has closed. */
const props = defineProps<{ type: ObjectType; objects: ObjectSummary[]; fields: ListField[]; session: ReviewSession; save: QuickSave; undone: (id: string, name: string) => void }>()
const emit = defineEmits<{
  'update:session': [session: ReviewSession]
  /** Closed for now: the session stays, to resume. */
  close: []
  /** Finished with: the session is forgotten. */
  end: []
  /** Open an object's page; coming back returns here. */
  open: [id: string]
}>()

// The latest session, also between an action's start and its end (the prop follows a tick later).
let latest = props.session
watch(() => props.session, (session) => (latest = session))
function update(change: (session: ReviewSession) => ReviewSession) {
  latest = change(latest)
  emit('update:session', latest)
}

// Gone (closed, ended): an action or Undo still under way no longer moves this review.
let alive = true
onBeforeUnmount(() => (alive = false))

const byId = computed(() => new Map(props.objects.map((o) => [o.id, o])))
const total = computed(() => props.session.ids.length)
const index = computed(() => props.session.index)
const done = computed(() => isFinished(props.session))
const currentObjectId = computed(() => currentId(props.session))
const current = computed(() => (currentObjectId.value ? byId.value.get(currentObjectId.value) : undefined))
/** The object at this place is gone (deleted since the review started). */
const missing = computed(() => !done.value && !current.value)
const outcome = computed(() => (currentObjectId.value ? props.session.outcomes[currentObjectId.value] : undefined))
const title = computed(() => workflowTitle(props.session))
const noun = computed(() => props.type.name.toLowerCase())

/** This one is new (no status, or an incoming one): it needs a place, so there is no Keep. */
const isNew = computed(() => props.session.kind === 'tasks' && !!current.value && needsTriage(props.type, current.value))

// Where it is: a Review tasks session counts its new tasks and its check-ins apart.
const newCount = computed(() => props.session.kind === 'tasks' ? Math.min(props.session.newCount ?? 0, total.value) : 0)
const parts = computed(() => {
  if (props.session.kind !== 'tasks') return [{ label: '', size: total.value, at: Math.min(index.value, total.value) }]
  return [
    { label: 'New', size: newCount.value, at: Math.min(index.value, newCount.value) },
    { label: 'Check-ins', size: total.value - newCount.value, at: Math.max(0, Math.min(index.value, total.value) - newCount.value) },
  ].filter((p) => p.size)
})
const position = computed(() => {
  if (done.value) return `${total.value} of ${total.value}`
  if (props.session.kind !== 'tasks') return `${index.value + 1} of ${total.value}`
  return index.value < newCount.value ? `New ${index.value + 1} of ${newCount.value}` : `Check-in ${index.value - newCount.value + 1} of ${total.value - newCount.value}`
})

// The choices (lib/review-choices.ts), which the plan beside the task shapes: it edits the next step itself.
const nextStepField = computed(() => nextStepFieldOf(props.type))
const planned = computed(() => {
  const field = taskDatesOf(props.type).plan
  return !!field && current.value?.props[field.id]?.kind === 'date'
})
const choices = computed(() => reviewDecisions(props.type, current.value, { isNew: isNew.value, planFieldIds: plan.value.map((d) => d.id), planned: planned.value }))
const every = computed(() => reviewEveryOf(props.type))
const snoozeDays = computed(() => snoozeDaysOf(props.type))

// What it is: new or a check-in, when it was last reviewed or added, as plain text.
const dayText = (iso: string) => formatDayShort(dayKey(new Date(iso)))
const meta = computed(() => {
  const object = current.value
  if (!object) return { kind: '', detail: '' }
  const added = `added ${dayText(object.createdAt)}`
  if (isNew.value) return { kind: 'New', detail: added }
  if (props.session.scope === 'view' && props.session.kind !== 'tasks') return { kind: '', detail: added }
  const last = lastReviewedDay(props.type, object)
  return { kind: 'Check-in', detail: last ? `reviewed ${formatDayShort(last)}` : 'never reviewed' }
})

// The plan now: a task's status, dates, priority, project, next step and assignee (each editable but
// the status, which the choices set); another type's fields from the view.
const PLAN = ['priority', 'project', 'assignee']
const plan = computed<PropertyDef[]>(() => {
  if (props.type.system !== 'task') return props.fields.map((f) => f.def).filter((d): d is PropertyDef => !!d && d.kind !== 'rich-text').slice(0, 6)
  const dates = taskDatesOf(props.type)
  // Check back (Waiting…'s day) is part of it once it has a day, right after the status.
  const checkBack = checkBackFieldOf(props.type)?.id
  const ids = [...new Set([STATUS_PROPERTY_ID, ...(checkBack ? [checkBack] : []), ...(dates.deadline ? [dates.deadline.id] : []), ...(dates.plan ? [dates.plan.id] : []), ...PLAN, ...(nextStepField.value ? [nextStepField.value.id] : [])])]
  return ids.flatMap((id) => props.type.properties.find((p) => p.id === id && p.kind !== 'rich-text') ?? [])
    .filter((d) => (d.id !== 'assignee' && d.id !== checkBack) || current.value?.props[d.id])
})
const editable = (def: PropertyDef) => def.kind !== 'formula' && !(def.id === STATUS_PROPERTY_ID && choices.value.hasButtons)
const filled = (def: PropertyDef) => !!current.value?.props[def.id]
/** The chips: every field with a value, and the empty ones that can be set here, but the next step, which shows only when it has one. Schedule… sets the plan date, so empty it has no chip of its own. */
const chips = computed(() => {
  const planDate = taskDatesOf(props.type).plan?.id
  const dated = choices.value.main.some((b) => b.role === 'defer')
  return plan.value.filter((def) => filled(def) || (editable(def) && !(dated && def.id === planDate) && def.id !== nextStepField.value?.id))
})
/** The plan as one line: the fields with a value, the status first, in words ("check back Dec 1", "High"). */
const factsOpen = ref(false)
watch(currentObjectId, () => (factsOpen.value = false))
function factText(def: PropertyDef, value: PropertyValue | undefined): string {
  if (!value) return ''
  switch (value.kind) {
    case 'select': return def.kind === 'select' ? value.value.map((id) => { const option = def.options.find((o) => o.id === id); return option ? optionLabel(def.id, option) : '' }).filter(Boolean).join(', ') : ''
    case 'date': return `${def.name.toLowerCase()} ${dateWords(value.value)}`
    case 'person': return value.value.map((id) => personName(id)).join(', ')
    case 'relation': return value.value.map((id) => displayTitle(summaryOf(id), undefined)).join(', ')
    case 'checkbox': return value.value ? def.name : ''
    // A bare line of text or number says nothing without its field's name.
    default: return def.kind === 'text' || def.kind === 'number' ? `${def.name.toLowerCase()}: ${value.value}` : String(value.value)
  }
}
/** A date in the facts line and the task list: "Dec 1" (with the year when not this one); a timed one keeps its time. */
const dateWords = (value: DateValue) => (value.resolution === 'day' && !value.end ? formatDayShort(value.start.slice(0, 10)) : formatDateShort(value))
const facts = computed(() => plan.value.filter((def) => def.kind !== 'formula').map((def) => ({ def, text: factText(def, current.value?.props[def.id]) })).filter((f) => f.text))
const chipHint = (def: PropertyDef) => (def.kind === 'relation' ? def.name : `+ ${def.name}`)
async function setField(def: PropertyDef, value: PropertyValue | undefined) {
  const object = current.value
  if (!object) return
  try {
    await props.save(object.id, { [def.id]: value })
  } catch (error) {
    lastError.value = (error as Error).message
  }
}
async function addOption(def: PropertyDef, option: SelectOption) {
  await addSelectOption(props.type, def.id, option)
}

// All of the object's text (its notes and other rich-text fields, each named but the first): the
// list holds only the start of the notes, so it is loaded, again when the object changes elsewhere.
const texts = ref<{ id: string; field: string; name?: string; doc: Doc }[]>([])
const notes = computed(() => current.value?.preview ?? '')
async function loadText() {
  const id = currentObjectId.value
  if (!id) return (texts.value = [])
  const full = await api.object(id).catch(() => undefined)
  if (!alive || currentObjectId.value !== id) return
  const named = new Map(props.type.properties.filter((p) => p.kind === 'rich-text').map((p) => [p.id, p.name]))
  const filled = full ? Object.entries(full.content).filter(([field, doc]) => named.has(field) && docToPlainText(doc).trim()) : []
  filled.sort(([a], [b]) => [...named.keys()].indexOf(a) - [...named.keys()].indexOf(b))
  texts.value = filled.map(([field, doc]) => ({ id, field, name: named.get(field), doc }))
}
watch(currentObjectId, () => void loadText(), { immediate: true })
const stopChanges = onChange((event) => {
  if (event.kind === 'object' && event.id === currentObjectId.value) void loadText()
})
onBeforeUnmount(stopChanges)
const shownTexts = computed(() => texts.value.filter((t) => t.id === currentObjectId.value))

/** An action that asks for a line of text (the next step) adds to the object rather than settling it: the review stays on it. */
const stays = (action: QuickActionDef) => askOf(props.type, action)?.def.kind === 'text' || (isNew.value && !settlesTriage(props.type, action))

// The comment box (a task's review): typed text goes with the decision pressed (act), or is saved
// alone when the card is left without one (leave) or by Enter on a new task.
const draft = ref('')
const commentInput = ref<HTMLInputElement | null>(null)
const commentable = computed(() => props.type.system === 'task' && !!current.value && !!meId())
watch(currentObjectId, () => (draft.value = ''))
/** The newest comment on the task, as the card shows it: its day, and who wrote it unless it is you. */
const latestComment = computed(() => {
  const comment = current.value ? commentsOf(current.value).at(-1) : undefined
  if (!comment) return undefined
  const who = comment.author === meId() ? '' : ` · ${personName(comment.author)}`
  return { text: comment.text, label: `${dayText(comment.at)}${who}` }
})
/** Saves what is in the box as a comment on its own (not a decision); false when it could not be saved. */
async function saveDraft(): Promise<boolean> {
  const object = current.value
  const text = draft.value.trim()
  const me = meId()
  if (!text || !object || !me || !commentable.value) return true
  try {
    const { key, value } = commentProp(me, text, new Date().toISOString())
    await props.save(object.id, { [key]: value })
    draft.value = ''
    return true
  } catch (error) {
    lastError.value = (error as Error).message
    return false
  }
}
/** Leaves the card (Decide later, Back, Pause, Open page) once what was typed is saved as a comment; with nothing typed it goes at once. */
async function leave(go: () => void) {
  if (busy.value || addingStep.value) return
  if (!draft.value.trim()) return go()
  busy.value = true
  const saved = await saveDraft()
  busy.value = false
  if (saved && alive) go()
}
/** Enter in the box: a check-in is kept with the comment; a new task has no Keep, so the comment is saved and the review stays. */
async function submitComment() {
  if (!draft.value.trim() || blocked.value || done.value) return
  if (choices.value.reviewed) return void act(choices.value.reviewed, keepButton())
  busy.value = true
  await saveDraft()
  busy.value = false
}
// Typed text is not lost when the review goes away under it (the view changed).
onBeforeUnmount(() => {
  if (!busy.value) void saveDraft()
})

const busy = ref(false)
const saving = computed(() => busy.value && (!quickAsk.value || quickAsk.value.state.saving))
/** Waiting…'s question, open: the button's action and where it was pressed. */
const waitingFor = ref<{ action: QuickActionDef; anchor: HTMLElement | null } | null>(null)
function answerWaiting(day: string, comment: string) {
  const ask = waitingFor.value
  const object = current.value
  waitingFor.value = null
  if (!ask || !object) return
  void act(waitingAction(props.type, ask.action, object, day, dayKey(), viewerTimeZone()), ask.anchor, comment)
}
/** `comment`: the comment that goes with it instead of the box's (Waiting…'s own, which started as the box's). */
async function act(action: QuickActionDef, anchor: HTMLElement | null, comment?: string) {
  const object = current.value
  if (!object || busy.value || addingStep.value) return
  if (comment === undefined && choices.value.main.some((b) => b.role === 'wait' && b.action === action)) {
    waitingFor.value = { action, anchor }
    return
  }
  // Keep on one already decided here (a next step set): nothing more to save, on to the next.
  if (action.id === 'reviewed' && outcome.value) return move(1)
  rememberCard()
  const at = index.value
  // Snooze is a decision on a new task too, though it places nothing.
  const snoozing = action.id === SNOOZE_ACTION_ID
  const recordsDecision = snoozing || !isNew.value || settlesTriage(props.type, action)
  const stay = !snoozing && stays(action)
  // Schedule's question offers No date and Someday: one picked ends the question and is then run as a decision of its own.
  let picked: ReviewAlternative | undefined
  const alternatives = choices.value.main.find((b) => b.role === 'defer' && b.action === action)?.alternatives?.map((a) => ({ id: a.id, label: a.label, hint: a.hint, icon: a.icon, run: () => { picked = a } }))
  // Today in Schedule's question: the old Today button's action, run once the question has closed.
  let pickedToday: QuickActionDef | undefined
  const todayAction = choices.value.main.find((b) => b.role === 'defer' && b.action === action)?.today
  // The comment goes in the decision's own save, so one Undo takes both back.
  const text = (comment ?? draft.value).trim()
  const me = meId()
  const carried = text && me && commentable.value ? commentProp(me, text, new Date().toISOString()) : undefined
  busy.value = true
  try {
    const saved = await runQuickAction(props.type, object, recordsDecision ? withSnoozeCleared(props.type, withReviewed(props.type, action, object), object) : action, {
      anchor: isPhone.value ? null : anchor,
      save: carried ? savingWithComment(props.save, carried.key, carried.value) : props.save,
      submitLabel: stay ? 'Save' : `Save & next ${noun.value}`,
      ...(alternatives ? { alternatives } : {}),
      ...(todayAction ? { today: () => { pickedToday = todayAction } } : {}),
      onUndo: () => {
        if (recordsDecision) alive ? update((s) => undoOutcome(s, object.id, action.name)) : props.undone(object.id, action.name)
      },
    })
    if (saved && alive) {
      breakingDown.value = false
      if (carried) draft.value = ''
      if (recordsDecision) update((s) => recordOutcome(s, object.id, action.name, at, !stay))
    }
  } finally {
    busy.value = false
  }
  if (picked && alive) await act(picked.action, anchor)
  else if (pickedToday && alive) await act(pickedToday, anchor)
}
function move(delta: number) {
  void leave(() => {
    rememberCard()
    breakingDown.value = false
    update((s) => moveBy(s, delta))
  })
}
/** A task chosen in the list: on to it, with what was typed saved first. */
const listOpen = ref(false)
function jump(id: string) {
  void leave(() => {
    rememberCard()
    breakingDown.value = false
    update((s) => jumpTo(s, id))
  })
}
const titleOf = (id: string) => {
  const object = byId.value.get(id)
  return object ? displayTitle(object, props.type) : `This ${noun.value}`
}
/** What happened to a decided one, for the list: its recorded outcome, in a person's words and with its day. */
function outcomeOf(id: string, name: string): string {
  const object = byId.value.get(id)
  const dayOf = (field: string | undefined) => {
    const value = field ? object?.props[field] : undefined
    return value?.kind === 'date' ? dateWords(value.value) : ''
  }
  const waiting = reviewDecisions(props.type, object, { isNew: false, planFieldIds: [] }).main.find((b) => b.role === 'wait')?.action.name
  return outcomeWords(name, { waiting, until: dayOf(SNOOZED_PROPERTY_ID), planned: dayOf(taskDatesOf(props.type).plan?.id) })
}
function skip() {
  if (done.value) return
  void leave(() => {
    rememberCard()
    breakingDown.value = false
    update(skipCurrent)
  })
}
function open(id = current.value?.id) {
  if (!id) return
  void leave(() => {
    rememberCard()
    emit('open', id)
  })
}
function reviewSkipped() {
  update(skippedSession)
}

// Steps (types with subtasks): listed in full, each opens; Break into steps adds them in place.
const canBreakDown = computed(() => !!parentFieldOf(props.type))
const breakingDown = ref(false)
const stepTitle = ref('')
const stepInput = ref<HTMLInputElement | null>(null)
const addingStep = ref(false)
const steps = computed(() => (current.value && canBreakDown.value ? subtasksOf(props.type, current.value.id) : []))
const stepDate = (step: ObjectSummary) => {
  const dates = taskDatesOf(props.type)
  const value = (dates.plan && step.props[dates.plan.id]) || (dates.deadline && step.props[dates.deadline.id])
  return value?.kind === 'date' ? formatDateShort(value.value) : ''
}
async function startBreakDown() {
  breakingDown.value = true
  await nextTick()
  stepInput.value?.focus()
}
async function addStep() {
  const object = current.value
  if (!object || !stepTitle.value.trim() || addingStep.value) return
  addingStep.value = true
  try {
    await addSubtask(props.type, { ...object, tagIds: object.tagIds }, stepTitle.value)
    stepTitle.value = ''
    stepInput.value?.focus()
  } catch (error) {
    lastError.value = (error as Error).message
  } finally {
    addingStep.value = false
  }
}

// Keep the app behind the session out of the focus order; teleported questions/menus and Undo
// stay usable. Focus returns to the entry when the session closes.
const panel = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
let app: HTMLElement | null = null
let wasInert = false
const blocked = computed(() => busy.value || addingStep.value)
function rememberCard() {
  const id = currentObjectId.value
  if (id && card.value) update((s) => ({ ...s, cards: { ...s.cards, [id]: { scrollTop: card.value!.scrollTop } } }))
}
function pause() {
  if (blocked.value) return
  void leave(() => {
    rememberCard()
    emit('close')
  })
}
// Back on a phone pauses the review here instead of leaving the list under it.
closesOnBack(() => true, pause)
function trapFocus(event: KeyboardEvent) {
  if (!panel.value) return
  const elements = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'), ...document.querySelectorAll<HTMLElement>('[role="status"] button:not(:disabled)')].filter((e) => e.getClientRects().length)
  const at = elements.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && at <= 0) { event.preventDefault(); elements.at(-1)?.focus() }
  else if (!event.shiftKey && (at < 0 || at === elements.length - 1)) { event.preventDefault(); elements[0]?.focus() }
}
watch(currentObjectId, async (id) => {
  await nextTick()
  if (card.value) card.value.scrollTop = id ? props.session.cards?.[id]?.scrollTop ?? 0 : 0
}, { immediate: true })
// Full text arrives after the card; restore a scroll position beyond the short preview then.
watch(shownTexts, async () => {
  await nextTick()
  const id = currentObjectId.value
  if (card.value && id && props.session.cards?.[id]) card.value.scrollTop = props.session.cards[id]!.scrollTop
})
const keepButton = () => panel.value?.querySelector<HTMLElement>('[data-process-reviewed]') ?? null
watch(() => !!quickAsk.value || !!waitingFor.value || listOpen.value || contextMenu.open, async (overlay) => {
  if (overlay) return
  await nextTick()
  if (document.activeElement === document.body) (keepButton() ?? panel.value)?.focus({ preventScroll: true })
})
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  app = document.getElementById('app')
  if (app) { wasInert = app.inert; app.inert = true }
  panel.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  if (app) app.inert = wasInert
  void nextTick(() => {
    const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-process-resume], [data-workflows], main header button[title="More"]')
    target?.focus({ preventScroll: true })
  })
})

// Keys, while no question or text box has them: K (or R) keeps, C writes a comment, letters and 1–9 choose (keys), →
// later, ← back, Enter opens the page, Escape leaves a text box, else pauses.
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || quickAsk.value || waitingFor.value || listOpen.value || contextMenu.open || event.metaKey || event.ctrlKey || event.altKey) return
  if ((event.target as Element | null)?.closest('[data-overlay]')) return
  const typing = (event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')
  if (event.key === 'Escape') {
    event.preventDefault()
    if (typing && breakingDown.value) breakingDown.value = false
    else if (typing) (typing as HTMLElement).blur()
    else pause()
    return
  }
  if (event.key === 'Tab') { trapFocus(event); return }
  if (typing) return
  // Enter/Space on a button belongs to that button, not to the session shortcuts.
  if ((event.target as Element | null)?.closest('button, a') && (event.key === 'Enter' || event.key === ' ')) return
  if (/^[cC]$/.test(event.key) && commentable.value && !done.value) {
    event.preventDefault()
    commentInput.value?.focus()
    return
  }
  if (/^[kKrR]$/.test(event.key) && choices.value.reviewed && !done.value) {
    event.preventDefault()
    void act(choices.value.reviewed, keepButton())
    return
  }
  const button = choices.value.keys.get(event.key.toLowerCase())
  if (button && !done.value) {
    event.preventDefault()
    void act(button.action, panel.value?.querySelector<HTMLElement>(`[data-key="${choices.value.keyOf(button)}"]`) ?? null)
  } else if (event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault()
    skip()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter' && !done.value) {
    event.preventDefault()
    open()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// A phone: swipe the card (right: Schedule, left: Snooze, else later), dragged a quarter of the screen or flicked
// (lib/swipe.ts). As in SwipeRow the direction is decided after 10px and kept: a mostly vertical
// move scrolls, and a scroll that drifts sideways does not swipe.
let touch: { x: number; y: number; direction?: 'x' | 'y' } | undefined
const shift = ref(0)
const springing = ref(false)
const speed = tracker()
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function onTouchStart(event: TouchEvent) {
  const t = event.touches[0]
  shift.value = 0
  springing.value = false
  if (blocked.value || (event.target as Element | null)?.closest('button, a, input, textarea, [contenteditable]')) { touch = undefined; return }
  touch = t && event.touches.length === 1 && t.clientX > 24 ? { x: t.clientX, y: t.clientY } : undefined
  speed.reset()
  if (touch) speed.add(touch.x)
}
function onTouchMove(event: TouchEvent) {
  const t = event.touches[0]
  if (!touch || !t) return
  const dx = t.clientX - touch.x
  const dy = t.clientY - touch.y
  if (!touch.direction) {
    if (Math.abs(dy) > DECIDE && Math.abs(dy) >= Math.abs(dx)) touch.direction = 'y'
    else if (Math.abs(dx) > DECIDE) touch.direction = 'x'
    else return
  }
  if (touch.direction === 'x') {
    shift.value = dx
    speed.add(t.clientX)
  }
}
/** The browser took the touch (a scroll, a system gesture): no swipe. */
function onTouchCancel() {
  shift.value = 0
  touch = undefined
}
function onTouchEnd() {
  const dx = touch?.direction === 'x' ? shift.value : 0
  const end = cardRelease(dx, speed.velocity(), window.innerWidth)
  // A card that stays springs back; one that goes is replaced by the next.
  springing.value = end === 0 && dx !== 0 && !reducedMotion
  shift.value = 0
  touch = undefined
  if (end > 0 && choices.value.defer) void act(choices.value.defer, null)
  else if (end < 0) { if (choices.value.snooze) void act(choices.value.snooze, null); else skip() }
}

// The buttons are at the bottom, where notices show: the notice (Undo) sits just above them instead.
const bar = ref<InstanceType<typeof ReviewDecisionBar> | null>(null)
const buttonBlock = computed(() => (bar.value?.$el as HTMLElement | undefined) ?? null)
let blockSize: ResizeObserver | undefined
function liftNotices() {
  ui.noticeLift = buttonBlock.value ? Math.max(0, Math.round(window.innerHeight - buttonBlock.value.getBoundingClientRect().top)) : 0
}
watch([buttonBlock, isPhone], ([block]) => {
  blockSize?.disconnect()
  if (block && typeof ResizeObserver !== 'undefined') (blockSize = new ResizeObserver(liftNotices)).observe(block)
  liftNotices()
})
onBeforeUnmount(() => {
  blockSize?.disconnect()
  ui.noticeLift = 0
})

const summary = computed(() => summarize(props.session))
const wide = computed(() => !isPhone.value)
const sectionName = `font-semibold text-ink-faint ${metaText}`
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 bg-surface" :class="isPhone ? 'pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : ''" :style="isPhone && keyboardInset ? { bottom: `${keyboardInset}px` } : undefined" data-process-mode>
      <section
        ref="panel"
        tabindex="-1"
        aria-modal="true"
        class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface outline-none"
        role="dialog"
        :aria-label="title"
        :aria-busy="saving || undefined"
      >
        <!-- Which review, the next task's button (the place and the list), and Pause; then the progress. -->
        <header class="shrink-0 px-4 pt-3 md:px-6">
          <div class="flex items-start gap-2">
            <button v-if="isPhone && !done" class="-ml-2 grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-hover disabled:opacity-40" :disabled="index === 0 || blocked" aria-label="Back to the previous task" data-process-back @click="move(-1)"><AppIcon fallback="ph:caret-left" :size="18" /></button>
            <h2 class="min-h-9 shrink-0 py-1.5 font-semibold max-md:min-h-11 max-md:py-2.5" data-process-heading>Review</h2>
            <span class="min-w-0 flex-1" />
            <span class="sr-only" aria-live="polite" data-process-position>{{ saving ? 'Saving…' : position }}</span>
            <ReviewTaskList v-if="wide && !done" v-model:open="listOpen" :session="session" :title-of="titleOf" :outcome-of="outcomeOf" :blocked="blocked" @jump="jump" />
            <button class="-mr-2 min-h-9 shrink-0 rounded-lg px-3 text-ink-soft hover:bg-hover disabled:opacity-50 max-md:min-h-11" :class="bodyText" :disabled="blocked" :aria-label="`Pause ${title.toLowerCase()} (resume later)`" data-process-close @click="pause">{{ done ? 'Close' : 'Pause' }}</button>
          </div>
          <div v-if="!wide && !done" class="-mx-2"><ReviewTaskList v-model:open="listOpen" :session="session" :title-of="titleOf" :outcome-of="outcomeOf" :blocked="blocked" @jump="jump" /></div>
          <div class="mt-2 flex items-center gap-1.5" aria-hidden="true">
            <span v-for="part in parts" :key="part.label" class="h-1 min-w-6 rounded-full bg-line" :style="{ flexGrow: part.size }"><span class="block h-full rounded-full bg-ink-soft transition-[width] duration-200" :style="{ width: `${part.size ? (part.at / part.size) * 100 : 0}%` }" /></span>
          </div>
        </header>

        <!-- The end: what was decided, and what was left. -->
        <div v-if="done" class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-5 py-8 text-center" data-process-end>
          <AppIcon fallback="ph:check-circle" :size="32" class="text-[var(--color-flow-done)]" />
          <p class="text-lg font-semibold">{{ title }}: finished</p>
          <p class="text-ink-soft" :class="bodyText" data-process-summary>
            <template v-if="summary.outcomes.length || summary.skipped">
              {{ [...summary.outcomes.map((o) => `${quickActionDoneName(o.name)} ${o.count}`), ...(summary.skipped ? [`${summary.skipped} left for later`] : [])].join(' · ') }}
            </template>
            <template v-else>Nothing changed</template>
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <button :class="greyButton" data-process-back @click="move(-1)">Back</button>
            <button v-if="summary.skipped" :class="greyButton" data-process-review-skipped @click="reviewSkipped">Review {{ summary.skipped }} left for later</button>
            <button :class="mainButton" data-process-finish @click="emit('end')">Back to {{ session.viewName }}</button>
          </div>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col">
          <!-- The task: what it is, the plan, its text in full, its steps. -->
          <div
            ref="card"
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 md:px-6 md:pt-8"
            :class="[springing ? 'transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]' : '', wide ? '[scrollbar-gutter:stable_both-edges]' : '']"
            :style="shift ? { transform: `translateX(${shift}px)`, opacity: String(1 - Math.min(Math.abs(shift) / 400, 0.5)) } : undefined"
            data-process-card
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
          >
            <div class="mx-auto w-full max-w-[37.5rem]">
              <p v-if="missing" class="text-ink-soft" :class="bodyText" data-process-missing>This {{ noun }} is no longer here (deleted or moved since the review started). Choose Next to go on.</p>
              <template v-else-if="current">
                <p class="text-ink-soft" :class="bodyText" data-process-meta>{{ [meta.kind, meta.detail].filter(Boolean).join(' · ') }}</p>
                <h2 class="mt-2 break-words" :class="sheetTitle" data-process-title>{{ displayTitle(current, type) }}</h2>
                <p v-if="outcome" class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-hover px-2 py-0.5 text-ink-soft" :class="metaText" data-process-outcome>
                  <AppIcon fallback="ph:check" :size="12" />{{ quickActionDoneName(outcome) }}
                </p>

                <!-- The plan: the fields with a value as one line; pressing it opens the chips (an empty one reads "+ Name"). -->
                <button type="button" class="-mx-1.5 mt-3 flex min-h-9 w-fit max-w-[calc(100%+0.75rem)] flex-wrap items-center gap-x-1.5 rounded-md px-1.5 py-1 text-left text-ink-soft hover:bg-hover max-md:min-h-11" :class="bodyText" :aria-expanded="factsOpen" :aria-label="['Edit fields', ...facts.map((f) => f.text)].join(' · ')" data-process-facts @click="factsOpen = !factsOpen">
                  <template v-if="facts.length">
                    <template v-for="(fact, i) in facts" :key="fact.def.id">
                      <span v-if="i" aria-hidden="true">·</span>
                      <span :class="i === 0 && fact.def.id === STATUS_PROPERTY_ID ? 'font-medium text-ink' : ''">{{ fact.text }}</span>
                    </template>
                  </template>
                  <span v-else class="text-ink-faint">Add details</span>
                </button>
                <div v-if="factsOpen && chips.length" class="mt-2 flex flex-wrap items-center gap-1.5" data-process-plan>
                  <div
                    v-for="def in chips"
                    :key="def.id"
                    class="flex min-h-11 min-w-0 max-w-full items-center rounded-lg border md:min-h-9"
                    :class="[filled(def) ? 'border-line pl-2.5' : 'border-dashed border-line-strong', def.kind === 'text' ? 'grow basis-56' : '', bodyText]"
                    :data-process-field="def.id"
                  >
                    <p class="shrink-0 text-ink-soft" :class="[metaText, filled(def) ? '' : 'sr-only']">{{ def.name }}</p>
                    <PropertyValueEditor v-if="editable(def)" :def="def" :value="current.props[def.id]" :placeholder="chipHint(def)" class="max-md:[&_button]:min-h-10" @update="setField(def, $event)" @add-option="addOption(def, $event)" />
                    <div v-else class="flex min-h-8 min-w-0 items-center px-2"><PropertyDisplay :def="def" :value="current.props[def.id]" :object="current" short /></div>
                  </div>
                </div>

                <!-- The newest comment, so the task's latest word is in front of the decision: a date line over its text. -->
                <div v-if="latestComment" class="mt-4" data-process-latest-comment>
                  <p class="text-ink-faint" :class="metaText" data-process-latest-label>{{ latestComment.label }}</p>
                  <p class="mt-0.5 line-clamp-3 whitespace-pre-line break-words" :class="bodyText" data-process-latest-text>{{ latestComment.text }}</p>
                </div>

                <div v-if="shownTexts.length" class="mt-5 space-y-5" data-process-text>
                  <section v-for="text in shownTexts" :key="text.field">
                    <h3 :class="sectionName">{{ text.name }}</h3>
                    <div class="vasta-doc mt-1 text-base leading-relaxed [&_p+p]:mt-2.5"><DocPreview :content="text.doc.content" /></div>
                  </section>
                </div>
                <p v-else-if="notes" class="mt-5 whitespace-pre-line text-base leading-relaxed">{{ notes }}</p>

                <!-- One line, an underline; text typed here goes with the decision (or is kept when the card is left). -->
                <input v-if="commentable" ref="commentInput" v-model="draft" type="text" enterkeyhint="done" class="mt-5 w-full border-0 border-b border-line bg-transparent px-0 py-2 outline-none placeholder:text-ink-faint focus:border-ink-soft max-md:text-base" :class="bodyText" placeholder="Add a comment…" aria-label="Add a comment" :disabled="blocked" data-process-comment @keydown.enter.prevent="submitComment" />

                <section v-if="steps.length || breakingDown" class="mt-6" data-process-steps>
                  <h3 :class="sectionName">Steps · {{ steps.length }}</h3>
                  <ul class="mt-1">
                    <li v-for="step in steps" :key="step.id" class="border-b border-line">
                      <button class="flex min-h-11 w-full items-center gap-2.5 text-left hover:text-accent" :class="bodyText" :disabled="blocked" @click="open(step.id)">
                        <AppIcon :fallback="isClosedTask(type, step) ? 'ph:check-circle' : 'ph:circle'" :size="16" class="shrink-0" :class="isClosedTask(type, step) ? 'text-[var(--color-flow-done)]' : 'text-ink-faint'" />
                        <span class="min-w-0 flex-1 break-words" :class="isClosedTask(type, step) ? 'text-ink-faint line-through' : ''">{{ displayTitle(step, type) }}</span>
                        <span v-if="stepDate(step)" class="shrink-0 tabular-nums text-ink-soft" :class="metaText">{{ stepDate(step) }}</span>
                      </button>
                    </li>
                  </ul>
                </section>
                <form v-if="breakingDown" class="mt-3 space-y-2" @submit.prevent="addStep">
                  <div class="flex items-center gap-2 rounded-lg border border-line px-2.5">
                    <AppIcon fallback="ph:plus" :size="16" class="text-ink-faint" />
                    <input ref="stepInput" v-model="stepTitle" class="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-ink-faint max-md:text-base" :class="bodyText" placeholder="A step" aria-label="New step" data-process-step />
                  </div>
                  <div class="flex justify-end gap-2">
                    <button type="button" :class="greyButton" data-process-step-done @click="breakingDown = false">Done adding</button>
                    <button type="submit" :class="mainButton" :disabled="!stepTitle.trim() || addingStep" data-process-step-add>{{ addingStep ? 'Adding…' : 'Add step' }}</button>
                  </div>
                </form>

                <div class="-ml-3 mt-4 flex flex-wrap gap-x-2">
                  <button :class="quietButton" :disabled="blocked" data-process-open @click="open()">Open page</button>
                  <button v-if="canBreakDown && !breakingDown" :class="quietButton" :disabled="blocked" data-process-break @click="startBreakDown"><AppIcon fallback="ph:tree-structure" :size="16" />Break into steps</button>
                </div>
              </template>
            </div>
          </div>

          <ReviewDecisionBar ref="bar" :type="type" :choices="choices" :active="!!current" :blocked="blocked" :outcome="outcome" :noun="noun" :every="every" :snooze-days="snoozeDays" :wide="wide" @act="act" @skip="skip" />
        </div>
      </section>
    </div>
    <WaitingAsk v-if="waitingFor" :anchor="waitingFor.anchor" :scope="current ? displayTitle(current, type) : undefined" :comment="draft" @submit="answerWaiting" @close="waitingFor = null" />
  </Teleport>
</template>
