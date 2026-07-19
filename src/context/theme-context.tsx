'use client'

import React, { createContext, useCallback, useMemo, useContext, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'eno-theme'

type ThemeCtx = {
  theme: Theme // the user's choice (may be 'system')
  resolved: 'light' | 'dark' // what's actually applied right now
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeCtx | undefined>(undefined)

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

// Apply the resolved scheme to <html> — mirrors the no-FOUC inline script in
// layout so the class set pre-hydration stays consistent.
function apply(theme: Theme): 'light' | 'dark' {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
  // Native shell mirror (Phase 2 M1): persist the RESOLVED scheme into native
  // Preferences so the instant local shell can paint the same theme on the next
  // cold launch (the shell is a different origin — it can't read our localStorage).
  // Fire-and-forget; the dynamic import keeps the plugin out of the web bundle.
  try {
    if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
      void import('@capacitor/preferences')
        .then(({ Preferences }) => Preferences.set({ key: 'eno-resolved-theme', value: dark ? 'dark' : 'light' }))
        .catch(() => {})
    }
  } catch { /* web / plugin absent */ }
  return dark ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  // Hydrate from the persisted choice (the inline script already set the class to
  // avoid a flash; this just syncs React state to it).
  useEffect(() => {
    let initial: Theme = 'system'
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
      if (stored === 'light' || stored === 'dark' || stored === 'system') initial = stored
    } catch { /* storage blocked → system */ }
    setThemeState(initial)
    setResolved(apply(initial))
  }, [])

  // When following the system, react to OS scheme changes live.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(apply('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    setResolved(apply(t))
    try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
