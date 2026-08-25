// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, scrollBehavior } from './reduced-motion'

function setPreference(reduce: boolean | null) {
  if (reduce === null) {
    // @ts-expect-error — deliberately removing the API to model jsdom/older engines.
    window.matchMedia = undefined
    return
  }
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia
}

/**
 * ⚠️ RESTORE THE REAL `matchMedia` BY HAND. `vi.unstubAllGlobals()` only undoes what
 * `vi.stubGlobal` set, and these tests ASSIGN to `window.matchMedia` directly — including deleting
 * it — so without this the API stays destroyed for every later suite sharing the worker. A
 * reviewer caught it; the symptom would have been an unrelated test failing depending on order.
 */
let realMatchMedia: typeof window.matchMedia
beforeEach(() => { realMatchMedia = window.matchMedia })
afterEach(() => { window.matchMedia = realMatchMedia })

describe('reduced motion', () => {
  it('reports the preference and turns it into a scroll behavior', () => {
    setPreference(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(scrollBehavior()).toBe('instant')

    setPreference(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('asks the media query EVERY time, so an OS toggle mid-session is honoured', () => {
    // The whole point of a function over a module-load constant. A cached value would pin the
    // session to whatever was true when the bundle evaluated.
    setPreference(false)
    expect(scrollBehavior()).toBe('smooth')
    setPreference(true)
    expect(scrollBehavior()).toBe('instant')
  })

  it('degrades instead of throwing when matchMedia is absent', () => {
    setPreference(null)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('returns a scroll behavior on the server, where there is no window at all', () => {
    // The SSR path. `scrollBehavior()` is imported by client components that also render on the
    // server, so reaching for `window` there must not throw the render.
    const saved = globalThis.window
    // @ts-expect-error — modelling the server, where `window` is genuinely absent.
    delete globalThis.window
    try {
      expect(prefersReducedMotion()).toBe(false)
      expect(scrollBehavior()).toBe('smooth')
    } finally {
      globalThis.window = saved
    }
  })

  it('queries the reduce preference specifically', () => {
    setPreference(false)
    scrollBehavior()
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})
