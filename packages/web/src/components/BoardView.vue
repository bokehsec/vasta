<script setup lang="ts">
// The board layout: a column per group of `groupField`, optionally in rows (swimlanes) by a second
// field. Cards keep a manual order (core rank.ts) while `manual`, move by dragging (lib/board.ts:
// a mouse at once, a finger after a long press), and are made with "+" at the bottom of a column.
// Columns fold and can have a WIP limit. The limit is the view's setting (`board`); which columns are
// folded is each person's own (lib/group-folds.ts), the view's `collapsed` only what is folded until
// they fold one. On a phone (without swimlanes) a column is most of the screen wide and the board
// snaps from one to the next, with a strip of the columns' names and counts above that jumps to one.
import { computed, inject, nextTick, onBeforeUnmount, ref } from 'vue'
import type { BoardSettings, Id, NewItemValues, ObjectRecord, ObjectSummary, PropertyDef } from '@vasta/core'
import { RANK_PROPERTY_ID, byRank, rankOf, rankBetween } from '@vasta/core'
import { createObject } from '../lib/actions.ts'
import { boardDrag, closeCard, closingColumn, moveCard, pressCard, type BoardAxis, type CardTarget } from '../lib/board.ts'
import { chip } from '../lib/colors.ts'
import { foldKey, useGroupFolds } from '../lib/group-folds.ts'
import { t } from '../lib/i18n.ts'
import { openMenuAt, promptDialog } from '../lib/overlays.ts'
import { quietButton } from '../lib/buttons.ts'
import { newValues, useNewPlace } from '../lib/new-item.ts'
import { acceptsGroup, groupObjects, isDateField, movableField, NO_VALUE, typesOf, type Group } from '../lib/query.ts'
import { lastError, typesById } from '../lib/state.ts'
import { isPhone } from '../lib/viewport.ts'
import { COMPLETION_FEEDBACK } from '../lib/completion-feedback.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import ObjectCard from './ObjectCard.vue'
import ObjectChip from './ObjectChip.vue'
import PersonChip from './PersonChip.vue'

const props = defineProps<{
  objects: ObjectSummary[]
  groupField: string
  typeIds: Id[]
  board?: BoardSettings
  /** The view's or query's identity (a path), for the person's own column folds. */
  foldScope?: string
  /** Cards in their manual order (the view has no sort of its own). */
  manual: boolean
}>()
const emit = defineEmits<{
  menu: [event: MouseEvent, object: ObjectSummary]
  moved: [object: ObjectRecord]
  created: [object: ObjectRecord]
  board: [board: BoardSettings]
  /** A card was dropped among others while the view sorts by a field: it should go back to the manual order. */
  manual: []
}>()

const types = computed(() => typesOf(props.typeIds))
const typeOf = (object: ObjectSummary) => typesById.value.get(object.typeId)
const laneField = computed(() => (props.board?.swimlanes && props.board.swimlanes !== props.groupField ? props.board.swimlanes : ''))

const completion = inject(COMPLETION_FEEDBACK, undefined)
function placedGroups(field: string, keepEmpty: boolean) {
  const actual = new Map(props.objects.map((object) => [object.id, object]))
  return groupObjects(props.objects.map((object) => completion?.placement(object) ?? object), field, types.value, keepEmpty)
    .map((group) => ({ ...group, items: group.items.map((object) => actual.get(object.id)!) }))
}
const columns = computed<Group[]>(() => placedGroups(props.groupField, true))
const lanes = computed<Group[]>(() => (laneField.value ? placedGroups(laneField.value, false) : [{ key: '', label: '', items: props.objects }]))

/** The cards of a column in a lane, in the board's order. */
function cell(column: Group, lane: Group): ObjectSummary[] {
  const inLane = new Set(lane.items.map((o) => o.id))
  const items = laneField.value ? column.items.filter((o) => inLane.has(o.id)) : column.items
  if (!props.manual) return items
  const actual = new Map(items.map((object) => [object.id, object]))
  return byRank(items.map((object) => completion?.placement(object) ?? object)).map((object) => actual.get(object.id)!)
}

// A phone: one column at a time --------------------------------------------------
const oneColumn = computed(() => isPhone.value && !laneField.value)
const scroller = ref<HTMLElement | null>(null)
const columnEls = new Map<string, HTMLElement>()
const columnRef = (key: string) => (el: unknown) => (el instanceof HTMLElement ? columnEls.set(key, el) : columnEls.delete(key))
const current = ref('')
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function showColumn(column: Group) {
  current.value = column.key
  columnEls.get(column.key)?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}
