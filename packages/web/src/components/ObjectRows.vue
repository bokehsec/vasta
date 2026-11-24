<script setup lang="ts">
// The list layout of ObjectCollection, and a table drawn as rows on a phone: one row for each object
// of a group. A task has a checkbox; with fields chosen each row shows those after its title; a
// view or query that turns quick actions on gets their buttons at the end of the row (on a line of
// their own in a narrow column) and a task's next step under its title. Steps (core subtasks.ts):
// a step follows its parent, indented (four levels at most), and a parent's caret folds its steps
// (for the session); an object with steps shows how far they are; a step whose parent is not listed
// stays at the top with the parent's name under it. On a touch screen a row swipes (SwipeRow); a
// phone's rows have their own ⋯ for the menu, and its swipes replace the row's buttons.
import { computed } from 'vue'
import type { Id, ListSettings, ObjectRecord, ObjectSummary, PropertyValue } from '@vasta/core'
import { isClosedTask, nextStepFieldOf, outlineRows, parentIdOf, type OutlineRow } from '@vasta/core'
import { setProperties } from '../lib/actions.ts'
import { useRowTypes } from '../lib/collection-rows.ts'
import type { ListField } from '../lib/columns.ts'
import { rowFields } from '../lib/columns.ts'
import { displayTitle, formatRelative } from '../lib/format.ts'
import type { Group } from '../lib/query.ts'
import { swipeActionsFor } from '../lib/quick-actions.ts'
import { summaryOf } from '../lib/state.ts'
import { foldedSteps as folded } from '../lib/subtasks.ts'
import { hideSwipeTip, swipeTipHidden } from '../lib/tips.ts'
import { objectColor } from '../lib/tags.ts'
import { isPhone, isTouch } from '../lib/viewport.ts'
import { bodyText, metaText } from '../lib/type-scale.ts'
import AppIcon from './AppIcon.vue'
import FieldValue from './FieldValue.vue'
import ObjectChip from './ObjectChip.vue'
import ObjectLink from './ObjectLink.vue'
import ShowMore from './ShowMore.vue'
import StepProgress from './StepProgress.vue'
import SwipeRow from './SwipeRow.vue'
import TaskCompletionCheck from './TaskCompletionCheck.vue'
import TaskCompletionNote from './TaskCompletionNote.vue'
import TaskQuickActions from './TaskQuickActions.vue'
import TypeIcon from './TypeIcon.vue'

const props = defineProps<{
  group: Group
  /** How many of the group's objects are drawn. */
  limit: number
  /** Every object listed (all groups), for the tip and for a step whose parent is in another group. */
  objects: ObjectSummary[]
  /** Steps nest under their parent. */
  nests: boolean
  list?: ListSettings | undefined
  /** The fields after each title; none: tags and the last change. */
  listColumns?: ListField[] | undefined
  /** A table drawn as rows: its first four fields that have a value. */
  phoneRows: boolean
  /** The quick actions column is left out of a phone's table and its buttons go under each title. */
  actionsUnderTitle: boolean
  quickActions?: boolean | undefined
  readonly?: boolean | undefined
  /** The swipe tip shows above this group's rows. */
  tip: boolean
  /** More are drawn when the end comes near. */
  auto: boolean
}>()
const emit = defineEmits<{
  menu: [event: MouseEvent, object: ObjectSummary]
  moved: [object: ObjectRecord]
  more: []
}>()

const { completion, typeOf, actionType, titleClass, progressOf } = useRowTypes(() => props.readonly)

const parentIdFor = (object: ObjectSummary) => parentIdOf(typeOf(object), object)
const drawn = computed<OutlineRow<ObjectSummary>[]>(() => {
  if (!props.nests) return props.group.items.slice(0, props.limit).map((object) => ({ object, depth: 0, hasChildren: false }))
  const out: OutlineRow<ObjectSummary>[] = []
  let foldedAt = Infinity
  for (const row of outlineRows(props.group.items, parentIdFor)) {
    if (row.depth > foldedAt) continue
    foldedAt = row.hasChildren && folded.has(row.object.id) ? row.depth : Infinity
    out.push(row)
  }
  return out.slice(0, props.limit)
})
const outlined = computed(() => props.nests && props.group.items.some((o) => parentIdFor(o) && props.group.items.some((p) => p.id === parentIdFor(o))))
/** The name of a listed step's parent when the parent itself is not in the list. */
function absentParent(object: ObjectSummary): string {
  const id = props.nests ? parentIdFor(object) : undefined
  if (!id || props.objects.some((o) => o.id === id)) return ''
  const parent = summaryOf(id)
  return parent ? displayTitle(parent, typeOf(parent)) : ''
}

