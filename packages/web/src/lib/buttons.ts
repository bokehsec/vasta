// The app's button kinds (DESIGN_SYSTEM.md › Buttons): one look per job, the same everywhere.
// Main: the one most likely action of a place. Tinted: a way into a feature, or the action a page
// leads with when it isn't a save. Grey: ordinary actions. Quiet: toolbars, menus and rows only.
// Delete: red text; solid red only to confirm, in the "Are you sure?" dialog.
// 44px tall on a phone (the design system's tap size); size never tells the kinds apart.
const base = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 max-md:min-h-11 max-md:px-3.5 max-md:text-[15px]'

export const mainButton = `${base} bg-ink text-surface hover:opacity-90 active:opacity-80`
export const tintedButton = `${base} bg-accent/12 text-accent hover:bg-accent/17 active:bg-accent/22`
export const greyButton = `${base} bg-hover text-ink hover:bg-line active:bg-line-strong`
export const quietButton = `${base} font-normal text-ink-soft hover:bg-hover hover:text-ink active:bg-line`
export const deleteButton = `${base} bg-hover text-red-600 hover:bg-line active:bg-line-strong dark:text-red-400`
export const confirmDeleteButton = `${base} bg-red-600 text-white hover:bg-red-700 active:bg-red-800`
