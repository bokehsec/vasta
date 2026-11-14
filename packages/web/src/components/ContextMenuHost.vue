<script setup lang="ts">
// Renders the context menu from lib/overlays.ts at the pointer, with keyboard navigation. A
// submenu row opens a second panel beside its row (one level deep). On a phone it is a sheet from
// the bottom with rows 44px high, and a submenu replaces the list inside it, with a Back row. The
// sheet is modal: a tap on the dimmed area closes it (on the tap, so it does not reach the page
// underneath), focus moves in and goes back to where it was.
import { computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ColorName, Icon } from '@vasta/core'
import { blockBackgroundClasses, blockTextClasses, colorNames } from '../lib/colors.ts'
import { closeContextMenu, contextMenu, type MenuItem } from '../lib/overlays.ts'
import { isPhone, keyboardInset, sheetMaxHeight } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'

const panels: (HTMLElement | null)[] = [null, null]
/** The highlighted row of each panel, -1 for none. */
const active = ref<[number, number]>([-1, -1])
/** The main panel's row whose submenu is open. */
const sub = ref<number | null>(null)
/** The panel the arrow keys move in: 0 the menu, 1 the submenu. */
const level = ref(0)

type Action = Extract<MenuItem, { run: () => unknown }>
type Submenu = Extract<MenuItem, { kind: 'submenu' }>
const isAction = (item: MenuItem): item is Action => item.kind === undefined || item.kind === 'action'
const isSubmenu = (item: MenuItem | undefined): item is Submenu => item?.kind === 'submenu'

const subItems = computed(() => {
  const item = sub.value === null ? undefined : contextMenu.items[sub.value]
  return isSubmenu(item) ? item.items : []
})
const levels = computed(() => (sub.value === null ? [0] : [0, 1]))
const itemsOf = (at: number) => (at ? subItems.value : contextMenu.items)
const reachable = (at: number) => itemsOf(at).flatMap((item, i) => ((isAction(item) && !item.disabled) || isSubmenu(item) ? [i] : []))

const sheet = computed(() => isPhone.value)
/** The list the sheet shows: the submenu once one is open. */
const sheetLevel = computed(() => (sub.value === null ? 0 : 1))

const iconProps = (icon: string | Icon) => (typeof icon === 'string' ? { fallback: icon } : { icon })

/** A menu taller than the room on either side scrolls instead of leaving the screen. */
const fit = (element: HTMLElement) => size({ padding: 8, apply: ({ availableHeight }) => void (element.style.maxHeight = `${Math.max(160, availableHeight)}px`) })

/** What had the focus when the sheet opened, to give it back when the sheet closes. */
let opener: HTMLElement | null = null
const isTextEntry = (el: HTMLElement) => el.matches('input, textarea, select, [contenteditable]')

/** The dimmed area closes the sheet only when the press began on it too (the long-press that opened the sheet ends there). */
let pressedBackdrop = false
function onBackdropClick() {
  if (pressedBackdrop) closeContextMenu()
  pressedBackdrop = false
}

watch(
  () => contextMenu.open,
  (open) => {
    if (open) {
      pressedBackdrop = false
      if (sheet.value && !opener) {
        const focused = document.activeElement
        opener = focused instanceof HTMLElement && focused !== document.body ? focused : null
      }
      return
    }
    const target = opener
    opener = null
    if (!target) return
    void nextTick(() => {
      // A dialog the choice opened may have the focus by now; and no keyboard pops up.
      if (document.activeElement && document.activeElement !== document.body) return
      if (target.isConnected && !isTextEntry(target)) target.focus({ preventScroll: true })
    })
  },
  { flush: 'sync' }
)

