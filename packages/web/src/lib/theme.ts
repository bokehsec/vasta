// Light, dark, or the OS setting (the default): `.dark` on <html>, and the browser's toolbar color
// to match; and how type icons look. The choices are per browser (lib/preferences.ts), so the login screen has them too.
import { watch } from 'vue'
import { preference } from './preferences.ts'

export type Theme = 'system' | 'light' | 'dark'

const COLORS = { light: '#f7f6f3', dark: '#16181b' }

export const theme = preference<Theme>('theme', 'system', { scope: 'browser', parse: (value) => (value === 'light' || value === 'dark' ? value : undefined) })

const osDark = window.matchMedia('(prefers-color-scheme: dark)')

function apply() {
  const dark = theme.value === 'dark' || (theme.value === 'system' && osDark.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  // One meta tag for the chosen theme instead of index.html's pair, which follows the OS.
  for (const meta of document.querySelectorAll('meta[name=theme-color]')) {
    meta.removeAttribute('media')
    meta.setAttribute('content', dark ? COLORS.dark : COLORS.light)
  }
}

export const BLOCK_SPACING = { compact: '0.25rem', comfortable: '0.75rem', spacious: '1.25rem' }
type BlockSpacing = keyof typeof BLOCK_SPACING

export const blockSpacing = preference<BlockSpacing>('block-spacing', 'comfortable', { scope: 'browser', parse: (value) => (value === 'compact' || value === 'spacious' ? value : undefined) })

export function installTheme() {
  watch(blockSpacing, (value) => {
    document.documentElement.style.setProperty('--vasta-block-spacing', BLOCK_SPACING[value])
  }, { immediate: true })
  apply()
  osDark.addEventListener('change', apply)
  watch(theme, apply)
}

/** System → light → dark → system. */
export function cycleTheme() {
  theme.value = theme.value === 'system' ? 'light' : theme.value === 'light' ? 'dark' : 'system'
}

// Type icons: in a rounded square tinted with the type's color (the default, as in Capacities), or
// bare in that color.
export type IconStyle = 'boxed' | 'plain'

export const iconStyle = preference<IconStyle>('type-icons', 'boxed', { scope: 'browser', parse: (value) => (value === 'plain' ? value : undefined) })

export const THEME_LABELS: Record<Theme, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }
export const THEME_ICONS: Record<Theme, string> = { system: 'ph:circle-half', light: 'ph:sun', dark: 'ph:moon' }
