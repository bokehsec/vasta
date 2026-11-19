// The same small picker serves /Widget and the button below your Home. Only insertion creates
// Query objects; browsing the menu never changes the page or the space.
import type { Editor, Range } from '@tiptap/core'
import type { Doc, DocNode } from '@vasta/core'
import { createObject, tagFromPath } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { openMenuAt, type MenuItem } from '../lib/overlays.ts'
import { pickObject } from '../lib/pick.ts'
import { lastError, systemType, workspace } from '../lib/state.ts'
import { homeColumns, widgetBlocks, widgetPresets, type WidgetPreset } from '../lib/widgets.ts'

export async function openWidgetPicker(editor: Editor, range: Range, at: { x: number; y: number }, layout = false) {
  try {
    const space = workspace.space
    if (!space || !editor.isEditable) return
    const habitType = systemType('habit')
    const habits = habitType ? await api.objectsOfType(habitType.id) : []
    if (editor.isDestroyed || workspace.space?.id !== space.id) return
    const presets = widgetPresets({ types: workspace.types, space, hasHabits: habits.length > 0 })
    const insert = async (preset: WidgetPreset) => {
      try {
        if (editor.isDestroyed || workspace.space?.id !== space.id) return
        const queryType = systemType('query')
        let block: DocNode
        let name = preset.name
        if (preset.pick === 'embed') {
          editor.chain().focus().insertContentAt(range, widgetBlocks('Page or block', { type: 'paragraph', content: [{ type: 'text', text: '@@' }] })).run()
          return
        }
        if (preset.kind) block = { type: 'widget', attrs: { kind: preset.kind } }
        else {
          if (!queryType) return
          let query = widgetPresets({ types: workspace.types, space: workspace.space!, hasHabits: habits.length > 0 }).find((p) => p.id === preset.id)?.query
          if (preset.pick === 'query') {
            const picked = await pickObject({ title: 'Saved query', typeIds: [queryType.id] })
            if (!picked) return
            const source = await api.object(picked.id)
            query = source.query
            name = source.title || 'Saved query'
          }
          if (preset.id === 'pinned') {
            const tag = await tagFromPath('home')
            if (!tag) throw new Error('This space has no Tag type.')
            query = widgetPresets({ types: workspace.types, space, hasHabits: false, homeTagId: tag.id }).find((p) => p.id === 'pinned')!.query
          }
          if (!query || editor.isDestroyed || workspace.space?.id !== space.id) return
          const made = await createObject(queryType.id, { title: `Home · ${name}`, query }, false)
          block = { type: 'objectEmbed', attrs: { objectId: made.id, display: 'compact' } }
        }
        if (!editor.isDestroyed) editor.chain().focus().insertContentAt(range, widgetBlocks(name, block)).run()
      } catch (error) { lastError.value = (error as Error).message }
    }
    const items: MenuItem[] = [{ kind: 'heading', label: 'Add widget' }, ...presets.map((p) => ({ label: p.name, icon: p.icon, run: () => insert(p) }))]
    if (layout) {
      const columns = editor.getJSON().content?.some((node) => node.type === 'columns') ?? false
      items.push({ kind: 'separator' }, { label: columns ? 'One column' : 'Two columns', icon: 'ph:columns', run: () => {
        if (!editor.isDestroyed) {
          const next = homeColumns(editor.getJSON() as Doc, !columns)
          // Replace through a transaction: collaboration and Undo see an ordinary text edit.
          editor.chain().focus().insertContentAt({ from: 0, to: editor.state.doc.content.size }, next.content).run()
        }
      } })
    }
    openMenuAt(at.x, at.y, items)
  } catch (error) { lastError.value = (error as Error).message }
}