/** The column nearest the board's left edge is the one shown. */
let frame = 0
function onScroll() {
  if (!oneColumn.value || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const left = scroller.value?.getBoundingClientRect().left ?? 0
    let best = ''
    let distance = Infinity
    for (const [key, el] of columnEls) {
      const d = Math.abs(el.getBoundingClientRect().left - left - 12)
      if (d < distance) [best, distance] = [key, d]
    }
    current.value = best
  })
}
onBeforeUnmount(() => cancelAnimationFrame(frame))
const shownKey = computed(() => current.value || columns.value[0]?.key)

// Columns: folded ones and WIP limits ------------------------------------------
const { folded: collapsed, toggle: toggleFold } = useGroupFolds(() => foldKey('columns', props.foldScope, props.groupField), () => props.board?.collapsed)
const wip = (column: Group) => props.board?.wip?.[column.key]
const over = (column: Group) => (wip(column) ?? Infinity) < column.items.length

function setBoard(patch: Partial<BoardSettings>) {
  const next: BoardSettings = { ...(props.board ?? {}), ...patch }
  for (const key of Object.keys(next) as (keyof BoardSettings)[]) if (next[key] === undefined) delete next[key]
  emit('board', next)
}
async function setWip(column: Group) {
  const answer = await promptDialog({
    title: t('board.wipTitle', { column: column.label || t('board.thisColumn') }),
    message: t('board.wipMessage'),
    value: wip(column) ? String(wip(column)) : '',
    placeholder: t('board.noLimit'),
    confirmLabel: t('board.setLimit'),
    optional: true,
  })
  if (answer === null) return
  const limit = Math.floor(Number(answer))
  const limits = { ...(props.board?.wip ?? {}) }
  if (answer.trim() && limit > 0) limits[column.key] = limit
  else delete limits[column.key]
  setBoard({ wip: Object.keys(limits).length ? limits : undefined })
}
function columnMenu(event: MouseEvent, column: Group) {
  openMenuAt(event.clientX, event.clientY, [
    { label: collapsed.value.has(column.key) ? t('board.unfoldColumn') : t('board.foldColumn'), icon: collapsed.value.has(column.key) ? 'ph:arrows-out-line-horizontal' : 'ph:arrows-in-line-horizontal', run: () => toggleFold(column.key) },
    { label: wip(column) ? t('board.wipLimitValue', { limit: wip(column)! }) : t('board.setWipLimit'), icon: 'ph:gauge', run: () => setWip(column) },
  ])
}

// Card fields: the view's, or the first two with a value that are not the columns or lanes.
const cardFields = computed<PropertyDef[] | undefined>(() => {
  const ids = props.board?.cardFields
  if (!ids) return undefined
  const defs = types.value.flatMap((t) => t.properties)
  return ids.flatMap((id) => defs.find((d) => d.id === id) ?? [])
})
// A date's group (This week) does not say the day, so cards keep showing it.
const hiddenFields = computed(() => [props.groupField, laneField.value].filter((field): field is string => !!field && !isDateField(field, types.value)))

// Dragging -------------------------------------------------------------------
const columnAxis = computed<BoardAxis>(() => ({ field: props.groupField, groups: columns.value }))
const laneAxis = computed<BoardAxis | undefined>(() => (laneField.value ? { field: laneField.value, groups: lanes.value } : undefined))
const draggable = computed(() => movableField(props.groupField) && (!laneField.value || movableField(laneField.value)))
// A date's group may not stand for a day (Earlier): a card cannot be dropped there, unless it is already in it.
const takes = (axis: BoardAxis, group: Group, cardId: Id) => group.items.some((o) => o.id === cardId) || acceptsGroup(axis.field, group, types.value)
const accepting = (column: Group, lane: Group, cardId: Id) => takes(columnAxis.value, column, cardId) && (!laneAxis.value || takes(laneAxis.value, lane, cardId))

async function drop(cardId: Id, target: CardTarget) {
  const card = props.objects.find((o) => o.id === cardId)
  const column = columns.value.find((g) => g.key === target.column)
  const lane = lanes.value.find((g) => g.key === target.lane)
  if (!card || !column || !lane || !accepting(column, lane, cardId)) return
  const cells = cell(column, lane)
  const sameCell = cells.some((o) => o.id === cardId)
  // Dropped back where it was: nothing to do.
  if (sameCell && cells.indexOf(card) === target.index) return
  // Reordering a column only makes sense in the manual order.
  if (sameCell && !props.manual) emit('manual')
  try {
    const type = typeOf(card)
    const closing = closingColumn(type, card, columnAxis.value, column)
    if (type && closing) {
      // Done or Dropped: the type's own action, with its notice and Undo (lib/board.ts closeCard).
      const moving = completion && (<T,>(run: () => Promise<T>) => completion.moving(card.id, run))
      await closeCard(type, card, closing, { target, columns: columnAxis.value, lanes: laneAxis.value, cell: cells, moving, saved: (object) => emit('moved', object) })
      return
    }
    const move = () => moveCard(card, target, columnAxis.value, laneAxis.value, cells)
    const saved = await (completion ? completion.moving(card.id, move) : move())
    for (const object of saved) emit('moved', object)
  } catch (error) {
    lastError.value = (error as Error).message
  }
}

