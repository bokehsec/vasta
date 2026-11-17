// The menu of one object in a list, table, board or query (a right-click; a long press or the ⋯ on
// a phone): open it, copy its link, pin it, its quick actions and steps while it is open, and move it
// to the trash. One menu for every place that lists objects, so what a row offers does not depend on
// where it is shown; only what the place cannot change is left out (`readonly`).
import type { Id, ObjectRecord, ObjectSummary, ObjectType } from '@vasta/core'
import { deleteObjectFlow, pinMenu, setProperties } from './actions.ts'
import { displayTitle } from './format.ts'
import { copyObjectLink, openObject } from './open.ts'
import type { MenuItem } from './overlays.ts'
import { quickActionMenuItems } from './quick-actions.ts'
import { subtaskMenuItems } from './subtasks.ts'

export interface RowMenuHost {
  /** The type of the object (each object's own: a query spans types). */
  type: ObjectType | undefined
  /** Nothing changes from here (a whiteboard card, a page that cannot be edited): no quick actions, steps or trash. */
  readonly?: boolean
  /** Its Done is being shown (completion feedback): its quick actions wait for the view to settle. */
  completing?: boolean
  /** Puts a saved object in the rows. */
  moved: (saved: ObjectRecord) => void
  /** The object went to the trash from this menu. */
  trashed: (id: Id) => void
}

export function objectRowMenu(object: ObjectSummary, host: RowMenuHost): MenuItem[] {
  const { type } = host
  const changes: MenuItem[] = host.readonly
    ? []
    : [
        ...(host.completing ? [] : quickActionMenuItems(type, object, { save: async (id, values) => host.moved(await setProperties(id, values)) })),
        ...subtaskMenuItems(type, object, host.moved),
      ]
  return [
    { kind: 'heading', label: displayTitle(object, type) },
    { label: 'Open', icon: 'ph:arrow-square-out', run: () => openObject(object.id, { where: 'type' }) },
    { label: 'Copy link to page', icon: 'ph:link', run: () => copyObjectLink(object.id) },
    pinMenu(object.id),
    ...(changes.length ? [{ kind: 'separator' as const }, ...changes] : []),
    ...(host.readonly
      ? []
      : [
          { kind: 'separator' as const },
          { label: 'Move to trash', icon: 'ph:trash', danger: true, run: async () => { if (await deleteObjectFlow(object.id)) host.trashed(object.id) } },
        ]),
  ]
}
