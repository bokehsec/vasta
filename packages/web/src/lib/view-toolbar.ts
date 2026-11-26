// What a type page's toolbar decides, for the desktop's buttons (ViewToolbar) and the phone's
// Filters sheet (FiltersSheet) alike: the narrowing of this visit (search, Mine, filters, Show
// done), how the view is arranged (sort, group, layout, fields) and the menus that change it
// (ArrangeMenus). Nothing here edits the view but "Save to view" and the arrange menus, which
// save on the type (updateView). The narrowing is gone when the person leaves the page.
import { BLOCKED_PROPERTY_ID, RANK_PROPERTY_ID, savedShowsClosed, savedWithNarrowing, shownFilter, withSavedConditions, quickActionsOf } from '@vasta/core'
import type { CardLayout, CardSettings, FilterGroup, GroupRule, ObjectSummary, ObjectType, SortRule, ViewDef, ViewLayout, ViewOpenIn } from '@vasta/core'
import { computed, reactive, ref, type ComputedRef } from 'vue'
import { patchCardSettings, type CardFieldOption, type CardVariant } from './cards.ts'
import { listFields, quickActionsColumnShown, rowFieldsFromTable, tableColumns, toggleQuickActionsColumn } from './columns.ts'
import { propName, t } from './i18n.ts'
import { meId, sharedSpace } from './people.ts'
import { preference } from './preferences.ts'
import { kindIcon } from './properties.ts'
import { groupOptions } from './query.ts'

export const LAYOUTS: { layout: ViewLayout; label: string; icon: string }[] = [
  { layout: 'list', label: 'List', icon: 'ph:list-dashes' },
  { layout: 'grid', label: 'Grid', icon: 'ph:grid-four' },
  { layout: 'wall', label: 'Wall', icon: 'ph:wall' },
  { layout: 'gallery', label: 'Gallery', icon: 'ph:images' },
  { layout: 'table', label: 'Table', icon: 'ph:table' },
  { layout: 'kanban', label: 'Board', icon: 'ph:kanban' },
  { layout: 'agenda', label: 'Agenda', icon: 'ph:calendar-dots' },
]

/** The fields a review of a view's objects shows: its table's columns, or its list's fields. */
export function viewFields(view: ViewDef | undefined, typeId: string) {
  if (!view) return []
  return view.layout === 'table' ? rowFieldsFromTable(tableColumns(view.table, [typeId])) : view.list?.fields ? listFields(view.list, [typeId]) : []
}

