<script setup lang="ts">
// The quick card: a New of a type (lib/new-item.ts) makes one of its objects here, without leaving
// the list. A large title, an optional note (the type's text) and its fields as a row of chips;
// nothing is made until it is added, so Cancel, Esc, Back or a tap outside leave nothing behind.
// Enter adds it and the card stays for the next one ("Added …", with Open and Undo); ⌘↩ or Open adds
// it and opens it in the window. It starts with where it was made from (`initial`: the view's
// filter, Mine, the group). On a phone it is a sheet from the bottom, above the keyboard.
import { computed, nextTick, onMounted, ref } from 'vue'
import type { Doc, NewItemValues, ObjectRecord, ObjectType, PropertyDef, PropertyValue } from '@vasta/core'
import { createObject, deleteObjectFlow } from '../lib/actions.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
import { openObject } from '../lib/open.ts'
import { sharedSpace } from '../lib/people.ts'
import { kindIcon } from '../lib/properties.ts'
import { isPhone } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'
import TypeIcon from './TypeIcon.vue'

// `initial`: what the fields start with (and go back to after each add): so what is made shows
// where it was made from. `capture`: offers "Capture a note instead" (the phone's "+").
const props = defineProps<{ type: ObjectType; initial?: NewItemValues; capture?: boolean }>()
const emit = defineEmits<{ close: []; capture: [] }>()

// The fields a row can hold, as on the object's page: not text blocks or formulas, nor fields
// shown only once they have a value (a person field in a space nobody else is in among them).
const fields = computed(() =>
  props.type.properties.filter((p) => p.kind !== 'rich-text' && p.kind !== 'formula' && !p.hideWhenEmpty && !(p.kind === 'person' && !sharedSpace.value))
)
/** The type's (first) text, where the note goes. */
const noteField = computed(() => props.type.properties.find((p) => p.kind === 'rich-text'))
const icons: Partial<Record<PropertyDef['kind'], string>> = { date: 'ph:calendar-blank', select: 'ph:circle-dashed', relation: 'ph:arrow-elbow-down-right', checkbox: 'ph:check-square' }
const fieldIcon = (def: PropertyDef) => icons[def.kind] ?? kindIcon(def.kind)

const title = ref('')
const note = ref('')
const noteOpen = ref(false)
const values = ref<Record<string, PropertyValue | undefined>>({ ...props.initial?.props })
const titleInput = ref<HTMLTextAreaElement | null>(null)
const noteInput = ref<HTMLTextAreaElement | null>(null)
const busy = ref(false)
const error = ref('')
/** The last one added while the card stayed open. */
const added = ref<{ id: string; title: string } | null>(null)

const typeName = computed(() => props.type.name.toLowerCase())
const canAdd = computed(() => !!title.value.trim() && !busy.value)

function noteDoc(text: string): Doc {
  const lines = text.split('\n')
  return { type: 'doc', content: lines.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) }
}

async function add(open: boolean) {
  if (!canAdd.value) return
  busy.value = true
  error.value = ''
  try {
    const filled = Object.fromEntries(Object.entries(values.value).filter(([, value]) => value !== undefined)) as Record<string, PropertyValue>
    const data: Partial<ObjectRecord> = { title: title.value.trim(), ...(Object.keys(filled).length ? { props: filled } : {}), ...(props.initial?.tagIds.length ? { tagIds: props.initial.tagIds } : {}) }
    if (note.value.trim() && noteField.value) data.content = { [noteField.value.id]: noteDoc(note.value.trim()) }
    const object = await createObject(props.type.id, data, open)
    if (open) return emit('close')
    added.value = { id: object.id, title: object.title }
    title.value = ''
    note.value = ''
    noteOpen.value = false
    values.value = { ...props.initial?.props }
    await nextTick()
    titleInput.value?.focus()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function openAdded() {
  const made = added.value
  if (!made) return
  emit('close')
  await openObject(made.id, { where: 'popup' })
}

async function undoAdded() {
  const made = added.value
  if (!made) return
  added.value = null
  await deleteObjectFlow(made.id)
  titleInput.value?.focus()
}

async function showNote() {
  noteOpen.value = true
  await nextTick()
  noteInput.value?.focus()
}

function setProp(def: PropertyDef, value: PropertyValue | undefined) {
  values.value = { ...values.value, [def.id]: value }
}

function onTitleKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void add(event.metaKey || event.ctrlKey)
  }
}

/** ⌘↩ from anywhere in the card (a note, a field) adds and opens, as in the title. */
function onCardKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.defaultPrevented) {
    event.preventDefault()
    void add(true)
  }
}

onMounted(() => titleInput.value?.focus())
</script>

