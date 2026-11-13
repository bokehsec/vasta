import { channelIcon, type DateValue, type ObjectSummary, type ObjectType } from '@vasta/core'
import { tagAncestors } from './tags.ts'

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'

const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const longDayFormat = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const timeFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const shortFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const clockFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })

/** Day-resolution dates are stored at midnight UTC, so they are formatted in UTC. */
export function formatDate(value: DateValue): string {
  const format = value.resolution === 'day' ? dayFormat : timeFormat
  const start = format.format(new Date(value.start))
  if (!value.end) return start
  // A time range within one day only repeats the clock: "18 Oct 2026, 09:00 – 10:30".
  const sameDay = value.resolution === 'time' && new Date(value.start).toDateString() === new Date(value.end).toDateString()
  return `${start} – ${(sameDay ? clockFormat : format).format(new Date(value.end))}`
}

/** The pieces of a short date in one locale; made on first use. */
const shortParts = new Map<string, { weekday: Intl.DateTimeFormat; day: Intl.DateTimeFormat; clock: Intl.DateTimeFormat }>()
function shortPartsFor(loc: string) {
  let parts = shortParts.get(loc)
  if (!parts) {
    parts = {
      weekday: new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      clock: new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }),
    }
    shortParts.set(loc, parts)
  }
  return parts
}

/**
 * A date as a list row shows it: "Tue Nov 17", with the time ("Tue Nov 17, 9:00 AM") when the value
 * has one, and no year while it is this year's. Other years keep formatDate's longer form.
 */
export function formatDateShort(value: DateValue, now: Date = new Date(), loc: string = locale): string {
  const timed = value.resolution === 'time'
  const yearOf = (iso: string) => (timed ? new Date(iso).getFullYear() : new Date(iso).getUTCFullYear())
  if (yearOf(value.start) !== now.getFullYear() || (value.end && yearOf(value.end) !== now.getFullYear())) return formatDate(value)
  const { weekday, day, clock } = shortPartsFor(loc)
  // Day-resolution dates are stored at midnight UTC; times are the viewer's wall clock.
  const dayOf = (iso: string) => {
    const at = new Date(iso)
    const date = timed ? new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())) : at
    return `${weekday.format(date)} ${day.format(date)}`
  }
  const one = (iso: string) => (timed ? `${dayOf(iso)}, ${clock.format(new Date(iso))}` : dayOf(iso))
  if (!value.end) return one(value.start)
  const sameDay = timed && new Date(value.start).toDateString() === new Date(value.end).toDateString()
  return `${one(value.start)} – ${sameDay ? clock.format(new Date(value.end)) : one(value.end)}`
}

export function formatLongDay(iso: string): string {
  return longDayFormat.format(new Date(iso))
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(-days, 'day')
  return shortFormat.format(new Date(iso))
}

/**
 * Daily notes and untitled objects still need something readable to show. A nested tag shows its
 * path, "recipe/breakfast" (lib/tags.ts).
 */
export function displayTitle(object: Pick<ObjectSummary, 'title' | 'date'> & Partial<Pick<ObjectSummary, 'media' | 'id' | 'parentId'>> | undefined, type?: ObjectType): string {
  if (!object) return 'Loading…'
  if (object.title.trim() && object.parentId && object.id) return [...tagAncestors({ id: object.id, parentId: object.parentId }).map((t) => t.title), object.title].join('/')
  if (object.title.trim()) return object.title
  if (object.media?.file?.name) return object.media.file.name
  if (type?.system === 'daily-note' && object.date) return formatLongDay(object.date.start)
  if (type?.system === 'date' && object.date) return formatDate(object.date)
  return 'Untitled'
}

/** "08:59" — capture blocks sit in that day's note, so the time is enough. */
export const formatCaptureTime = (iso: string) => clockFormat.format(new Date(iso))

const CHANNEL_NAMES: Record<string, string> = { telegram: 'Telegram', api: 'Capture API', email: 'Email', shortcuts: 'Shortcuts', raycast: 'Raycast', browser: 'Browser', desktop: 'Desktop app' }

export const formatChannel = (channel: string) => CHANNEL_NAMES[channel] ?? channel

/** The icon on the channel's capture callouts. */
export const channelIconName = (channel: string) => channelIcon(channel).value