export function useViewToolbar(o: { typeId: () => string; type: ComputedRef<ObjectType | undefined>; view: ComputedRef<ViewDef>; updateView: (patch: Partial<ViewDef>) => void; fixedActive: ComputedRef<boolean> }) {
  const { type, view, updateView } = o
  const valueProps = computed(() => (type.value?.properties ?? []).filter((p) => p.kind !== 'rich-text'))
  const selectProps = computed(() => valueProps.value.filter((p) => p.kind === 'select'))

  // Search, Mine and the filters narrow what the page shows; the view's own filter is the view's.
  const agendaActive = computed(() => view.value.layout === 'agenda' && !o.fixedActive.value)
  const filterText = ref('')
  /** "Mine": only what one of the type's person fields (Assignee…) names the user in; per type, for this person. */
  const personProps = computed(() => valueProps.value.filter((p) => p.kind === 'person'))
  const mineOnly = preference(() => `type/${o.typeId()}/mine`, false, { scope: 'account' })
  const toggleMine = () => (mineOnly.value = !mineOnly.value)
  const showMine = computed(() => sharedSpace.value && personProps.value.length > 0)
  const mineTitle = computed(() => `Only what ${personProps.value.map((p) => p.name).join(' or ')} names you in`)
  const isMine = (object: ObjectSummary) => {
    const me = meId()
    return personProps.value.some((p) => {
      const value = object.props[p.id]
      return value?.kind === 'person' && !!me && value.value.includes(me)
    })
  }
  /** The rows Mine keeps (all of them while it is off or does not apply). */
  const minePasses = (object: ObjectSummary) => !showMine.value || !mineOnly.value || isMine(object)
  // Closed tasks (Done, Dropped) shown or left out as this person chose for the view ("Show done",
  // which starts as the view's own "Status is not Done, Dropped"), and the narrowing made on this visit.
  const showClosed = preference(() => `type/${o.typeId()}/view/${view.value.id}/show-closed`, () => savedShowsClosed(type.value, view.value.filter), { scope: 'account' })
  const narrowings = ref<Record<string, FilterGroup>>({})
  const narrowing = computed<FilterGroup>(() => narrowings.value[view.value.id] ?? { kind: 'group', operator: 'and', items: [] })
  /** What the page filters with (core view-filter.ts). */
  const viewFilter = computed(() => shownFilter(type.value, view.value.filter, showClosed.value, narrowing.value))
  const filterCount = computed(() => narrowing.value.items.length)
  const setNarrowing = (group: FilterGroup) => (narrowings.value = { ...narrowings.value, [view.value.id]: group })
  const clearNarrowing = () => setNarrowing({ ...narrowing.value, items: [] })
  /** Save to view: the narrowing joins the view's own filter, for everyone, and the page narrows no more. */
  function saveNarrowing() {
    updateView({ filter: savedWithNarrowing(view.value.filter, narrowing.value) })
    clearNarrowing()
  }
  /** Edit view filter: the view's own conditions, changed on purpose. */
  const editViewFilter = (conditions: FilterGroup) => updateView({ filter: withSavedConditions(type.value, view.value.filter, conditions) })

  const searching = computed(() => !agendaActive.value && !!filterText.value.trim())
  const mineOn = computed(() => showMine.value && mineOnly.value && !agendaActive.value && !o.fixedActive.value)
  /** What narrows the page now: search, Mine and each filter. */
  const activeFilterCount = computed(() => Number(searching.value) + Number(mineOn.value) + (o.fixedActive.value ? 0 : filterCount.value))
  /** Clears search, Mine and the narrowing; the view's own filter, sort, grouping and layout stay. */
  function clearFilters() {
    filterText.value = ''
    mineOnly.value = false
    clearNarrowing()
  }

  // Arranging: sort, group, layout and the fields of each layout.
  const sortFields = computed(() => [
    // A board keeps the order its cards were dragged into until it is sorted by a field.
    ...(view.value.layout === 'kanban' ? [{ field: RANK_PROPERTY_ID, label: 'Manual' }] : []),
    { field: 'updatedAt', label: 'Last edited' },
    { field: 'createdAt', label: 'Created' },
    { field: 'title', label: 'Title' },
    ...valueProps.value.filter((p) => ['date', 'number', 'text', 'select', 'formula'].includes(p.kind)).map((p) => ({ field: p.id, label: p.name })),
  ])
  const groupFields = computed(() => [{ field: '', label: 'No grouping' }, ...groupOptions([o.typeId()]).filter((f) => f.field !== 'type')])
  const manual = computed(() => view.value.layout === 'kanban' && !view.value.sort?.length)
  const sort = computed<SortRule>(() => (manual.value ? { field: RANK_PROPERTY_ID, direction: 'asc' } : (view.value.sort?.[0] ?? { field: 'updatedAt', direction: 'desc' })))
  const groupField = computed(() => {
    if (view.value.layout === 'kanban') return view.value.groupBy?.[0]?.field ?? selectProps.value[0]?.id ?? 'tags'
    return view.value.groupBy?.[0]?.field ?? ''
  })
  const sortLabel = computed(() => sortFields.value.find((f) => f.field === sort.value.field)?.label ?? '')
  const groupLabel = computed(() => (groupField.value ? (groupFields.value.find((f) => f.field === groupField.value)?.label ?? 'Group') : ''))
  const currentLayout = computed(() => LAYOUTS.find((l) => l.layout === view.value.layout) ?? LAYOUTS[0]!)

  function setSort(field: string) {
    if (field === RANK_PROPERTY_ID) return updateView({ sort: undefined })
    const direction: SortRule['direction'] = sort.value.field === field ? (sort.value.direction === 'asc' ? 'desc' : 'asc') : field === 'title' ? 'asc' : 'desc'
    updateView({ sort: [{ field, direction }] })
  }
  function setGroup(field: string) {
    const { collapsed: _, columnOrder: _o, ...restBoard } = view.value.board ?? {}
    const board = view.value.layout === 'kanban' && field !== groupField.value ? (Object.keys(restBoard).length ? restBoard : undefined) : view.value.board
    updateView({ groupBy: field ? [{ field } as GroupRule] : undefined, ...(view.value.layout === 'kanban' ? { board } : {}) })
  }

  // Card & board options: each card layout (board, gallery, grid, wall) keeps its own settings on the view.
  const cardVariant = computed<CardVariant | null>(() => {
    const layout = view.value.layout
    if (layout === 'kanban' || layout === 'gallery' || layout === 'grid' || layout === 'wall') return layout
    return null
  })
  const activeCardSettings = computed<CardSettings | undefined>(() => {
    if (!cardVariant.value) return undefined
    return cardVariant.value === 'kanban' ? view.value.board : view.value.cards?.[cardVariant.value]
  })
  const cardFieldChoices = computed<CardFieldOption[]>(() => [
    ...valueProps.value
      .filter((p) => p.id !== BLOCKED_PROPERTY_ID && (view.value.layout !== 'kanban' || p.id !== groupField.value))
      .map((p) => ({ id: p.id, label: propName(p), icon: kindIcon(p.kind), def: p })),
    { id: 'tags', label: t('builtin.type.tag.other'), icon: 'ph:tag' },
  ])
  function patchCard(patch: Partial<CardSettings>) {
    const variant = cardVariant.value
    if (!variant) return
    if (variant === 'kanban') {
      updateView({ board: patchCardSettings(view.value.board, patch, 'kanban') })
      return
    }
    const layout: CardLayout = variant
    const nextForLayout = patchCardSettings(view.value.cards?.[layout], patch, layout)
    const nextCards = { ...(view.value.cards ?? {}) }
    if (nextForLayout) nextCards[layout] = nextForLayout
    else delete nextCards[layout]
    updateView({ cards: Object.keys(nextCards).length ? nextCards : undefined })
  }
  function setSwimlanes(field: string) {
    const { swimlanes: _, collapsedLanes: _c, laneOrder: _o, ...rest } = view.value.board ?? {}
    const next = field ? { ...rest, swimlanes: field } : rest
    updateView({ board: Object.keys(next).length ? next : undefined })
  }
  function resetBoardOrder() {
    const { columnOrder: _, laneOrder: _l, ...rest } = view.value.board ?? {}
    updateView({ board: Object.keys(rest).length ? rest : undefined })
  }

  // Layout menu: where objects open, nested steps, a table as rows on a phone, quick actions on rows.
  const openChoices = computed<{ openIn: ViewOpenIn | undefined; label: string }[]>(() => [
    { openIn: undefined, label: `Same as ${type.value?.name ?? 'the type'} (${type.value?.openIn === 'pane' ? 'side pane' : type.value?.openIn === 'page' ? 'full page' : 'window'})` },
    { openIn: 'popup', label: 'Window' },
    { openIn: 'pane', label: 'Side pane' },
    { openIn: 'page', label: 'Full page' },
  ])
  // On a phone a table view is drawn as rows, unless "Show as table on this phone" is ticked (per view, for this person).
  const phoneTable = preference(() => `type/${o.typeId()}/view/${view.value.id}/phone-table`, false, { scope: 'account' })
  const togglePhoneTable = () => (phoneTable.value = !phoneTable.value)
  const hasQuickActions = computed(() => quickActionsOf(type.value).length > 0)
  // Quick actions for tasks: in a table, a column (shown, hidden and moved like the others); in a list, on each row.
  const quickActionsOn = computed(() => (view.value.layout === 'table' ? quickActionsColumnShown(view.value.table, [o.typeId()]) : !!view.value.quickActions))
  function toggleQuickActions() {
    if (view.value.layout === 'table') updateView({ table: toggleQuickActionsColumn(view.value.table, [o.typeId()]) })
    else updateView({ quickActions: view.value.quickActions ? undefined : true })
  }

  // The menus the toolbar's buttons open (a desktop) or the Filters sheet's Arrange rows (a phone).
  const menus = { sort: ref(false), group: ref(false), layout: ref(false), columns: ref(false), cards: ref(false), options: ref(false), filter: ref(false) }
  /** The desktop buttons the menus hang from, by menu name. */
  const anchors = reactive<Record<keyof typeof menus, HTMLElement | null>>({ sort: null, group: null, layout: null, columns: null, cards: null, options: null, filter: null })
  /** The arrange buttons, in order: what each is, what it says now, and the menu it opens. */
  const arrangeRows = computed(() => {
    const layout = view.value.layout
    const more =
      layout === 'table' ? { id: 'columns', menu: 'columns' as const, label: 'Columns', icon: 'ph:columns', open: menus.columns }
      : layout === 'list' ? { id: 'fields', menu: 'columns' as const, label: 'Fields', icon: 'ph:list-checks', open: menus.columns }
      : cardVariant.value ? { id: 'cards', menu: 'cards' as const, label: 'Cards', icon: 'ph:cards', open: menus.cards }
      : layout === 'agenda' ? { id: 'options', menu: 'options' as const, label: 'Options', icon: 'ph:sliders-horizontal', open: menus.options }
      : undefined
    return [
      ...(agendaActive.value
        ? []
        : [
            { id: 'sort', menu: 'sort' as const, label: 'Sort', icon: sort.value.direction === 'asc' ? 'ph:sort-ascending' : 'ph:sort-descending', value: sortLabel.value, open: menus.sort },
            { id: 'group', menu: 'group' as const, label: 'Group', icon: 'ph:rows', value: groupLabel.value || 'None', open: menus.group },
          ]),
      { id: 'layout', menu: 'layout' as const, label: 'Layout', icon: currentLayout.value.icon, value: currentLayout.value.label, open: menus.layout },
      ...(more ? [{ ...more, value: '' }] : []),
    ]
  })

  return {
    type, view, updateView, fixedActive: o.fixedActive, agendaActive, valueProps,
    filterText, personProps, mineOnly, toggleMine, showMine, mineTitle, minePasses, mineOn, showClosed, narrowing, viewFilter, filterCount, setNarrowing, clearNarrowing, saveNarrowing, editViewFilter, searching, activeFilterCount, clearFilters,
    sortFields, groupFields, manual, sort, groupField, sortLabel, groupLabel, currentLayout, setSort, setGroup,
    cardVariant, activeCardSettings, cardFieldChoices, patchCard, setSwimlanes, resetBoardOrder,
    openChoices, phoneTable, togglePhoneTable, hasQuickActions, quickActionsOn, toggleQuickActions,
    menus, anchors, arrangeRows,
  }
}

export type ViewToolbar = ReturnType<typeof useViewToolbar>
