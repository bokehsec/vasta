<script setup lang="ts">
// One block of another object (an embed with `blockId`): a read-only copy that follows the
// original, shown by an editor that cannot be edited so it looks as it does there. "Open" goes to
// the block. Inside an embedded block another one is only a link, so a block cannot embed itself
// endlessly. Compact: just the block's content, without the frame (a group without its panel),
// and nothing at all while it is empty; the block menu's Open block replaces the header's Open.
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { blockAsDoc, findBlock, type DocNode, type ObjectRecord } from '@vasta/core'
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api } from '../lib/api.ts'
import { iconTextClasses } from '../lib/colors.ts'
import { onChange } from '../lib/events.ts'
import { displayTitle } from '../lib/format.ts'
import { BLOCK_EMBED_DEPTH } from '../lib/page.ts'
import { summaryOf, typesById } from '../lib/state.ts'
import { createExtensions } from './extensions.ts'
import { openObject } from '../lib/open.ts'

const props = defineProps<{ objectId: string; blockId: string; compact?: boolean }>()
const depth = inject(BLOCK_EMBED_DEPTH, 0)
provide(BLOCK_EMBED_DEPTH, depth + 1)

const object = ref<ObjectRecord>()
const failed = ref(false)
const summary = computed(() => summaryOf(props.objectId) ?? object.value)
const type = computed(() => typesById.value.get(summary.value?.typeId ?? ''))
const found = computed(() => (object.value ? findBlock(object.value, props.blockId) : undefined))
const open = () => openObject(props.objectId, { block: props.blockId })
/** Compact shows a group's content without its panel. */
const shown = computed(() => {
  const node = found.value?.node
  if (!node) return undefined
  return props.compact && node.type === 'group' ? { type: 'doc', content: node.content?.length ? node.content : [{ type: 'paragraph' }] } : blockAsDoc(node)
})
/** No text and nothing but empty paragraphs (and containers of them): a compact embed hides. */
const isEmpty = (node: DocNode): boolean =>
  node.type === 'text' ? !node.text?.trim() : (node.content?.length ? node.content.every(isEmpty) : ['paragraph', 'heading', 'group', 'doc'].includes(node.type))
/** Compact hides while loading and while the block is empty; a missing block still says so. */
const hidden = computed(() => props.compact && depth === 0 && !failed.value && (!object.value || (!!shown.value && isEmpty(shown.value as DocNode))))

async function load() {
  if (depth > 0) return
  try {
    object.value = await api.object(props.objectId)
    failed.value = false
  } catch {
    failed.value = true
  }
}
void load()
// The original changed (here, on another device, or by a capture): show it as it is now.
const stop = onChange((event) => {
  if (event.kind === 'object' && event.id === props.objectId) void load()
})

const editor = useEditor({
  editable: false,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  extensions: createExtensions(''),
  editorProps: { attributes: { class: 'vasta-doc' } },
})
watch(
  [shown, editor],
  ([doc, current]) => {
    if (doc && current) current.commands.setContent(doc, { emitUpdate: false })
  },
  { immediate: true }
)

// The block menu's Open block (a compact embed has no header) arrives as an event on the embed's
// block, the node view's wrapper.
const root = ref<HTMLElement>()
let wrapper: Element | null | undefined
const fromMenu = () => open()
onMounted(() => {
  wrapper = root.value?.closest('[data-node-view-wrapper]')
  wrapper?.addEventListener('vasta-block', fromMenu)
})

onBeforeUnmount(() => {
  wrapper?.removeEventListener('vasta-block', fromMenu)
  stop()
  editor.value?.destroy()
})
</script>

<template>
  <div v-if="compact" ref="root" data-testid="block-embed" :data-empty="hidden ? '' : undefined">
    <template v-if="!hidden">
      <EditorContent v-if="depth === 0 && found" :editor="editor" class="vasta-block-embed" />
      <button v-else-if="depth > 0" class="text-sm text-accent hover:underline" @click="open">A block of {{ displayTitle(summary, type) }}</button>
      <p v-else-if="failed || object" class="text-sm text-ink-faint">{{ failed ? 'This object cannot be opened.' : 'The block is not there any more.' }}</p>
    </template>
  </div>
  <div v-else ref="root" class="rounded-lg border border-line bg-surface" data-testid="block-embed">
    <div class="flex items-center gap-1.5 border-b border-line px-2.5 py-1 text-xs text-ink-faint">
      <AppIcon :icon="summary?.icon ?? type?.icon" fallback="ph:file-text" :size="13" :class="type?.color ? iconTextClasses[type.color] : ''" />
      <span class="min-w-0 truncate">{{ displayTitle(summary, type) }}</span>
      <button class="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink" title="Open the block where it is" @click="open">
        Open <AppIcon fallback="ph:arrow-up-right" :size="12" />
      </button>
    </div>
    <div class="px-3 py-1.5">
      <EditorContent v-if="depth === 0 && found" :editor="editor" class="vasta-block-embed" />
      <button v-else-if="depth > 0" class="text-sm text-accent hover:underline" @click="open">A block of {{ displayTitle(summary, type) }}</button>
      <p v-else-if="failed || object" class="text-sm text-ink-faint">{{ failed ? 'This object cannot be opened.' : 'The block is not there any more.' }}</p>
      <p v-else class="text-sm text-ink-faint">Loading…</p>
    </div>
  </div>
</template>