const quickType = (object: ObjectSummary) => (props.quickActions || (props.phoneRows && props.actionsUnderTitle) ? actionType(object) : undefined)
const nextStepOf = (object: ObjectSummary) => {
  const field = nextStepFieldOf(quickType(object))
  const value = field ? object.props[field.id] : undefined
  return value?.kind === 'text' ? value.value : ''
}
const fieldsOf = (object: ObjectSummary) => {
  const fields = rowFields(object, typeOf(object), props.listColumns ?? [])
  return props.phoneRows ? fields.slice(0, 4) : fields
}

// Swipes (SwipeRow): right runs the type's Defer (else its first action), left uncovers the others,
// Done first, and More (the row's menu). On a phone they replace the row's buttons; a tablet keeps both.
/** The type whose swipes this row has on touch. */
const swipeType = (object: ObjectSummary) => {
  const type = isTouch.value && !completion?.entries.has(object.id) ? actionType(object) : undefined
  return type && !isClosedTask(type, object) ? type : undefined
}
const saveQuick = async (object: ObjectSummary, values: Record<Id, PropertyValue | undefined>) => emit('moved', await setProperties(object.id, values))
function swipesOf(object: ObjectSummary) {
  const type = swipeType(object)
  return type ? swipeActionsFor(type, object, { save: async (id, values) => emit('moved', await setProperties(id, values)), menu: (event) => emit('menu', event, object) }) : { left: [] }
}
/** A phone's ⋯ at a row's end: the row's menu, from the button's corner. */
function rowMore(event: MouseEvent, object: ObjectSummary) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit('menu', new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom }), object)
}
/** On a phone the row's own buttons give way to swipes. */
const rowButtons = (object: ObjectSummary) => !!quickType(object) && !(isPhone.value && (swipeType(object) || completion?.entries.has(object.id)))
/** Shown once per device over the first list with swipeable rows on a phone. */
const swipeTip = computed(() => {
  if (!props.tip || !isPhone.value || swipeTipHidden.value) return ''
  const object = props.objects.find((o) => swipeType(o))
  const right = object && swipesOf(object).right
  return right ? `Swipe right to ${right.label.toLowerCase()}, left for more` : ''
})
const titleWrap = computed(() => props.list?.wrap || isPhone.value)
</script>

