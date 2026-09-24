// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import { ThemeProvider, syncThemeColor, useTheme } from './theme-context'

/**
 * THE BROWSER CHROME FOLLOWS THE APP'S CANVAS — one `<meta name="theme-color">`, whose content is the
 * computed `--background`, rewritten every time `.dark` flips.
 *
 * Measured before this existed: with the OS light and the app on Dark, the status bar was #ffffff over
 * an rgb(28,29,31) page (the reverse gave #1b1b1b over rgb(248,251,254)), because the tag was a pair
 * media-matched to the OS. The pre-paint script in [lang]/layout.tsx writes the first value; this file
 * pins the half that runs in the app: the toggle, the OS flip under "system", and the recreate path.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
afterEach(cleanup)

let style: HTMLStyleElement
beforeEach(() => {
  style = document.createElement('style')
  style.textContent = ':root { --background: #f8fbfe; } :root.dark { --background: #1c1d1f; }'
  document.head.appendChild(style)
  document.documentElement.classList.remove('dark')
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
  })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  style.remove()
  vi.unstubAllGlobals()
})

const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]

// A ref the harness reads after render — not component state, so the component writes it in an effect.
const api: { current: ReturnType<typeof useTheme> | null } = { current: null }
function Grab() {
  const t = useTheme()
  React.useEffect(() => { api.current = t })
  return null
}

describe('syncThemeColor', () => {
  it('creates the one tag if it is missing, from the computed --background', () => {
    syncThemeColor(document.documentElement)
    expect(metas()).toHaveLength(1)
    expect(metas()[0].content).toBe('#f8fbfe')
  })

  it('rewrites the existing tag in place — never a second one — when the scheme flips', () => {
    syncThemeColor(document.documentElement)
    document.documentElement.classList.add('dark')
    syncThemeColor(document.documentElement)
    expect(metas()).toHaveLength(1)
    expect(metas()[0].content).toBe('#1c1d1f')
  })
})

describe('ThemeProvider keeps the chrome on the canvas', () => {
  it('the in-app toggle moves theme-color with `.dark`, both ways', () => {
    // As the pre-paint script leaves it on a light load.
    syncThemeColor(document.documentElement)
    render(<ThemeProvider><Grab /></ThemeProvider>)
    act(() => { api.current!.setTheme('dark') })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(metas().map((m) => m.content)).toEqual(['#1c1d1f'])
    act(() => { api.current!.setTheme('light') })
    expect(metas().map((m) => m.content)).toEqual(['#f8fbfe'])
  })

  it('under "system", an OS scheme change moves theme-color with the page', () => {
    // A controllable prefers-color-scheme: the provider subscribes to `change` while the choice is system.
    let dark = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() { return q.includes('dark') ? dark : false },
      media: q,
      addEventListener: (_: string, fn: () => void) => { listeners.add(fn) },
      removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn) },
    }))
    syncThemeColor(document.documentElement)
    render(<ThemeProvider><Grab /></ThemeProvider>)
    expect(metas().map((m) => m.content)).toEqual(['#f8fbfe'])
    act(() => { dark = true; listeners.forEach((fn) => fn()) })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(metas().map((m) => m.content)).toEqual(['#1c1d1f'])
    act(() => { dark = false; listeners.forEach((fn) => fn()) })
    expect(metas().map((m) => m.content)).toEqual(['#f8fbfe'])
  })

  it('a load whose tag went missing gets it back on mount', () => {
    render(<ThemeProvider><Grab /></ThemeProvider>)
    expect(metas().map((m) => m.content)).toEqual(['#f8fbfe'])
  })
})
