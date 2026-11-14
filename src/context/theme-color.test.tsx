// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import { ThemeProvider, syncThemeColor, useTheme } from './theme-context'

// A path, not `new URL(…, import.meta.url)`: under jsdom the global URL is jsdom's, which node:fs does not accept.
const repoFile = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

/** globals.css's canvas, resolved through its var() chain (--background → --wash-tail → --home-wash-soft) the way the
 *  cascade does: the theme's own block first, then :root, which `.dark` inherits whatever it does not redefine. */
function canvas(theme: 'light' | 'dark'): string {
  const css = repoFile('src/app/globals.css')
  const blockOf = (start: number) => css.slice(start, css.indexOf('\n}', start + 1))
  const root = blockOf(css.indexOf('\n:root {'))
  const own = theme === 'light' ? root : blockOf(css.indexOf('\n.dark {'))
  let name = 'background'
  for (let hop = 0; hop < 5; hop++) {
    const find = (b: string) => b.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
    const v = find(own) ?? find(root)
    expect(v, `--${name} in the ${theme} theme`).toBeDefined()
    const ref = v!.match(/^var\(\s*--([\w-]+)\s*\)$/)
    if (!ref) return v!.toLowerCase()
    name = ref[1]
  }
  throw new Error('--background does not resolve to a literal')
}

/**
 * THE LITERALS THAT STAND IN FOR THE CANVAS WHEN THE STYLESHEET CANNOT BE READ — the pre-paint script's fallback pair
 * and the no-JavaScript <meta> in [lang]/layout.tsx — ARE THE CANVAS. They drifted once already: #f8fbfe stayed in
 * layout.tsx while the canvas moved, so this reads both files rather than a fixture (white ground, 2026-11-14).
 */
describe('the theme-color fallbacks equal the canvas in globals.css', () => {
  const layout = repoFile('src/app/[lang]/layout.tsx')

  it('resolves the two canvases (the fixtures below use these values)', () => {
    expect(canvas('light')).toBe('#ffffff')
    expect(canvas('dark')).toBe('#1c1d1f')
  })

  it("the pre-paint script's fallback pair is (dark, light) canvas", () => {
    const m = layout.match(/getPropertyValue\('--background'\)\.trim\(\)\|\|\(de\.classList\.contains\('dark'\)\?'(#[0-9a-fA-F]{3,6})':'(#[0-9a-fA-F]{3,6})'\)/)
    expect(m, 'the fallback expression in the pre-paint script').not.toBeNull()
    expect(m![1].toLowerCase()).toBe(canvas('dark'))
    expect(m![2].toLowerCase()).toBe(canvas('light'))
  })

  it('the no-JavaScript <meta> is the light canvas (nothing adds .dark without JS)', () => {
    const m = layout.match(/<noscript>\s*<meta name="theme-color" content="(#[0-9a-fA-F]{3,6})" \/>\s*<\/noscript>/)
    expect(m, 'the noscript theme-color').not.toBeNull()
    expect(m![1].toLowerCase()).toBe(canvas('light'))
  })
})

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
  style.textContent = ':root { --background: #ffffff; } :root.dark { --background: #1c1d1f; }'
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
    expect(metas()[0].content).toBe('#ffffff')
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
    expect(metas().map((m) => m.content)).toEqual(['#ffffff'])
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
    expect(metas().map((m) => m.content)).toEqual(['#ffffff'])
    act(() => { dark = true; listeners.forEach((fn) => fn()) })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(metas().map((m) => m.content)).toEqual(['#1c1d1f'])
    act(() => { dark = false; listeners.forEach((fn) => fn()) })
    expect(metas().map((m) => m.content)).toEqual(['#ffffff'])
  })

  it('a load whose tag went missing gets it back on mount', () => {
    render(<ThemeProvider><Grab /></ThemeProvider>)
    expect(metas().map((m) => m.content)).toEqual(['#ffffff'])
  })
})