watch(
  () => [contextMenu.open, contextMenu.x, contextMenu.y],
  async () => {
    if (!contextMenu.open) return
    active.value = [-1, -1]
    sub.value = null
    level.value = 0
    await nextTick()
    const element = panels[0]
    if (!element) return
    if (sheet.value) return element.focus({ preventScroll: true })
    const point = { getBoundingClientRect: () => new DOMRect(contextMenu.x, contextMenu.y, 0, 0) }
    const { x, y } = await computePosition(point, element, { placement: 'bottom-start', middleware: [offset(2), flip(), fit(element), shift({ padding: 8 })] })
    Object.assign(element.style, { left: `${x}px`, top: `${y}px` })
    element.focus()
  }
)

let closeTimer: ReturnType<typeof setTimeout> | undefined

async function openSub(index: number, focus = false) {
  clearTimeout(closeTimer)
  if (sub.value !== index) {
    sub.value = index
    active.value = [active.value[0], -1]
    await nextTick()
    if (sheet.value) return
    const row = panels[0]?.querySelector<HTMLElement>(`[data-row="${index}"]`)
    const element = panels[1]
    if (!row || !element) return
    const { x, y } = await computePosition(row, element, { placement: 'right-start', middleware: [offset({ mainAxis: 6, crossAxis: -5 }), flip(), fit(element), shift({ padding: 8 })] })
    Object.assign(element.style, { left: `${x}px`, top: `${y}px` })
  }
  if (focus || sheet.value) {
    level.value = 1
    active.value = [index, reachable(1)[0] ?? -1]
  }
}

/** Moving to another row closes the submenu after a moment, so a diagonal path into it can cross rows. */
function closeSubSoon() {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(closeSub, 200)
}

/** The pointer reached the submenu: it stays. */
const holdSub = () => clearTimeout(closeTimer)

function closeSub() {
  clearTimeout(closeTimer)
  sub.value = null
  level.value = 0
  active.value = [active.value[0], -1]
}

function hover(at: number, i: number) {
  const next: [number, number] = [...active.value]
  next[at] = i
  active.value = next
  if (at) {
    clearTimeout(closeTimer)
    level.value = 1
    return
  }
  level.value = 0
  if (isSubmenu(contextMenu.items[i])) void openSub(i)
  else if (sub.value !== null) closeSubSoon()
}

async function choose(at: number, i: number) {
  const item = itemsOf(at)[i]
  if (!item) return
  if (isSubmenu(item)) return openSub(i, true)
  if (!isAction(item) || item.disabled) return
  if (item.keepOpen) {
    if (typeof item.checked === 'boolean') item.checked = !item.checked
    await item.run()
    return
  }
  closeContextMenu()
  await item.run()
}

type Colors = Extract<MenuItem, { kind: 'colors' }>
const swatches: (ColorName | null)[] = [null, ...colorNames]

async function pick(item: Colors, color: ColorName | null) {
  closeContextMenu()
  await item.pick(color)
}

function step(delta: number) {
  const at = level.value
  const list = reachable(at)
  if (!list.length) return
  const position = list.indexOf(active.value[at]!)
  const next: [number, number] = [...active.value]
  next[at] = list[(position + delta + list.length) % list.length]!
  active.value = next
  if (!at && sub.value !== null) closeSub()
}

function onKey(event: KeyboardEvent) {
  if (!contextMenu.open) return
  const at = level.value
  const current = active.value[at]!
  if (event.key === 'Escape') at ? closeSub() : closeContextMenu()
  else if (event.key === 'ArrowDown') step(1)
  else if (event.key === 'ArrowUp') step(-1)
  else if (event.key === 'ArrowRight' && !at && isSubmenu(contextMenu.items[current])) void openSub(current, true)
  else if (event.key === 'ArrowLeft' && at) closeSub()
  else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) void choose(at, current)
  else return
  // The menu owns these keys while open: the editor underneath must not also act on them.
  event.preventDefault()
  event.stopPropagation()
}

const inMenu = (target: EventTarget | null) => panels.some((panel) => panel?.contains(target as Node))

