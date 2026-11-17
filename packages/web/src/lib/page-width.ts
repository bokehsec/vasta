// How wide a page's text column may grow: Standard (the default), Wide or Full width. The choice is
// per device (a device preference), like the theme, and read by object pages and the calendar's day.
import { preference } from './preferences.ts'

export type PageWidth = 'standard' | 'wide' | 'full'

export const pageWidth = preference<PageWidth>('page-width', 'standard', { scope: 'device', parse: (value) => (value === 'wide' || value === 'full' ? value : undefined) })

/** The max-width class per choice: text pages, and pages built with columns, which need room. */
export const PAGE_WIDTH_CLASSES: Record<PageWidth, { prose: string; columns: string }> = {
  standard: { prose: 'max-w-3xl', columns: 'max-w-6xl' },
  wide: { prose: 'max-w-6xl', columns: 'max-w-6xl' },
  full: { prose: 'max-w-none', columns: 'max-w-none' },
}

export function pageWidthClass(columns: boolean): string {
  return PAGE_WIDTH_CLASSES[pageWidth.value][columns ? 'columns' : 'prose']
}

export const PAGE_WIDTH_OPTIONS: { value: PageWidth; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full width' },
]
