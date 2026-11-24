import { channelIcon, type DateValue, type ObjectSummary, type ObjectType } from '@vasta/core'
import { locale, t, type MessageKey } from './i18n.ts'
import { tagAncestors } from './tags.ts'

interface Formatters {
  day: Intl.DateTimeFormat
  longDay: Intl.DateTimeFormat
  time: Intl.DateTimeFormat
  short: Intl.DateTimeFormat
  clock: Intl.DateTimeFormat
  relative: Intl.RelativeTimeFormat
}

const formatterCache = new Map<string, Formatters>()

function formatters(): Formatters {
  const tag = locale.value
  let entry = formatterCache.get(tag)
  if (!entry) {
    entry = {
      day: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
      longDay: new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
      time: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      short: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }),
      clock: new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }),
      relative: new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }),
    }
    formatterCache.set(tag, entry)
  }
  return entry
}

/** Day-resolution dates are stored at midnight UTC, so they are formatted in UTC. */
export function formatDate(value: DateValue): string {
  const f = formatters()
  const format = value.resolution === 'day' ? f.day : f.time
  const start = format.format(new Date(value.start))
  if (!value.end) return start
  // A time range within one day only repeats the clock: "18 Oct 2026, 09:00 – 10:30".
  const sameDay = value.resolution === 'time' && new Date(value.start).toDateString() === new Date(value.end).toDateString()
  return `${start} – ${(sameDay ? f.clock : format).format(new Date(value.end))}`
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
export function formatDateShort(value: DateValue, now: Date = new Date(), loc: string = locale.value): string {
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
  return formatters().longDay.format(new Date(iso))
}

/** A day ("YYYY-MM-DD") as "Nov 24", with the year when it is not this one (a line in a note). */
export function formatDayShort(day: string, now: Date = new Date(), loc: string = locale.value): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  return date.getUTCFullYear() === now.getFullYear() ? shortPartsFor(loc).day.format(date) : formatDate({ start: date.toISOString(), resolution: 'day' })
}

export function formatRelative(iso: string): string {
  const f = formatters()
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (Math.abs(minutes) < 60) return f.relative.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return f.relative.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return f.relative.format(-days, 'day')
  return f.short.format(new Date(iso))
}

/**
 * Daily notes and untitled objects still need something readable to show. A nested tag shows its
 * path, "recipe/breakfast" (lib/tags.ts).
 */
export function displayTitle(object: Pick<ObjectSummary, 'title' | 'date'> & Partial<Pick<ObjectSummary, 'media' | 'id' | 'parentId'>> | undefined, type?: ObjectType): string {
  if (!object) return t('common.loading')
  if (object.title.trim() && object.parentId && object.id) return [...tagAncestors({ id: object.id, parentId: object.parentId }).map((tag) => tag.title), object.title].join('/')
  if (object.title.trim()) return object.title
  if (object.media?.file?.name) return object.media.file.name
  if (type?.system === 'daily-note' && object.date) return formatLongDay(object.date.start)
  if (type?.system === 'date' && object.date) return formatDate(object.date)
  return t('common.untitled')
}

/** "08:59" — capture blocks sit in that day's note, so the time is enough. */
export const formatCaptureTime = (iso: string) => formatters().clock.format(new Date(iso))

const CHANNEL_KEYS: Record<string, MessageKey> = {
  telegram: 'channel.telegram',
  api: 'channel.api',
  email: 'channel.email',
  shortcuts: 'channel.shortcuts',
  raycast: 'channel.raycast',
  browser: 'channel.browser',
  desktop: 'channel.desktop',
}

export const formatChannel = (channel: string) => (CHANNEL_KEYS[channel] ? t(CHANNEL_KEYS[channel]) : channel)

/** The icon on the channel's capture callouts. */
export const channelIconName = (channel: string) => channelIcon(channel).value