<template>
  <p v-if="swipeTip" class="mb-3 flex items-center gap-2 rounded-lg border border-line bg-raised py-1 pl-3 text-ink-soft" :class="metaText" data-swipe-tip>
    <AppIcon fallback="ph:hand-swipe-right" :size="16" class="shrink-0" /><span class="flex-1">{{ swipeTip }}</span>
    <button class="grid h-11 w-11 shrink-0 place-items-center text-ink-faint hover:text-ink" aria-label="Hide this tip" @click="hideSwipeTip"><AppIcon fallback="ph:x" :size="14" /></button>
  </p>
  <div class="divide-y divide-line/70" :class="bodyText" :data-phone-rows="phoneRows || undefined">
    <SwipeRow v-for="{ object, depth, hasChildren } in drawn" :key="object.id" :enabled="!!swipeType(object)" :right="swipesOf(object).right" :left="swipesOf(object).left">
      <ObjectLink
        :id="object.id"
        class="group/row flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover max-md:py-2.5"
        :class="[listColumns ? 'flex-wrap gap-y-1 @2xl:flex-nowrap' : quickType(object) ? 'flex-wrap gap-y-1 @md:flex-nowrap' : absentParent(object) ? 'flex-wrap gap-y-0.5' : '']"
        :style="depth ? { paddingLeft: `${0.5 + Math.min(depth, 4) * 1.5}rem` } : undefined"
        :data-depth="nests ? depth : undefined"
        data-list-row
        @contextmenu="emit('menu', $event, object)"
      >
        <!-- A parent's caret folds its steps; rows of an outline keep its place free (a phone keeps the width for the title). -->
        <button
          v-if="hasChildren"
          class="relative -mx-1 grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-line hover:text-ink [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-3 [@media(hover:none)]:after:content-['']"
          :aria-expanded="!folded.has(object.id)"
          :title="folded.has(object.id) ? 'Show subtasks' : 'Hide subtasks'"
          data-fold-steps
          @click.prevent.stop="folded.has(object.id) ? folded.delete(object.id) : folded.add(object.id)"
        >
          <AppIcon :fallback="folded.has(object.id) ? 'ph:caret-right' : 'ph:caret-down'" :size="13" />
        </button>
        <span v-else-if="outlined && !isPhone" class="-mx-1 w-5 shrink-0" aria-hidden="true" />
        <!-- On touch the checkbox's tap area reaches 44px around it. -->
        <TaskCompletionCheck v-if="typeOf(object)?.system === 'task' && !readonly && (listColumns || completion)" :object="object" :type="typeOf(object)" @moved="emit('moved', $event)" />
        <TypeIcon v-else :icon="object.icon ?? typeOf(object)?.icon" fallback="ph:file-text" :color="objectColor(object, typeOf(object))" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium max-md:text-base max-md:leading-snug" :class="[titleWrap ? 'break-words' : 'truncate', titleClass(object)]">{{ displayTitle(object, typeOf(object)) }}</span>
          <span v-if="nextStepOf(object)" class="mt-0.5 flex items-center gap-1 text-ink-soft" :class="metaText" data-next-step-line>
            <AppIcon fallback="ph:arrow-right" :size="11" class="shrink-0 text-ink-faint" /><span class="truncate">{{ nextStepOf(object) }}</span>
          </span>
        </span>
        <TaskCompletionNote :object="object" class="order-last w-full pl-[30px]" />
        <StepProgress v-if="progressOf(object)" :progress="progressOf(object)!" />
        <span v-if="absentParent(object)" class="order-last w-full truncate pl-[30px] text-ink-faint" :class="metaText" data-absent-parent>in {{ absentParent(object) }}</span>
        <span v-if="listColumns" class="flex min-w-0 shrink-0 items-center gap-2 @max-2xl:order-last @max-2xl:w-full @max-2xl:flex-wrap @max-2xl:pl-[30px]" :class="metaText" data-row-fields @click.prevent>
          <FieldValue v-for="field in fieldsOf(object)" :key="field.field" :data-row-field="field.field" :object="object" :field="field.field" :def="field.def" row />
        </span>
        <template v-else>
          <span class="hidden gap-1 md:flex" @click.prevent>
            <ObjectChip v-for="id in object.tagIds.slice(0, 3)" :key="id" :id="id" tag />
          </span>
          <!-- A phone leaves out when a task was last changed: the title needs the room more. -->
          <span v-if="!quickType(object) && !(isPhone && typeOf(object)?.system === 'task')" class="w-24 shrink-0 text-right text-ink-faint max-md:w-auto" :class="metaText">{{ formatRelative(object.updatedAt) }}</span>
        </template>
        <!-- In a narrow column the actions take a line of their own under the title; on a phone swipes replace them. -->
        <TaskQuickActions v-if="rowButtons(object)" :type="quickType(object)!" :object="object" variant="row" class="@max-md:order-last @max-md:w-full @max-md:pl-6" @set="saveQuick(object, $event)" />
        <!-- A phone: a visible way to the row's menu, 44px to touch (a long press is not found by looking). -->
        <button v-if="isPhone && !readonly" class="-my-2.5 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-soft active:bg-hover" :aria-label="`More actions for ${displayTitle(object, typeOf(object))}`" data-row-more @click.prevent.stop="rowMore($event, object)">
          <AppIcon fallback="ph:dots-three" :size="20" />
        </button>
      </ObjectLink>
    </SwipeRow>
  </div>
  <ShowMore v-if="group.items.length > limit" :key="drawn.length" :shown="drawn.length" :total="group.items.length" :auto="auto" @more="emit('more')" />
</template>