// A finger's long press drags (on a phone that is also when the browser opens a menu: not here).
let lastPointer = ''
function onPress(event: PointerEvent, object: ObjectSummary) {
  lastPointer = event.pointerType
  if (draggable.value) pressCard(event, object.id, drop)
}
function onContextMenu(event: MouseEvent, object: ObjectSummary) {
  if (lastPointer === 'touch' && draggable.value) event.preventDefault()
  else emit('menu', event, object)
}

/** A cell's cards with their place among the cards other than the one dragged (-1 for it). */
function placed(column: Group, lane: Group) {
  let place = 0
  return cell(column, lane).map((object) => ({ object, place: boardDrag.active && object.id === boardDrag.cardId ? -1 : place++ }))
}

/** Where the dragged card would land, to draw a bar there. */
const landing = (column: Group, lane: Group) => (boardDrag.active && boardDrag.target?.column === column.key && boardDrag.target.lane === lane.key && accepting(column, lane, boardDrag.cardId) ? boardDrag.target.index : -1)
const cellKey = (column: Group, lane: Group) => `${column.key}|${lane.key}`

// "+": a new card in a column (and lane), at its end -------------------------------
const place = useNewPlace()
const addingIn = ref('')
const newTitle = ref('')
const newInput = ref<HTMLInputElement[]>([])
const canAdd = (column: Group, lane: Group) => props.typeIds.length === 1 && draggable.value && acceptsGroup(props.groupField, column, types.value) && (!laneField.value || acceptsGroup(laneField.value, lane, types.value))
async function startAdding(column: Group, lane: Group) {
  addingIn.value = cellKey(column, lane)
  newTitle.value = ''
  await nextTick()
  newInput.value[0]?.focus()
}
async function addCard(column: Group, lane: Group) {
  const title = newTitle.value.trim()
  const typeId = props.typeIds[0]
  if (!title || !typeId) {
    addingIn.value = ''
    return
  }
  const type = typesById.value.get(typeId)
  // The same starting values as every New (lib/new-item.ts): the view's filter and Mine, so the card
  // does not vanish, then this column and lane.
  const groups = [{ field: props.groupField, group: column }, ...(laneField.value ? [{ field: laneField.value, group: lane }] : [])]
  const draft: NewItemValues = type ? newValues(type, groups, place) : { props: {}, tagIds: [] }
  const last = cell(column, lane).at(-1)
  const lastRank = last && rankOf(last)
  if (props.manual && (lastRank || !last)) draft.props[RANK_PROPERTY_ID] = { kind: 'rank', value: rankBetween(lastRank) }
  newTitle.value = ''
  try {
    const created = await createObject(typeId, { title, props: draft.props, tagIds: draft.tagIds }, false)
    emit('created', created)
  } catch (error) {
    lastError.value = (error as Error).message
  }
  await nextTick()
  newInput.value[0]?.focus()
}
</script>

