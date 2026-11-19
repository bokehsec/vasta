// Habits (core's habits.ts): the space's habits, kept fresh, and logging a day: checked on or off,
// or an amount toward a daily goal. A change writes only that day's prop (`done:<day>`), on top of
// the habit as stored. A habit done from food ("From food") has its days worked out from what is
// logged (core's withFood) and is not checked by hand. A habit linked to SparkyFitness is never
// changed by a tap: its marks ask for the amount, and a hand entry can be taken away again.
// Plain habits ask Done / Not done; habits with a daily goal keep exact amount entry.
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import {
  FOOD_HABIT_DAYS,
  addDays,
  habitAmountText,
  habitDayValue,
  habitDoneKey,
  habitFoodRule,
  habitHasHandValue,
  habitSparkyRule,
  habitSyncedText,
  habitTap,
  habitTarget,
  habitUnit,
  habitValue,
  nutritionDays,
  withFood,
  type ColorName,
  type HabitDayState,
  type NutritionDay,
  type ObjectSummary,
  type PropertyValue,
} from '@vasta/core'
import { api } from './api.ts'
import { clone } from './clone.ts'
import { onChange } from './events.ts'
import { dayKey } from './actions.ts'
import { formatLongDay } from './format.ts'
import { dailyNotesBetween, useGoals } from './nutrition.ts'
import { amountDialog, choiceDialog, promptDialog } from './overlays.ts'
import { lastError, notice, primeFromObject, primeSummaries, systemType } from './state.ts'

export const DEFAULT_HABIT_COLOR: ColorName = 'emerald'

export const habitColor = (habit: Pick<ObjectSummary, 'color'> | undefined): ColorName => habit?.color ?? systemType('habit')?.color ?? DEFAULT_HABIT_COLOR

/**
 * Habits with their days from food, for those done from it (the last FOOD_HABIT_DAYS days of
 * daily notes, loaded when one is in the list and again when a daily note changes).
 */
export function useFoodHabits(habits: Ref<ObjectSummary[]>) {
  const today = useToday()
  const days = ref<NutritionDay[]>([])
  const { goals } = useGoals()
  const linked = computed(() => habits.value.some((h) => habitFoodRule(h)))
  const notes = ref<ObjectSummary[]>([])
  async function load() {
    if (!linked.value) return
    const today = dayKey()
    notes.value = [...(await dailyNotesBetween(addDays(today, -FOOD_HABIT_DAYS), today)).values()]
  }
  watch(linked, load, { immediate: true })
  watch([notes, goals, today], () => {
    days.value = linked.value ? nutritionDays(notes.value, goals.value, addDays(today.value, -FOOD_HABIT_DAYS), today.value) : []
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = onChange((event) => {
    if (!linked.value || event.kind !== 'object' || event.typeId !== systemType('daily-note')?.id) return
    clearTimeout(timer)
    timer = setTimeout(load, 300)
  })
  onBeforeUnmount(() => {
    stop()
    clearTimeout(timer)
  })
  return computed(() => (days.value.length ? habits.value.map((h) => withFood(h, days.value, today.value)) : habits.value))
}

/** Today's day key, kept current: checked every minute and when the page comes back into view, so a view left open rolls over at midnight. */
export function useToday() {
  const today = ref(dayKey())
  const refresh = () => {
    const now = dayKey()
    if (now !== today.value) today.value = now
  }
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
  })
  return today
}

/** A habit done from food can't be checked by hand: say so. */
function fromFood(habit: Pick<ObjectSummary, 'props' | 'title'> | undefined): boolean {
  if (!habit || !habitFoodRule(habit)) return false
  const rule = habitFoodRule(habit)!
  notice.value = { message: `“${habit.title || 'This habit'}” is done from what you log in Food.${rule.endsWith('-max') || rule === 'on-target' ? ' Counted once the day is over.' : ''}` }
  return true
}

