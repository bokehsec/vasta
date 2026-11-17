<script setup lang="ts">
// Quick capture (the desktop app's global shortcut): a text goes into today's note of the user's
// capture space (Settings › Account), or the open space when none is set, as a captured item, like
// a Telegram message. Online the server takes it (links become
// weblinks); offline the local replica does, and it syncs later. "/" and a type's name make an
// object of that type instead ("/Book Dune author:x"), embedded in the note; "/" lists the types,
// and a relation's or a select's `name:` lists its objects or options. "/food …" logs what was
// eaten on today's note instead, offering the foods at the cursor. With Settings › Desktop app ›
// "Ask a template's questions", a "/Type …" line whose template asks something shows its
// questions before it saves (Esc goes back to the text). On a phone it also shows where the text
// goes, a Note / type picker (the types you make most, then More…; it writes the "/Type " prefix)
// and a Save capture button above the keyboard. An unsaved text is kept on this device as a draft
// for the next capture, written as you type and when the page is hidden, so a reload keeps it.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { foodCommand, type FilterGroup, type ObjectSummary, type ObjectType, type TemplateAsk } from '@vasta/core'
import { captureAsks, captureSpace, captureText, completionSource, dayKey, openCapture, typesOf } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { greyButton, mainButton } from '../lib/buttons.ts'
import { foodSourcesOf, previewFoodLine } from '../lib/nutrition.ts'
import { clearDraft, readDraft, usedTypes, withType, writeDraft, writtenText } from '../lib/capture-draft.ts'
import { isDesktop } from '../lib/platform.ts'
import { meId, people } from '../lib/people.ts'
import { session } from '../lib/session.ts'
import { notice, ui } from '../lib/state.ts'
import { offered, previewLine, typedLine, type Completion } from '../lib/typed-line.ts'
import { templates } from '../lib/templates.ts'
import { useCompletions } from '../lib/use-completions.ts'
import { isPhone, isTouch } from '../lib/viewport.ts'
import AppIcon from './AppIcon.vue'
import ModalDialog from './ModalDialog.vue'

const text = ref('')
const error = ref('')
const saving = ref(false)
const field = ref<HTMLTextAreaElement>()
const types = ref<ObjectType[]>([])
const cursor = ref(0)

const close = () => (ui.captureOpen = false)

const space = computed(captureSpace)
// The desktop app's captures go where Settings › Desktop app says (both off by default: the
// object alone, or a Page for plain text); the others always go to today's note.
const toDaily = computed(() => !isDesktop || ui.captureDaily)
const where = computed(() => (toDaily.value ? `today’s note in ${space.value?.name}` : space.value?.name))

// What was not saved is kept as a draft: put back here, written as you type (a moment after) and
// whenever the page is hidden or closed (an app reload keeps it), dropped once saved.
const draftRestored = ref(false)
const draftOwner = () => (session.user && space.value ? space.value.id : undefined)
{
  const owner = draftOwner()
  const draft = owner ? readDraft(owner) : ''
  if (draft) {
    text.value = draft
    draftRestored.value = true
  }
}
let saved = false

/** The text as the draft (a picked type alone is not one); a saved capture leaves none. */
function keepDraft() {
  const owner = draftOwner()
  if (owner && !saved) writeDraft(owner, writtenText(types.value, text.value) ? text.value : '')
}
let typing: ReturnType<typeof setTimeout> | undefined
watch(text, () => {
  clearTimeout(typing)
  typing = setTimeout(keepDraft, 500)
})
const onHidden = () => document.visibilityState === 'hidden' && keepDraft()
document.addEventListener('visibilitychange', onHidden)
window.addEventListener('pagehide', keepDraft)
// Also when the capture goes away with its page (Back on a desktop).
onBeforeUnmount(() => {
  clearTimeout(typing)
  keepDraft()
  document.removeEventListener('visibilitychange', onHidden)
  window.removeEventListener('pagehide', keepDraft)
})

function discardDraft() {
  const owner = draftOwner()
  if (owner) clearDraft(owner)
  draftRestored.value = false
  text.value = ''
  field.value?.focus()
}

