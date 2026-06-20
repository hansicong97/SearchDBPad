/**
 * Theme mode store (UI only).
 *
 * Holds the renderer's light/dark preference and exposes a `toggle()`
 * action. Backed by `zustand/persist` against `localStorage` so the
 * choice survives reloads without a flash of the wrong theme — persist
 * hydrates synchronously before React mounts.
 *
 * `mode === 'dark'` maps to AntD `theme.darkAlgorithm`; everything else
 * uses `theme.defaultAlgorithm`. AntD's `cssVar: true` mode exposes the
 * resulting tokens as `--ant-*` CSS variables so the rest of the app
 * can theme itself purely through `var(--ant-color-...)`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  toggle: () => void
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'light',
      toggle: () =>
        set((s) => ({ mode: s.mode === 'light' ? 'dark' : 'light' })),
      setMode: (mode) => set({ mode })
    }),
    {
      name: 'sdbp-theme',
      version: 1
    }
  )
)