/** The space's habits, reloaded when one changes anywhere (another page, another device). */
export function useHabits() {
  const habits = ref<ObjectSummary[]>([])
  const loaded = ref(false)
  async function load() {
    const type = systemType('habit')
    if (!type) return
    habits.value = (await api.objectsOfType(type.id)).sort((a, b) => a.title.localeCompare(b.title))
    primeSummaries(habits.value)
    loaded.value = true
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = onChange((event) => {
    if (event.kind !== 'object' || event.typeId !== systemType('habit')?.id) return
    clearTimeout(timer)
    timer = setTimeout(load, 250)
  })
  onBeforeUnmount(() => {
    stop()
    clearTimeout(timer)
  })
  void load()
  return { habits: useFoodHabits(habits), loaded, load }
}

/**
 * Set the amount a habit reached on a day (a plain habit: 1 done, 0 not), or `'synced'`: take the
 * hand entry away so what SparkyFitness gave counts again. `local` (a habit shown on screen)
 * changes at once and goes back if the save fails.
 */
export async function setHabitAmount(habitId: string, day: string, amount: number | 'synced', local?: ObjectSummary) {
  if (fromFood(local)) return
  const key = habitDoneKey(day)
  const apply = (habit: Pick<ObjectSummary, 'props' | 'createdAt'>, value: PropertyValue | undefined) => {
    if (value) habit.props[key] = value
    else delete habit.props[key]
  }
  const next = (habit: Pick<ObjectSummary, 'props' | 'createdAt'>) => (amount === 'synced' ? undefined : habitDayValue(habit, amount))
  const before = local?.props[key]
  if (local) apply(local, next(local))
  try {
    const base = await api.object(habitId)
    const object = clone(base)
    apply(object, next(object))
    primeFromObject(await api.saveObject(object, base))
  } catch (error) {
    if (local) apply(local, before)
    lastError.value = (error as Error).message
  }
}

/** Check a plain habit on or off; a goal habit goes to its goal, or back to nothing. */
export function setHabitDone(habit: ObjectSummary, day: string, done: boolean) {
  return setHabitAmount(habit.id, day, done ? (habitTarget(habit) ?? 1) : 0, habit)
}

/** One click on a habit for a day (core's habitTap): a plain one toggles, a goal one adds 1; one linked to SparkyFitness asks. */
export function stepHabit(habit: ObjectSummary, day: string) {
  if (fromFood(habit)) return
  const tap = habitTap(habit, day)
  return tap === 'ask' ? askHabitAmount(habit, day) : setHabitAmount(habit.id, day, tap.amount, habit)
}

/** Ask for a day's exact amount (right click or long press); for a habit linked to SparkyFitness, with what it gave and a way back to it. */
export async function askHabitAmount(habit: ObjectSummary, day: string) {
  if (fromFood(habit)) return
  const target = habitTarget(habit)
  const unit = habitUnit(habit)
  const date = formatLongDay(`${day}T00:00:00.000Z`)
  const linked = !!habitSparkyRule(habit)
  if (!target && !linked) {
    const answer = await choiceDialog({
      title: habit.title || 'Habit',
      message: `Done on ${date}?`,
      choices: [{ value: 'done', label: 'Done' }, { value: 'not-done', label: 'Not done' }],
    })
    if (answer !== null) await setHabitAmount(habit.id, day, answer === 'done' ? 1 : 0, habit)
    return
  }
  const hand = habitHasHandValue(habit, day)
  const question = target ? `How much on ${date}? The goal is ${target}${unit ? ` ${unit}` : ''}.` : `Done on ${date}? 1 for yes, 0 for no.`
  const synced = `From SparkyFitness: ${habitSyncedText(habit, day) || 'nothing for this day'}.`
  const options = {
    title: habit.title || 'Habit',
    message: linked ? `${synced} ${hand ? 'Your own entry for this day counts instead.' : question}` : question,
    value: linked && !hand ? '' : String(habitValue(habit, day) || ''),
    placeholder: '0',
    confirmLabel: 'Save',
  }
  // A linked habit with a hand entry can go back to what SparkyFitness gave.
  const answer = linked && hand ? await amountDialog({ ...options, alternative: 'Use SparkyFitness value' }) : await promptDialog(options)
  if (answer === null) return
  if (answer === 'alternative') return setHabitAmount(habit.id, day, 'synced', habit)
  const amount = Number((typeof answer === 'string' ? answer : answer.text).replace(',', '.'))
  if (!Number.isFinite(amount) || amount < 0) {
    lastError.value = 'Type a number, 0 or more.'
    return
  }
  await setHabitAmount(habit.id, day, target ? amount : amount > 0 ? 1 : 0, habit)
}

/** "3/8 glasses" for a goal habit's day; '' for a plain one. */
export const habitAmountLabel = habitAmountText

export const formatAmount = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/** A day's state in words, for a mark's title ("done", "60% of the goal", "day off"…); `part` is how far along a partial day is, 0 to 1. */
export function habitStateWord(state: HabitDayState, part = 0): string {
  switch (state) {
    case 'done':
      return 'done'
    case 'partial':
      return `${Math.round(part * 100)}% of the goal`
    case 'missed':
      return 'not done'
    case 'off':
      return 'day off'
    case 'later':
      return 'not done yet'
    case 'paused':
      return 'paused'
  }
}