<template>
  <div>
    <nav v-if="oneColumn && columns.length > 1" class="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Columns" data-board-chips>
      <button
        v-for="column in columns"
        :key="column.key"
        class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5"
        :class="[bodyText, shownKey === column.key ? 'border-ink bg-ink text-surface' : 'border-line text-ink-soft']"
        :aria-current="shownKey === column.key || undefined"
        :data-board-chip="column.key"
        @click="showColumn(column)"
      >
        {{ column.label || 'None' }}<span class="tabular-nums opacity-70">{{ column.items.length }}</span>
      </button>
    </nav>
    <div
      ref="scroller"
      class="overflow-x-auto pb-4"
      :class="oneColumn && !boardDrag.active ? 'snap-x snap-mandatory scroll-pl-3' : ''"
      data-drag-scroll
      @scroll.passive="onScroll"
    >
      <div class="inline-flex min-w-full flex-col gap-4">
        <div v-for="(lane, laneIndex) in lanes" :key="lane.key">
          <!-- A lane's header: what its cards share. -->
          <header v-if="laneField" class="sticky left-0 mb-2 flex w-fit items-center gap-2" :class="bodyText">
            <ObjectChip v-if="lane.objectId" :id="lane.objectId" :tag="laneField === 'tags'" />
            <PersonChip v-else-if="lane.personId" :id="lane.personId" />
            <span v-else class="rounded-md px-2 py-0.5 font-medium" :class="lane.key === NO_VALUE ? 'text-ink-faint' : chip(lane.color as never)">{{ lane.label }}</span>
            <span class="text-ink-faint" :class="metaText">{{ lane.items.length }}</span>
          </header>
          <div class="flex gap-3">
            <section
              v-for="column in columns"
              :key="column.key"
              :ref="laneIndex === 0 ? columnRef(column.key) : undefined"
              class="flex shrink-0 flex-col rounded-xl bg-raised ring-1 ring-line"
              :class="[collapsed.has(column.key) ? 'w-11 p-1.5' : oneColumn ? 'w-[85vw] p-2' : 'w-72 p-2', oneColumn ? 'snap-start' : '']"
              :data-board-column="column.key"
            >
              <!-- Column headers on the first lane only; a folded column shows its name upright. -->
              <header
                v-if="laneIndex === 0 || collapsed.has(column.key)"
                class="group/col flex items-center gap-2"
                :class="[bodyText, collapsed.has(column.key) ? 'cursor-pointer flex-col py-1' : 'px-1 py-1']"
                @click="collapsed.has(column.key) && toggleFold(column.key)"
                @contextmenu.prevent="columnMenu($event, column)"
              >
                <template v-if="!collapsed.has(column.key)">
                  <span v-if="column.objectId"><ObjectChip :id="column.objectId" :tag="groupField === 'tags'" /></span>
                  <PersonChip v-else-if="column.personId" :id="column.personId" />
                  <span v-else class="truncate rounded-md px-2 py-0.5 font-medium" :class="column.key === NO_VALUE ? 'text-ink-faint' : chip(column.color as never)">{{ column.label }}</span>
                </template>
                <span
                  class="tabular-nums"
                  :class="[metaText, over(column) ? 'rounded-md bg-red-100 px-1.5 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-ink-faint']"
                  :title="wip(column) ? t('board.wipTooltip', { limit: wip(column)! }) : undefined"
                >{{ column.items.length }}<template v-if="wip(column)">/{{ wip(column) }}</template></span
                >
                <span v-if="collapsed.has(column.key)" class="font-medium text-ink-soft [writing-mode:vertical-rl]" :class="metaText">{{ column.label || '…' }}</span>
                <button
                  v-else
                  class="ml-auto rounded-md p-0.5 text-ink-faint opacity-0 hover:bg-hover hover:text-ink group-hover/col:opacity-100 [@media(hover:none)]:opacity-100 max-md:-my-2.5 max-md:-mr-2 max-md:grid max-md:h-11 max-md:w-11 max-md:place-items-center"
                  :title="t('board.columnOptions')"
                  @click.stop="columnMenu($event, column)"
                >
                  <AppIcon fallback="ph:dots-three" :size="16" />
                </button>
              </header>
              <div
                v-if="!collapsed.has(column.key)"
                class="flex min-h-12 flex-1 flex-col gap-2"
                :class="laneIndex === 0 ? 'mt-2' : ''"
                :data-board-cell="cellKey(column, lane)"
              >
                <!-- The card being dragged stays where it was, faded; a bar shows where it would land. -->
                <template v-for="{ object, place } in placed(column, lane)" :key="object.id">
                  <div v-if="place >= 0 && landing(column, lane) === place" class="h-1 rounded-full bg-accent" />
                  <div
                    :data-board-card="object.id"
                    class="touch-manipulation select-none"
                    :class="place < 0 ? 'opacity-40' : ''"
                    @pointerdown="onPress($event, object)"
                    @contextmenu="onContextMenu($event, object)"
                    @dragstart.prevent
                  >
                    <ObjectCard :object="object" :type="typeOf(object)" variant="kanban" :fields="cardFields" :hide="hiddenFields" @moved="emit('moved', $event)" />
                  </div>
                </template>
                <div v-if="landing(column, lane) >= 0 && landing(column, lane) >= placed(column, lane).filter((p) => p.place >= 0).length" class="h-1 rounded-full bg-accent" />
                <template v-if="canAdd(column, lane)">
                  <input
                    v-if="addingIn === cellKey(column, lane)"
                    ref="newInput"
                    v-model="newTitle"
                    class="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 outline-none max-md:min-h-11 max-md:text-base"
                    :class="bodyText"
                    :placeholder="t('board.newCardPlaceholder')"
                    @keydown.enter.prevent="addCard(column, lane)"
                    @keydown.esc="addingIn = ''"
                    @blur="addingIn = ''"
                  />
                  <button v-else :class="quietButton" @click="startAdding(column, lane)">
                    <AppIcon fallback="ph:plus" :size="14" /> {{ t('common.new') }}
                  </button>
                </template>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
