// A habit type's progress on the Habits Tracker (the Tracker's Display menu), kept on the type so
// every device shows the same. Where it shows, which of the two charts (a trend line or a calendar
// of done days) and over how many weeks; the Progress tab draws the same chart over the same range.
// The ids are defined here once: the web app, the server's field check and the conversion of
// settings saved when there were more charts all read them from this file.
export const HABIT_PROGRESS_PLACES = ['off', 'above', 'beside'] as const
export type HabitProgressPlace = (typeof HABIT_PROGRESS_PLACES)[number]

export const HABIT_CHARTS = ['line', 'calendar'] as const
export type HabitChart = (typeof HABIT_CHARTS)[number]

/** The ranges progress may cover, in weeks. */
export const HABIT_WEEKS_RANGES = [4, 8, 13] as const
export type HabitWeeks = (typeof HABIT_WEEKS_RANGES)[number]

export interface HabitTypeSettings {
  place: HabitProgressPlace
  chart: HabitChart
  weeks: HabitWeeks
}

/** The progress a habit type starts with. */
export const HABIT_PROGRESS_DEFAULT: HabitTypeSettings = { place: 'above', chart: 'calendar', weeks: 4 }

/** The charts stored before there were two, each with the one of the two it is nearest to. */
const OLD_CHARTS: Record<string, HabitChart> = { weeks: 'line', line: 'line', meters: 'line', habits: 'line', counts: 'line', days: 'calendar', calendar: 'calendar' }

/**
 * A habit type's progress settings as stored (partial, or from when the strip, the panel and the
 * Progress tab each picked one of many charts) as today's: an old chart becomes the nearest of the
 * two (the one for where progress shows, else the Progress tab's), and any part that isn't a known
 * value comes from the default.
 */
export function habitProgressSettings(saved: unknown): HabitTypeSettings {
  const stored = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const place = HABIT_PROGRESS_PLACES.find((p) => p === stored.place) ?? HABIT_PROGRESS_DEFAULT.place
  const picks = [stored.chart, place === 'above' ? stored.strip : stored.panel, stored.report]
  const chart = picks.map((id) => (typeof id === 'string' ? OLD_CHARTS[id] : undefined)).find(Boolean)
  return { place, chart: chart ?? HABIT_PROGRESS_DEFAULT.chart, weeks: HABIT_WEEKS_RANGES.find((w) => w === stored.weeks) ?? HABIT_PROGRESS_DEFAULT.weeks }
}

/** Whether `value` is a progress setting a type may store: today's parts, or the old chart ones that are still read. */
export function isHabitProgressSettings(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.entries(value).every(([key, x]) => {
      if (key === 'place') return HABIT_PROGRESS_PLACES.includes(x as HabitProgressPlace)
      if (key === 'chart') return HABIT_CHARTS.includes(x as HabitChart)
      if (key === 'strip' || key === 'panel' || key === 'report') return typeof x === 'string' && x in OLD_CHARTS
      if (key === 'weeks') return HABIT_WEEKS_RANGES.includes(x as HabitWeeks)
      return false
    })
  )
}