/** After a save: no draft is left behind. */
function done() {
  saved = true
  const owner = draftOwner()
  if (owner) clearDraft(owner)
  close()
}

// The phone's picker: the types made most in the last 90 days first, the others under More…
const created = ref<{ typeId: string }[]>([])
const moreTypes = ref(false)

onMounted(async () => {
  await nextTick()
  field.value?.focus()
  if (!space.value) return
  types.value = await typesOf(space.value).catch(() => [])
  if (isPhone.value) created.value = await recentlyCreated(space.value.id)
})

/** What was made in the last 90 days, for the types worth a chip. */
function recentlyCreated(spaceId: string): Promise<{ typeId: string }[]> {
  const filter: FilterGroup = { kind: 'group', operator: 'and', items: [{ kind: 'filter', field: 'createdAt', operator: 'after', value: { kind: 'variable', name: 'today', offsetDays: -90 } }] }
  return api.query(spaceId, { query: { typeIds: [], filter }, today: dayKey(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => [])
}

const source = computed(() => (space.value ? completionSource(space.value.id, types.value) : undefined))
const { shown, active, dismiss, move, current } = useCompletions(text, cursor, () => source.value)
const readCursor = () => (cursor.value = field.value?.selectionStart ?? text.value.length)
watch(text, () => nextTick(readCursor))

const typed = computed(() => typedLine(types.value, text.value))

// The phone's picker: the types a line can make, "Note" when the text names none. The ones made
// most lately show first, the rest under More…
const pickable = computed(() => types.value.filter(offered))
const chips = computed(() => usedTypes(pickable.value, created.value, typed.value?.type))
const destination = computed(() => {
  const name = space.value?.name ?? ''
  if (eaten.value !== undefined) return `Food log · ${name}`
  return typed.value ? `${typed.value.type.name} in ${name}` : toDaily.value ? `Today’s note · ${name}` : `Page in ${name}`
})
const hasText = computed(() => !!writtenText(types.value, text.value) || (eaten.value !== undefined && !!text.value.trim()))

async function pickType(type?: ObjectType) {
  text.value = withType(types.value, text.value, type)
  await nextTick()
  field.value?.focus()
  field.value?.setSelectionRange(text.value.length, text.value.length)
  cursor.value = text.value.length
}
const preview = computed(() => (typed.value ? previewLine(typed.value.type, typed.value.rest, dayKey(), people.list, meId(), space.value?.id === templates.spaceId ? templates.list : []) : undefined))

// A line of food: what it will log, against the space's foods (loaded once one is typed).
const eaten = computed(() => foodCommand(text.value))
const foods = ref<ObjectSummary[] | null>(null)
watch(eaten, async (value) => {
  if (value === undefined || foods.value) return
  foods.value = []
  foods.value = await foodSourcesOf(types.value).catch(() => [])
})
const foodPreview = computed(() => (eaten.value !== undefined && space.value ? previewFoodLine(eaten.value, space.value, foods.value ?? [], dayKey()) : undefined))

async function pick(item: Completion) {
  text.value = item.text
  await nextTick()
  field.value?.focus()
  field.value?.setSelectionRange(item.cursor, item.cursor)
  cursor.value = item.cursor
}

// The template's questions, once save found some open; answered before saving again.
const asks = ref<TemplateAsk[] | null>(null)
const answers = reactive<Record<string, string>>({})
const questions = ref<HTMLElement>()

async function ask(pending: TemplateAsk[]) {
  for (const key of Object.keys(answers)) delete answers[key]
  for (const a of pending) answers[a.label] = a.options?.[0] ?? ''
  asks.value = pending
  await nextTick()
  questions.value?.querySelector<HTMLElement>('input, button')?.focus()
}

function backToText() {
  asks.value = null
  void nextTick(() => field.value?.focus())
}

/** Save; with `open` (Ctrl+Enter), then open what it made: the new object, else today's note. */
async function save(open = false) {
  if (!text.value.trim() || !space.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    if (!asks.value) {
      const pending = await captureAsks(text.value).catch(() => [])
      if (pending.length) return void (await ask(pending))
    }
    const { space: saved, answer, food, made } = await captureText(text.value, isDesktop ? 'desktop' : 'app', asks.value ? { ...answers } : undefined)
    if (open) {
      done()
      await openCapture(saved, answer, made)
      return
    }
    if (food) {
      notice.value = { message: food.summary.replace(/\n/g, ' ') }
      done()
      return
    }
    const unread = answer.unreadable?.length ? ` Could not read ${answer.unreadable.join('; ')}.` : ''
    const destination = answer.dailyNoteId ? `today’s note in ${saved.name}` : saved.name
    notice.value = { message: `${answer.summary || 'Capture saved'} in ${destination}.${unread}` }
    done()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
  } finally {
    saving.value = false
  }
}

/** Keys in the questions: Enter saves, Ctrl+Enter saves and opens, Esc goes back to the text. */
function onQuestionKey(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    backToText()
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement && !event.ctrlKey)) {
    event.preventDefault()
    void save(event.ctrlKey)
  }
}

