<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFAULT_PHONE_MENU, PHONE_MENU_LIMIT, type PhoneMenuItem } from '../../lib/phone-menu.ts'
import { phoneMenu, phonePlaces } from '../../lib/phone-places.ts'
import AppIcon from '../AppIcon.vue'
import { label, secondary } from './styles.ts'

// A type another space has keeps its place here, named as it was saved (its name, lowercased).
const selected = computed(() => phoneMenu.value.map((id) => phonePlaces.value.find((place) => place.id === id) ?? {
  id, label: `${id === 'tasks' ? 'Tasks' : id.slice(5)} (not in this space)`, fallback: 'ph:shapes',
}))
const available = computed(() => phonePlaces.value.filter((place) => !phoneMenu.value.includes(place.id)))
const announcement = ref('')
function remove(id: PhoneMenuItem) {
  if (phoneMenu.value.length > 1) phoneMenu.value = phoneMenu.value.filter((item) => item !== id)
}
function move(index: number, offset: number) {
  const items = [...phoneMenu.value]
  const target = index + offset
  if (target < 0 || target >= items.length) return
  const item = items[index]!
  items[index] = items[target]!
  items[target] = item
  announcement.value = `${selected.value[index]!.label}, position ${target + 1} of ${items.length}`
  phoneMenu.value = items
}
function add(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value && phoneMenu.value.length < PHONE_MENU_LIMIT && available.value.some((place) => place.id === select.value)) {
    phoneMenu.value = [...phoneMenu.value, select.value as PhoneMenuItem]
  }
  select.value = ''
}
</script>

<template>
  <!-- Yours on every device (an account preference), so a computer can set the phone's bar too. -->
  <div id="phone-menu" role="group" aria-labelledby="phone-menu-title">
    <span id="phone-menu-title" :class="label">Phone bottom menu</span>
    <p class="mt-1 mb-2 text-sm text-ink-soft">Up to five places, in this order. Yours on every device, the same in every space; a type shows in the spaces that have it.</p>
    <ol class="divide-y divide-line rounded-lg border border-line" aria-label="Phone menu items">
      <li v-for="(place, index) in selected" :key="place.id" class="flex min-h-12 items-center gap-2 px-2" :data-phone-menu-item="place.id">
        <AppIcon :icon="place.icon" :fallback="place.fallback" :size="20" />
        <span class="min-w-0 flex-1 break-words text-sm">{{ place.label }}</span>
        <button class="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-hover aria-disabled:opacity-30" :aria-label="`Move ${place.label} earlier`" :aria-disabled="index === 0" @click="move(index, -1)"><AppIcon fallback="ph:arrow-up" :size="18" /></button>
        <button class="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-hover aria-disabled:opacity-30" :aria-label="`Move ${place.label} later`" :aria-disabled="index === selected.length - 1" @click="move(index, 1)"><AppIcon fallback="ph:arrow-down" :size="18" /></button>
        <button class="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-hover disabled:opacity-30" :aria-label="`Remove ${place.label}`" :disabled="selected.length === 1" @click="remove(place.id)"><AppIcon fallback="ph:x" :size="18" /></button>
      </li>
    </ol>
    <p role="status" class="sr-only">{{ announcement }}</p>
    <p class="mt-2 text-xs text-ink-soft">{{ selected.length }} of {{ PHONE_MENU_LIMIT }} items. Keep at least one. Use the arrows to change the order.</p>
    <label class="mt-4 block text-sm">
      Add an item
      <select class="mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2" aria-label="Add phone menu item" :disabled="selected.length >= PHONE_MENU_LIMIT || !available.length" @change="add">
        <option value="">{{ selected.length >= PHONE_MENU_LIMIT ? 'Remove an item to make room' : 'Choose an item…' }}</option>
        <option v-for="place in available" :key="place.id" :value="place.id">{{ place.label }}</option>
      </select>
    </label>
    <p class="mt-3 text-xs text-ink-soft">The top-left menu still opens all your places and Settings. Capture stays above the bottom menu.</p>
    <button :class="secondary" class="mt-3 min-h-11" @click="phoneMenu = [...DEFAULT_PHONE_MENU]">Reset to defaults</button>
  </div>
</template>
