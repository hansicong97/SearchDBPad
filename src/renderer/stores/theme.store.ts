/** Renderer appearance preference. Only the user's choice is persisted. */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>

interface ThemeState {
  mode: ThemeMode
  resolvedMode: ResolvedThemeMode
  setMode: (mode: ThemeMode) => void
}

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

function systemTheme(): ResolvedThemeMode {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(SYSTEM_THEME_QUERY).matches
    ? 'dark'
    : 'light'
}

function resolveTheme(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? systemTheme() : mode
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      resolvedMode: systemTheme(),
      setMode: (mode) => set({ mode, resolvedMode: resolveTheme(mode) })
    }),
    {
      name: 'sdbp-theme',
      version: 1,
      partialize: (state) => ({ mode: state.mode }),
      merge: (persisted, current) => {
        const savedMode = (persisted as { mode?: unknown } | undefined)?.mode
        const mode = savedMode === 'light' || savedMode === 'dark' || savedMode === 'system'
          ? savedMode
          : 'system'
        return { ...current, mode, resolvedMode: resolveTheme(mode) }
      }
    }
  )
)

/** Attach for the root's lifetime; cleanup also handles React StrictMode remounts. */
export function startThemeSync(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const query = window.matchMedia(SYSTEM_THEME_QUERY)
  const sync = (): void => {
    const state = useThemeStore.getState()
    const resolvedMode = query.matches ? 'dark' : 'light'
    if (state.mode === 'system' && state.resolvedMode !== resolvedMode) {
      useThemeStore.setState({ resolvedMode })
    }
  }

  query.addEventListener('change', sync)
  sync()
  return () => query.removeEventListener('change', sync)
}