function onPointerDown(event: PointerEvent) {
  // A sheet closes from its dimmed backdrop, on the tap.
  if (contextMenu.open && !sheet.value && !inMenu(event.target)) closeContextMenu()
}

/** A phone's viewport changes size as its toolbars slide; the sheet stays. */
function onResize() {
  if (!sheet.value) closeContextMenu()
}

function onScroll(event: Event) {
  if (!inMenu(event.target)) closeContextMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', closeContextMenu)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  clearTimeout(closeTimer)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', closeContextMenu)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <Teleport to="body">
    <!-- A phone: one sheet; a submenu takes its place with a Back row. -->
    <template v-if="contextMenu.open && sheet">
      <div class="fixed inset-0 z-[54] bg-black/30" aria-hidden="true" data-menu-backdrop @pointerdown="pressedBackdrop = true" @pointercancel="pressedBackdrop = false" @click="onBackdropClick" />
      <div
        :ref="(el) => (panels[0] = el as HTMLElement | null)"
        tabindex="-1"
        role="menu"
        aria-modal="true"
        aria-label="Actions"
        class="fixed inset-x-0 z-[55] overflow-y-auto rounded-t-2xl border border-b-0 border-line bg-surface px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_24px_rgb(0_0_0/0.14)] outline-none"
        :style="{ bottom: `${keyboardInset}px`, maxHeight: sheetMaxHeight }"
        data-menu-sheet
        @contextmenu.prevent
      >
        <div class="mx-auto mb-1.5 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <button v-if="sheetLevel" class="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[15px] font-medium text-ink-soft" data-menu-back @click="closeSub">
          <AppIcon fallback="ph:caret-left" :size="16" /> {{ sub !== null && isSubmenu(contextMenu.items[sub]) ? (contextMenu.items[sub] as Submenu).label : 'Back' }}
        </button>
        <template v-for="(item, i) in itemsOf(sheetLevel)" :key="`${sheetLevel}-${i}`">
          <div v-if="item.kind === 'separator'" class="my-1 border-t border-line" />
          <div v-else-if="item.kind === 'heading'" class="truncate px-2.5 pb-1 pt-1.5 text-[13px] text-ink-faint">{{ item.label }}</div>
          <div v-else-if="item.kind === 'colors'" class="px-1.5 pb-1" :data-colors="item.sample">
            <div class="px-1 pb-1 pt-1.5 text-[13px] text-ink-faint">{{ item.label }}</div>
            <div class="grid grid-cols-[repeat(10,1fr)] gap-1">
              <button
                v-for="color in swatches"
                :key="color ?? 'none'"
                class="grid h-9 place-items-center rounded-md text-sm font-medium"
                :class="[
                  item.sample === 'text' ? (color ? blockTextClasses[color] : '') : color ? blockBackgroundClasses[color] : 'text-ink-faint',
                  item.current === color ? 'ring-2 ring-accent' : 'ring-1 ring-line',
                ]"
                :title="color ?? 'Default'"
                @click="pick(item, color)"
              >
                <AppIcon v-if="item.sample === 'background' && !color" fallback="ph:prohibit" :size="13" />
                <span v-else-if="item.sample === 'text'">A</span>
              </button>
            </div>
          </div>
          <button
            v-else
            :role="item.kind !== 'submenu' && typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'"
            :aria-checked="item.kind !== 'submenu' && typeof item.checked === 'boolean' ? item.checked : undefined"
            :aria-haspopup="item.kind === 'submenu' ? 'menu' : undefined"
            :data-row="i"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px] active:bg-hover disabled:opacity-40"
            :class="item.kind !== 'submenu' && item.danger ? 'text-red-600' : ''"
            :disabled="item.kind !== 'submenu' && item.disabled"
            @click="choose(sheetLevel, i)"
          >
            <AppIcon v-if="item.icon" v-bind="iconProps(item.icon)" :size="18" :class="item.kind !== 'submenu' && item.danger ? '' : 'text-ink-soft'" />
            <span v-else class="w-[18px]" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <AppIcon v-if="item.kind === 'submenu'" fallback="ph:caret-right" :size="14" class="text-ink-faint" />
            <span
              v-else-if="typeof item.checked === 'boolean'"
              class="ml-3 grid h-5 w-5 shrink-0 place-items-center rounded border"
              :class="item.checked ? 'border-ink bg-ink text-surface' : 'border-line-strong'"
            >
              <AppIcon v-if="item.checked" fallback="ph:check-bold" :size="12" />
            </span>
          </button>
        </template>
      </div>
    </template>
    <template v-else-if="contextMenu.open">
      <div
        v-for="at in levels"
        :key="at"
        :ref="(el) => (panels[at] = el as HTMLElement | null)"
        tabindex="-1"
        role="menu"
        class="fixed left-0 top-0 min-w-52 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/10 outline-none"
        :class="at ? 'z-[56] min-w-44' : 'z-[55]'"
        @contextmenu.prevent
        @mouseenter="at && holdSub()"
      >
        <template v-for="(item, i) in itemsOf(at)" :key="i">
          <div v-if="item.kind === 'separator'" class="my-1 border-t border-line" />
          <div v-else-if="item.kind === 'heading'" class="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{{ item.label }}</div>
          <div v-else-if="item.kind === 'colors'" class="px-1.5 pb-1" :data-colors="item.sample">
            <div class="px-1 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{{ item.label }}</div>
            <div class="grid w-60 grid-cols-[repeat(10,1fr)] gap-0.5">
              <button
                v-for="color in swatches"
                :key="color ?? 'none'"
                class="grid h-6 place-items-center rounded-md text-sm font-medium"
                :class="[
                  item.sample === 'text' ? (color ? blockTextClasses[color] : '') : color ? blockBackgroundClasses[color] : 'text-ink-faint',
                  item.current === color ? 'ring-2 ring-accent' : 'ring-1 ring-line hover:ring-line-strong',
                ]"
                :title="color ?? 'Default'"
                @click="pick(item, color)"
              >
                <AppIcon v-if="item.sample === 'background' && !color" fallback="ph:prohibit" :size="13" />
                <span v-else-if="item.sample === 'text'">A</span>
              </button>
            </div>
          </div>
          <button
            v-else
            :role="item.kind !== 'submenu' && typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'"
            :aria-checked="item.kind !== 'submenu' && typeof item.checked === 'boolean' ? item.checked : undefined"
            :aria-haspopup="item.kind === 'submenu' ? 'menu' : undefined"
            :aria-expanded="item.kind === 'submenu' ? sub === i : undefined"
            :data-row="i"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm disabled:opacity-40"
            :class="[item.kind !== 'submenu' && item.danger ? 'text-red-600' : '', active[at] === i || (!at && sub === i) ? 'bg-hover' : 'hover:bg-hover']"
            :disabled="item.kind !== 'submenu' && item.disabled"
            @mouseenter="hover(at, i)"
            @click="choose(at, i)"
          >
            <AppIcon v-if="item.icon" v-bind="iconProps(item.icon)" :class="item.kind !== 'submenu' && item.danger ? '' : 'text-ink-soft'" />
            <span v-else class="w-4" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <AppIcon v-if="item.kind === 'submenu'" fallback="ph:caret-right" :size="12" class="text-ink-faint" />
            <span
              v-else-if="typeof item.checked === 'boolean'"
              class="ml-3 grid h-4 w-4 shrink-0 place-items-center rounded border"
              :class="item.checked ? 'border-ink bg-ink text-surface' : 'border-line-strong'"
            >
              <AppIcon v-if="item.checked" fallback="ph:check-bold" :size="11" />
            </span>
            <span v-else-if="item.hint" class="pl-4 text-xs text-ink-faint [@media(hover:none)]:hidden">{{ item.hint }}</span>
          </button>
        </template>
      </div>
    </template>
  </Teleport>
</template>
