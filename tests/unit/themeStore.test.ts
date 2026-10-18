import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'sdbp-theme'

function browserTheme(initiallyDark = false) {
  const values = new Map<string, string>()
  let dark = initiallyDark
  const listeners = new Set<() => void>()
  const query = {
    get matches() { return dark },
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener))
  }
  const matchMedia = vi.fn(() => query)
  vi.stubGlobal('window', { matchMedia })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  })

  return {
    values,
    listeners,
    matchMedia,
    setDark(value: boolean) {
      dark = value
      listeners.forEach((listener) => listener())
    },
    saved: () => JSON.parse(values.get(STORAGE_KEY) ?? 'null') as unknown
  }
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('renderer appearance preference', () => {
  it('defaults to system and resolves its current appearance before rendering', async () => {
    const browser = browserTheme(true)
    const { useThemeStore } = await import('../../src/renderer/stores/theme.store')

    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' })
    expect(browser.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it.each(['light', 'dark'] as const)('preserves a previously saved %s choice', async (mode) => {
    const browser = browserTheme(mode === 'light')
    browser.values.set(STORAGE_KEY, JSON.stringify({ state: { mode }, version: 1 }))
    const { useThemeStore } = await import('../../src/renderer/stores/theme.store')

    expect(useThemeStore.getState()).toMatchObject({ mode, resolvedMode: mode })
  })

  it('uses the current system appearance when restoring system preference', async () => {
    const browser = browserTheme(true)
    browser.values.set(STORAGE_KEY, JSON.stringify({
      state: { mode: 'system', resolvedMode: 'light' }, version: 1
    }))
    const { useThemeStore } = await import('../../src/renderer/stores/theme.store')

    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' })
  })

  it('follows system changes and persists the preference without its resolved color', async () => {
    const browser = browserTheme()
    const { startThemeSync, useThemeStore } = await import('../../src/renderer/stores/theme.store')
    const stop = startThemeSync()
    browser.setDark(true)

    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' })
    expect(browser.saved()).toEqual({ state: { mode: 'system' }, version: 1 })

    browser.setDark(false)
    expect(useThemeStore.getState().resolvedMode).toBe('light')
    stop()
  })

  it('keeps explicit colors fixed and resolves system immediately when selected again', async () => {
    const browser = browserTheme()
    const { startThemeSync, useThemeStore } = await import('../../src/renderer/stores/theme.store')
    const stop = startThemeSync()

    useThemeStore.getState().setMode('light')
    browser.setDark(true)
    expect(useThemeStore.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' })
    expect(browser.saved()).toEqual({ state: { mode: 'light' }, version: 1 })

    useThemeStore.getState().setMode('dark')
    browser.setDark(false)
    expect(useThemeStore.getState()).toMatchObject({ mode: 'dark', resolvedMode: 'dark' })

    useThemeStore.getState().setMode('system')
    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', resolvedMode: 'light' })
    stop()
  })

  it('cleans up subscriptions and resynchronizes after StrictMode-style remounting', async () => {
    const browser = browserTheme()
    const { startThemeSync, useThemeStore } = await import('../../src/renderer/stores/theme.store')
    const stopFirst = startThemeSync()
    expect(browser.listeners.size).toBe(1)
    stopFirst()
    expect(browser.listeners.size).toBe(0)
    browser.setDark(true)
    expect(useThemeStore.getState().resolvedMode).toBe('light')

    const stopSecond = startThemeSync()
    expect(browser.listeners.size).toBe(1)
    expect(useThemeStore.getState().resolvedMode).toBe('dark')
    stopSecond()
    expect(browser.listeners.size).toBe(0)
  })

  it('falls back to light without a browser or matchMedia', async () => {
    browserTheme()
    vi.stubGlobal('window', undefined)
    const { startThemeSync, useThemeStore } = await import('../../src/renderer/stores/theme.store')
    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', resolvedMode: 'light' })
    expect(() => startThemeSync()()).not.toThrow()

    vi.stubGlobal('window', {})
    useThemeStore.getState().setMode('system')
    expect(useThemeStore.getState().resolvedMode).toBe('light')
    expect(() => startThemeSync()()).not.toThrow()
  })
})