<template>
  <BottomSheet :label="`New ${typeName}`" flush layer="surface" desktop="top" width="36rem" :aria-busy="busy || undefined" data-quick-add @close="emit('close')" @keydown="onCardKey">
    <div v-if="added" class="flex items-center gap-2 border-b border-line bg-raised px-4 py-2 text-[13px] text-ink-soft max-md:text-sm" role="status" data-quick-add-added>
      <AppIcon fallback="ph:check-circle" :size="15" class="shrink-0 text-green-600 dark:text-green-400" />
      <span class="min-w-0 truncate">Added “{{ added.title }}”</span>
      <span class="flex-1" />
      <button class="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover max-md:min-h-11 max-md:px-2.5" @click="openAdded">Open</button>
      <button class="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover max-md:min-h-11 max-md:px-2.5" @click="undoAdded">Undo</button>
    </div>

    <div class="min-h-0 overflow-y-auto px-[18px] pb-3.5 pt-4 max-md:px-4 max-md:pt-2.5">
      <textarea
        ref="titleInput"
        v-model="title"
        rows="1"
        data-large-text
        class="block w-full resize-none bg-transparent text-xl font-semibold leading-snug tracking-[-0.01em] text-ink outline-none [field-sizing:content] placeholder:text-ink-faint"
        :placeholder="`${type.name} title`"
        :aria-label="`${type.name} title`"
        data-quick-add-title
        :readonly="busy"
        @keydown="onTitleKey"
      />
      <template v-if="noteField">
        <textarea
          v-if="noteOpen"
          ref="noteInput"
          v-model="note"
          rows="2"
          class="mt-1.5 block w-full resize-none bg-transparent text-sm leading-relaxed text-ink outline-none [field-sizing:content] placeholder:text-ink-faint max-md:text-base"
          placeholder="A note"
          aria-label="Note"
          data-quick-add-note
        />
        <button v-else class="mt-1 flex items-center gap-1.5 rounded-md py-0.5 text-sm text-ink-faint hover:text-ink max-md:min-h-11 max-md:text-[15px]" @click="showNote">
          <AppIcon fallback="ph:text-align-left" :size="14" />Add a note
        </button>
      </template>

      <div
        v-if="fields.length"
        class="mt-3.5 flex gap-1.5"
        :class="isPhone ? '-mx-4 overflow-x-auto px-4 [scrollbar-width:none]' : 'flex-wrap'"
      >
        <div
          v-for="def in fields"
          :key="def.id"
          class="flex h-8 shrink-0 items-center rounded-lg pl-2.5 text-[13px] ring-1 ring-inset ring-line max-md:h-11 max-md:text-[15px] [&_button]:min-h-0 [&_button]:py-0.5"
          :class="[values[def.id] ? 'text-ink' : 'text-ink-soft', def.kind === 'text' || def.kind === 'number' || def.kind === 'url' ? 'w-40' : '']"
          :title="def.name"
          :data-quick-add-field="def.name"
        >
          <AppIcon :fallback="fieldIcon(def)" :size="14" class="shrink-0 text-ink-faint" />
          <PropertyValueEditor :def="def" :value="values[def.id]" :placeholder="def.name" @update="setProp(def, $event)" />
          <span v-if="def.kind === 'checkbox'" class="pr-2.5">{{ def.name }}</span>
        </div>
      </div>
      <p v-if="error" class="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </div>

    <div class="flex items-center gap-2 border-t border-line bg-raised px-3 py-2.5 max-md:px-4 max-md:py-3">
      <span class="flex min-w-0 items-center gap-1.5 pl-1 text-sm text-ink-soft max-md:hidden">
        <TypeIcon :icon="type.icon" :color="type.color" fallback="ph:cube" :size="14" />{{ type.name }}
      </span>
      <button v-if="capture" type="button" class="min-h-11 shrink-0 rounded-md px-1 text-sm text-ink-soft underline md:hidden" data-quick-add-capture @click="emit('capture')">Capture a note instead</button>
      <span class="flex-1" />
      <span class="text-xs text-ink-faint max-lg:hidden">↵ add · ⌘↵ add and open</span>
      <button v-if="!isPhone" type="button" :class="greyButton" @click="emit('close')">Cancel</button>
      <button type="button" :class="greyButton" :disabled="!canAdd" title="Add and open (⌘↩)" data-quick-add-open @click="add(true)">
        <AppIcon fallback="ph:arrows-out-simple" :size="14" />Open
      </button>
      <button type="button" :class="mainButton" class="max-md:min-w-28" :disabled="!canAdd" data-quick-add-save @click="add(false)">Add {{ typeName }}</button>
    </div>
  </BottomSheet>
</template>
