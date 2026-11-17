// The word for inbox items dealt with ("Cleared" unless the user picked another in Settings ›
// Inbox: then the button says "Mark <their word>"), and whether those items fade in the inbox and
// the daily notes (off by default).
import { computed } from 'vue'
import { session } from './session.ts'

export const DEFAULT_REVIEWED_LABEL = 'Cleared'

export const reviewed = computed(() => {
  const custom = session.user?.inbox?.reviewedLabel
  const word = custom || DEFAULT_REVIEWED_LABEL
  // "Triaged" → "Mark triaged"; an acronym stays as typed.
  const lower = word === word.toUpperCase() ? word : word.charAt(0).toLowerCase() + word.slice(1)
  return {
    word,
    lower,
    fade: !!session.user?.inbox?.fadeReviewed,
    /** The button on an item, its undo and the notice after it. */
    mark: custom ? `Mark ${lower}` : 'Clear',
    unmark: custom ? `Mark not ${lower}` : 'Bring back',
    marked: custom ? `Marked ${lower}` : 'Cleared',
  }
})
