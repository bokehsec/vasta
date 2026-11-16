<script setup lang="ts">
// The quick card: a type page's New makes one of its objects here, without leaving the list. A
// large title, an optional note (the type's text) and its fields as a row of chips; nothing is
// made until it is added, so Cancel, Esc or a click outside leave nothing behind. Enter adds it
// and the card stays for the next one ("Added …", with Open and Undo); ⌘↩ or Open adds it and
// opens it in the window. On a phone it is a sheet from the bottom, above the keyboard.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Doc, ObjectRecord, ObjectType, PropertyDef, PropertyValue } from '@vasta/core'
import { createObject, deleteObjectFlow } from '../lib/actions.ts'
import { closesOnBack } from '../lib/back.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
import { openObject } from '../lib/open.ts'
import { sharedSpace } from '../lib/people.ts'
import { kindIcon } from '../lib/properties.ts'
import { isPhone, keyboardInset, sheetMaxHeight } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import PropertyValueEditor from './PropertyValueEditor.vue'
import SheetGrabber from './SheetGrabber.vue'
import TypeIcon from './TypeIcon.vue'

const props = defineProps<{ type: ObjectType }>()
const emit = defineEmits<{ close: [] }>()

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
const values = ref<Record<string, PropertyValue | undefined>>({})
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
    const data: Partial<ObjectRecord> = { title: title.value.trim(), ...(Object.keys(filled).length ? { props: filled } : {}) }
    if (note.value.trim() && noteField.value) data.content = { [noteField.value.id]: noteDoc(note.value.trim()) }
    const object = await createObject(props.type.id, data, open)
    if (open) return emit('close')
    added.value = { id: object.id, title: object.title }
    title.value = ''
    note.value = ''
    noteOpen.value = false
    values.value = {}
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

// Escape closes it wherever the focus is (after Undo it may be nowhere); a field's picker, open
// over it, handles its own Escape first.
function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) emit('close')
}

closesOnBack(() => true, () => emit('close'))
onMounted(() => {
  window.addEventListener('keydown', onEscape)
  titleInput.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 flex bg-black/25 dark:bg-black/45"
      :class="isPhone ? 'items-end' : 'items-start justify-center px-4 pt-[16vh]'"
      data-quick-add
      @mousedown.self="emit('close')"
      @keydown="onCardKey"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="`New ${typeName}`"
        :aria-busy="busy || undefined"
        class="flex w-full flex-col overflow-hidden border border-line bg-surface shadow-[0_2px_6px_rgb(0_0_0/0.06),0_18px_48px_-12px_rgb(0_0_0/0.28)] dark:border-line-strong"
        :class="isPhone ? 'rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]' : 'max-w-[36rem] rounded-2xl'"
        :style="isPhone ? { marginBottom: `${keyboardInset}px`, maxHeight: sheetMaxHeight } : undefined"
      >
        <SheetGrabber v-if="isPhone" @close="emit('close')" />
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
          <span class="flex-1" />
          <span class="text-xs text-ink-faint max-lg:hidden">↵ add · ⌘↵ add and open</span>
          <button v-if="!isPhone" type="button" :class="greyButton" @click="emit('close')">Cancel</button>
          <button type="button" :class="greyButton" :disabled="!canAdd" title="Add and open (⌘↩)" data-quick-add-open @click="add(true)">
            <AppIcon fallback="ph:arrows-out-simple" :size="14" />Open
          </button>
          <button type="button" :class="mainButton" class="max-md:min-w-28" :disabled="!canAdd" data-quick-add-save @click="add(false)">Add {{ typeName }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
