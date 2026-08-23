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

/**
 * Drop the freeze once the themed paint has happened.
 *
 * ⚠️ TWO FRAMES, THEN A TIMER AS A BACKSTOP. One rAF fires BEFORE the paint it is scheduled
 * against, so removing the class there can re-enable transitions in time for the very frame being
 * painted. Two clears the paint. The timer exists because a backgrounded tab does not run rAF at
 * all: without it a tab switched away mid-toggle could keep `theme-switching` forever, and that
 * class disables every transition on the site — a far worse bug than the one being fixed.
 */
let freezeGeneration = 0

function releaseThemeFreeze(root: HTMLElement): void {
  /**
   * ⚠️ GENERATION-GUARDED, BECAUSE TWO FLIPS CAN OVERLAP. Rapid toggling — or a system
   * `prefers-color-scheme` event landing on top of a user tap — starts a second freeze while the
   * first one's rAF and timer are still pending. Without this token the FIRST release lands during
   * the SECOND flip, drops the class mid-change and re-enables 807 transitions on exactly the
   * repaint they were suppressed for: the segmented fade, back again, for the one user who toggles
   * quickly. All three reviewers flagged it. Only the newest generation may release.
   */
  const mine = ++freezeGeneration
  const release = () => {
    if (mine !== freezeGeneration) return
    root.classList.remove('theme-switching')
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(release))
  }
  // Backstop: a backgrounded tab never runs rAF, and a stuck `theme-switching` disables every
  // transition on the site — a worse bug than the one being fixed.
  setTimeout(release, 120)
}

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

/** The user's choice → the scheme actually in effect. Pure: no DOM writes, no reflow.
 *  Deliberately byte-identical in behaviour to the no-FOUC inline script in layout.tsx
 *  (`localStorage['eno-theme']` + `prefers-color-scheme`), because the mount path below
 *  compares the two and only touches the DOM when they disagree. */
function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark()) ? 'dark' : 'light'
}

/**
 * ⛔ HOISTED OUT OF `apply()` ON PURPOSE — DO NOT FOLD IT BACK IN.
 *
 * Native shell mirror (Phase 2 M1): persist the RESOLVED scheme into native Preferences so the
 * instant local shell can paint the same theme on the next cold launch (the shell is a different
 * origin — it can't read our localStorage). `capacitor/www/index.html` reads exactly this key and
 * sets `document.documentElement.className = 't-' + value` over its OS guess; verified 2026-08-23.
 *
 * It lives on its own because the MOUNT path below no longer calls `apply()` in the common case
 * (see the effect: the inline script has already set the class, so re-applying it is pure forced
 * reflow). If this write stayed inside `apply()`, guarding that call would silently stop the mirror
 * from ever being written on a launch where the user never toggles the theme — and the native app's
 * cold-launch cover would desync from the app it covers, with nothing failing loudly.
 *
 * Fire-and-forget; the dynamic import keeps the plugin out of the web bundle.
 */
function mirrorResolvedThemeToNative(dark: boolean): void {
  try {
    if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
      void import('@capacitor/preferences')
        .then(({ Preferences }) => Preferences.set({ key: 'eno-resolved-theme', value: dark ? 'dark' : 'light' }))
        .catch(() => {})
    }
  } catch { /* web / plugin absent */ }
}

// Apply the resolved scheme to <html> — mirrors the no-FOUC inline script in
// layout so the class set pre-hydration stays consistent.
function apply(theme: Theme): 'light' | 'dark' {
  const dark = resolveTheme(theme) === 'dark'
  const root = document.documentElement
  /**
   * ⛔ FREEZE TRANSITIONS ACROSS THE FLIP, OR THE THEME CHANGE TEARS.
   *
   * Owner, 2026-08-16: "the transition between dark and light mode is jittery and segmented, looks
   * so unprofessional". It was, and the cause is not that the switch is slow — it is that it is
   * PARTIAL. Measured: 269 colour-animating utilities across 105 files (247 `transition-colors`,
   * 22 `transition-all`). Toggling `.dark` repaints the whole page at once, but every one of those
   * elements instead eases to its new colour over its own duration while everything around it has
   * already arrived. The page changes theme in visible pieces — which is exactly "segmented".
   *
   * ⚠️ THE FIX IS TO REMOVE MOTION, NOT TO ADD IT. The instinct is a global colour transition so
   * the whole page fades together; that is the wrong direction on both counts the owner named —
   * it is SLOWER (a theme switch is a mode change, not an animation, and 200ms of dip reads as
   * lag), and it makes every colour change on the site pay for a property nothing else needs.
   * Suppressing transitions for one frame costs one class and one CSS rule, ships no JS, and makes
   * the switch atomic: one paint, no tearing.
   *
   * ⚠️ THE REFLOW READ IS BELT-AND-BRACES, NOT LOAD-BEARING — an earlier version of this comment
   * marked it ⛔ and a reviewer was right to push back. Even coalesced into ONE recalculation, the
   * freeze and `.dark` apply together, so at the moment the colours change the transition duration
   * is already 0 and nothing starts easing. The read only removes any doubt about ordering, which
   * on a rule this cheap is worth keeping — but it is not the thing making this work.
   */
  root.classList.add('theme-switching')
  void root.offsetHeight // force the suppression to land BEFORE the colours change
  root.classList.toggle('dark', dark)
  releaseThemeFreeze(root)
  mirrorResolvedThemeToNative(dark)
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

    /**
     * ⚠️ DO NOT CALL `apply()` HERE UNCONDITIONALLY — ON MOUNT IT IS PURE WASTE.
     *
     * `apply()` deliberately forces a reflow (`void root.offsetHeight`) so the `theme-switching`
     * freeze lands before `.dark` flips. That is right for a TOGGLE. On mount there is no flip: the
     * no-FOUC inline script in layout.tsx read the SAME localStorage key and the SAME media query
     * before first paint and already put the class on <html>, so this ran the whole freeze/reflow/
     * release dance to arrive at the class the document already had. Measured on prod 2026-08-23
     * (headless chromium, mobile emulation, 4x CPU): 43.94 ms of forced style+layout here, plus a
     * ~25 ms recalc when `releaseThemeFreeze` removed the class two frames later — out of 314.01 ms
     * total forced layout on that load.
     *
     * ⛔ THE MIRROR IS NOT PART OF THE WASTE. `mirrorResolvedThemeToNative` used to live inside
     * `apply()`; guarding the call without hoisting it would silently stop writing the
     * `eno-resolved-theme` Preference that `capacitor/www/index.html` reads on cold launch, and the
     * native shell's cover would desync from the app. It is called on BOTH branches below.
     *
     * The class comparison is the safety net for the one case where the two CAN disagree: the OS
     * scheme flipping between the inline script running in <head> and hydration. That is a
     * `classList.contains` read — an attribute lookup, not a geometry read, so it forces nothing.
     */
    const next = resolveTheme(initial)
    mirrorResolvedThemeToNative(next === 'dark')
    if (document.documentElement.classList.contains('dark') !== (next === 'dark')) {
      setResolved(apply(initial)) // pre-paint guess was wrong (OS flipped mid-load) — really apply
    } else {
      setResolved(next) // DOM already correct: sync React state only, touch nothing
    }
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
