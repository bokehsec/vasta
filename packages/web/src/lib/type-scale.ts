// The app's type roles (DESIGN_SYSTEM.md › Typography): one size per job, as with buttons.ts.
// Notes keep their own document scale. Phone controls retain their intentional 15px size.
export const bodyText = 'text-sm'
export const metaText = 'text-xs'
export const pageTitle = 'text-[1.8rem] font-bold leading-tight tracking-tight md:text-[2.1rem]'

const section = `flex items-center gap-2 ${bodyText} font-semibold`
export const sectionHeading = `${section} text-ink-soft`
export const overdueHeading = `${section} text-red-700 dark:text-red-400`

// A task title in the review dialog/sheet, below the full page-title level.
export const sheetTitle = 'text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] md:text-[1.75rem]'
export const phoneText = 'text-[15px]'
export const phoneUiText = 'max-md:text-[15px]'

// Only heatmap axes (11px cells) and tiny notification/calendar badges; see the test allowlist.
export const tinyText = 'text-[10px]'
