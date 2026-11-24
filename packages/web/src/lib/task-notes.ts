// A line added to an object's Notes from outside its page (Review's Waiting… note): a paragraph at
// the end of the text, written to the object's Y.Doc the way its page's editor does (the replica's
// copy, or the sync routes without one), so it merges with what others type. Undo removes it again
// by its block id; whatever else was written meanwhile stays.
import { BODY_PROPERTY_ID, type Id, type ObjectType } from '@vasta/core'
import { newBlockId, readContent, writeContent, type JsonDoc } from '@vasta/editor-schema/yjs'
import { openRemoteText } from './remote-text.ts'
import { openText, useReplica } from './replica.ts'

/** The rich-text field notes go in: Notes (`body`), else the type's first rich-text field. */
export function notesFieldOf(type: ObjectType | undefined): Id | undefined {
  const fields = type?.properties.filter((p) => p.kind === 'rich-text') ?? []
  return (fields.find((p) => p.id === BODY_PROPERTY_ID) ?? fields[0])?.id
}

/** Changes one text field of an object (its blocks, as JSON) and lets the session go, which also sends it. */
async function editText(objectId: Id, field: Id, change: (blocks: NonNullable<JsonDoc['content']>) => NonNullable<JsonDoc['content']>) {
  const session = useReplica() ? await openText(objectId) : await openRemoteText(objectId)
  try {
    const blocks = readContent(session.doc)[field]?.content ?? []
    writeContent(session.doc, { [field]: { type: 'doc', content: change(blocks) } }, undefined, [field])
  } finally {
    session.release()
  }
}

/** Adds `text` as a new last paragraph of the field; returns what takes it out again. */
export async function appendNote(objectId: Id, field: Id, text: string): Promise<() => Promise<void>> {
  const id = newBlockId()
  await editText(objectId, field, (blocks) => [...blocks, { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }])
  return () => editText(objectId, field, (blocks) => blocks.filter((block) => block.attrs?.id !== id))
}
