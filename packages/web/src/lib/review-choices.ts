// What a review offers for the object at hand (ProcessMode, ReviewDecisionBar): a task type's
// review buttons and links (core reviewButtons), then any other quick actions of its own as links;
// another type's view review has its quick actions as the buttons. Keep (Reviewed) is for one that
// already has a place. Keys: K (or R) keeps; Today, Defer, Done and Drop are T, F, D and X whatever
// the statuses are called; any other main button takes its initial when that is still free; links 1-9.
import { askOf, deferActionOf, nextStepFieldOf, quickActionsOf, reviewButtons, reviewedAction, statusProperty, type ReviewButton } from '@vasta/core'
import type { ObjectSummary, ObjectType, QuickActionDef, SelectOption } from '@vasta/core'

const ROLE_KEYS: Partial<Record<ReviewButton['role'], string>> = { today: 't', defer: 'f', done: 'd', drop: 'x' }
/** Taken by Keep and by the four roles. */
const RESERVED = 'krtfdx'

export function reviewDecisions(type: ObjectType, object: ObjectSummary | undefined, o: { isNew: boolean; planFieldIds: readonly string[] }) {
  const status = statusProperty(type)
  const value = status && object ? object.props[status.id] : undefined
  const statusId = value?.kind === 'select' ? value.value[0] : undefined
  const currentStatus: SelectOption | undefined = statusId ? status?.options.find((x) => x.id === statusId) : undefined
  const buttons = reviewButtons(type, currentStatus?.id, o.isNew)
  const covered = new Set(buttons.covered)
  const nextStepId = nextStepFieldOf(type)?.id
  // Other quick actions of the type, unless the plan beside the task already edits what one asks for (the next step).
  const extras = quickActionsOf(type).filter((a) => !covered.has(a.id) && !(askOf(type, a)?.def.id === nextStepId && o.planFieldIds.includes(nextStepId!)))
  const asButton = (action: QuickActionDef): ReviewButton => ({ role: 'move', label: action.name, action })
  const main = buttons.main.length ? buttons.main : extras.map(asButton)
  const links = buttons.main.length ? [...buttons.more, ...extras.map(asButton)] : []
  const keys = new Map<string, ReviewButton>()
  for (const button of main) {
    const key = ROLE_KEYS[button.role]
    if (key && !keys.has(key)) keys.set(key, button)
  }
  for (const button of main) {
    const key = button.label.trim()[0]?.toLowerCase()
    if (key && !ROLE_KEYS[button.role] && !RESERVED.includes(key) && !keys.has(key)) keys.set(key, button)
  }
  links.slice(0, 9).forEach((button, i) => keys.set(String(i + 1), button))
  return {
    currentStatus,
    /** Whether its buttons include the status choices, which then are not edited as a field. */
    hasButtons: buttons.main.length > 0,
    main,
    links,
    /** Keep: Reviewed today; none for a new task or a type without the date. */
    reviewed: o.isNew ? undefined : reviewedAction(type),
    /** What a swipe right does: the review's Defer (a new task's also places it), else the type's. */
    defer: main.find((b) => b.role === 'defer')?.action ?? deferActionOf(type),
    keys,
    keyOf: (button: ReviewButton) => [...keys].find(([, b]) => b === button)?.[0]?.toUpperCase() ?? '',
  }
}

export type ReviewDecisions = ReturnType<typeof reviewDecisions>