function pickAnswer(label: string, option: string, event?: KeyboardEvent) {
  answers[label] = option
  if (event) void save(event.ctrlKey)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.ctrlKey && !event.isComposing) {
    event.preventDefault()
    void save(true)
    return
  }
  if (shown.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void pick(current()!)
      return
    }
    if (event.key === 'Escape') {
      // Puts the list away; the next Esc closes the dialog.
      event.preventDefault()
      dismiss()
      return
    }
  }
  // Enter saves; Ctrl+Enter saves and opens; Shift+Enter starts a new line (on a phone, Enter does,
  // and the Save capture button saves).
  if (!isPhone.value && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void save()
  }
}
</script>

<template>
  <ModalDialog title="Quick capture" width="34rem" @close="close">
    <template #icon><AppIcon fallback="ph:lightning" class="text-ink-soft" /></template>
    <template v-if="isPhone && !asks">
      <p class="text-sm text-ink-soft" data-testid="capture-destination">{{ destination }}</p>
      <div class="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" role="radiogroup" aria-label="Save as" data-testid="capture-types">
        <button
          class="min-h-11 rounded-lg border px-3 text-sm"
          role="radio"
          :aria-checked="!typed"
          :class="!typed ? 'border-line-strong bg-hover text-ink' : 'border-line text-ink-soft'"
          @click="pickType()"
        >
          Note
        </button>
        <button
          v-for="type in moreTypes ? pickable : chips.shown"
          :key="type.id"
          class="min-h-11 rounded-lg border px-3 text-sm"
          role="radio"
          :aria-checked="typed?.type.id === type.id"
          :class="typed?.type.id === type.id ? 'border-line-strong bg-hover text-ink' : 'border-line text-ink-soft'"
          @click="pickType(type)"
        >
          {{ type.name }}
        </button>
        <button v-if="!moreTypes && chips.more.length" class="min-h-11 rounded-lg border border-dashed border-line px-3 text-sm text-ink-soft" data-testid="capture-more" @click="moreTypes = true">More…</button>
      </div>
      <div class="mt-2" />
    </template>
    <p v-if="draftRestored && !asks" class="mb-2 text-xs text-ink-faint" data-testid="capture-draft">
      Draft restored ·
      <button class="inline-flex items-center px-1 text-ink-soft underline max-md:min-h-11" @click="discardDraft">Discard</button>
    </p>
    <div v-if="asks" ref="questions" class="space-y-3" data-testid="capture-questions" @keydown="onQuestionKey">
      <p class="truncate text-sm text-ink-soft">{{ text.split('\n')[0] }}</p>
      <div v-for="item in asks" :key="item.label">
        <p class="mb-1 text-xs text-ink-faint">{{ item.label }}</p>
        <div v-if="item.options?.length" class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="item.label">
          <button
            v-for="option in item.options"
            :key="option"
            role="radio"
            :aria-checked="answers[item.label] === option"
            class="rounded-lg border px-2.5 py-1 text-sm"
            :class="answers[item.label] === option ? 'border-line-strong bg-hover text-ink' : 'border-line text-ink-soft hover:bg-hover'"
            @click="pickAnswer(item.label, option)"
            @keydown.enter.prevent="pickAnswer(item.label, option, $event)"
          >
            {{ option }}
          </button>
        </div>
        <input v-else v-model="answers[item.label]" class="w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-line-strong" />
      </div>
      <p v-if="!isTouch" class="text-xs text-ink-faint">Enter saves, Ctrl+Enter saves and opens it, Esc goes back to the text.</p>
    </div>
    <textarea
      v-else
      ref="field"
      v-model="text"
      :rows="isPhone ? 6 : 4"
      class="w-full resize-none rounded-xl border border-line bg-raised px-3 py-2.5 outline-none focus:border-line-strong"
      placeholder="A thought, a link, a task… or / for an object of a type"
      @keydown="onKey"
      @keyup="readCursor"
      @click="readCursor"
    />
    <div v-if="!asks && shown.length" class="mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1" role="listbox" aria-label="Suggestions">
      <button
        v-for="(item, i) in shown"
        :key="`${i}-${item.label}`"
        role="option"
        :aria-selected="i === active"
        class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm"
        :class="i === active ? 'bg-hover' : ''"
        @mouseenter="active = i"
        @mousedown.prevent="pick(item)"
      >
        <AppIcon :icon="item.icon" fallback="ph:cube" :size="16" class="text-ink-soft" />
        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
        <span v-if="item.detail" class="shrink-0 text-xs text-ink-faint">{{ item.detail }}</span>
      </button>
    </div>
    <p v-if="error && !isPhone" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <template v-if="asks" />
    <div v-else-if="foodPreview" class="mt-2 space-y-0.5 text-xs text-ink-faint" data-testid="capture-preview">
      <p class="text-ink-soft">{{ foodPreview.text }}</p>
      <p v-if="foodPreview.problem" class="text-amber-700 dark:text-amber-400">{{ foodPreview.problem }}</p>
    </div>
    <div v-else-if="typed && preview" class="mt-2 space-y-0.5 text-xs text-ink-faint" data-testid="capture-preview">
      <p>
        <span class="text-ink-soft">New {{ typed.type.name }}</span>
        <template v-if="preview.title"> “{{ preview.title }}”</template>
        <template v-if="preview.template"> · from {{ preview.template }}</template>
        <template v-if="preview.parts.length"> · {{ preview.parts.join(', ') }}</template>
        <span>, in {{ where }}.</span>
        <span v-if="!isPhone && !isTouch"> Ctrl+Enter saves and opens it.</span>
      </p>
      <p v-if="preview.errors.length" class="text-amber-700 dark:text-amber-400">Cannot read {{ preview.errors.join('; ') }}; it stays in the title.</p>
      <p v-else-if="!preview.parts.length && preview.properties.length">name:value sets {{ preview.properties.join(', ') }}.</p>
    </div>
    <p v-else-if="!isPhone" class="mt-2 text-xs text-ink-faint">{{ toDaily ? `Goes to today’s note in ${space?.name}` : ui.captureInbox ? `Goes to the inbox of ${space?.name}` : `Saved as a page in ${space?.name}` }}.<template v-if="!isTouch"> Enter saves, Ctrl+Enter saves and opens it, Shift+Enter adds a line.</template></p>
    <template v-if="isPhone" #footer>
      <div class="flex w-full flex-col gap-1">
        <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        <button class="w-full" :class="mainButton" :disabled="!hasText || saving" @click="save()">
          {{ saving ? 'Saving…' : 'Save capture' }}
        </button>
        <div class="flex gap-2">
          <button v-if="asks" class="flex-1" :class="greyButton" @click="backToText">Back</button>
          <button class="flex-1" :class="greyButton" @click="close">Cancel</button>
        </div>
      </div>
    </template>
    <template v-else #footer>
      <button v-if="asks" :class="greyButton" @click="backToText">Back</button>
      <button class="ml-auto" :class="greyButton" @click="close">Cancel</button>
      <button :class="mainButton" :disabled="!text.trim() || saving" @click="save()">Capture</button>
    </template>
  </ModalDialog>
</template>
