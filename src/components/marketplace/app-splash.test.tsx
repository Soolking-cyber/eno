// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AppSplash } from './app-splash'

/**
 * THE LAUNCH REVEAL'S CLOCK — the two things that made it slow on a slow phone, pinned as timings:
 *
 *   1. THE CEILING COUNTS FROM NAVIGATION. The reader has been looking at the server-rendered curtain
 *      since first paint; a 4s timer armed at hydration measured the wrong wait (armed at 5.3s, fired
 *      at 9.43s at 4x CPU). With `performance.now()` = time since navigation, a mount at 3.8s has
 *      ~200ms of budget left, not 4000ms.
 *   2. ONCE READY, THE REST OF THE MARK TAKES A FIXED TIME, NOT A FIXED NUMBER OF FRAMES. The old
 *      loop moved 16% of the gap per frame, so at 30fps it chased the end for a second after the page
 *      was ready. Now the final ease is ~250ms whatever the frame rate.
 *
 * The clock is vitest's fake one, INCLUDING `performance` — the component reads `performance.now()`
 * for both the ceiling and the ease, and rAF is driven off the same clock so a frame's timestamp is
 * the fake time. jsdom has no FontFaceSet (so fonts resolve at once) and reports readyState
 * 'complete' unless a test overrides it.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 *
 * ⛔ EVERY TIMING TEST BELOW RUNS AS THE NATIVE APP. Since 2026-09-25 the reveal exists only there
 * (owner: "Native app only"), keyed off `html.native` — the class the pre-paint head script sets inside
 * the Capacitor shell. The web's behaviour has its own block at the end of this file.
 */
afterEach(cleanup)

let frameMs = 16
beforeEach(() => {
  document.documentElement.classList.add('native')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  frameMs = 16
  // A frame clock on the fake timers: each rAF fires `frameMs` later with the fake `performance.now()`
  // as its timestamp, exactly the contract the component relies on.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), frameMs) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
  document.documentElement.classList.remove('native')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  // Undo any readyState override.
  delete (document as unknown as { readyState?: string }).readyState
})

const splash = () => document.getElementById('app-splash')
const isDone = () => splash()?.hasAttribute('data-done') ?? false

/** Advance the fake clock in small steps (so React commits between frames) until `done` or `max` ms. */
function msUntil(pred: () => boolean, max: number, step = 4): number {
  let t = 0
  while (t <= max) {
    if (pred()) return t
    act(() => { vi.advanceTimersByTime(step) })
    t += step
  }
  return Infinity
}

describe('AppSplash — the ceiling counts from navigation', () => {
  it('a curtain mounted at 3.8s with the page still loading lifts ~200ms later, not 4s later', () => {
    // Navigation happened 3.8s ago; hydration is only now mounting the component.
    act(() => { vi.advanceTimersByTime(3800) })
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
    render(<AppSplash />)
    expect(isDone()).toBe(false)
    const t = msUntil(isDone, 1000)
    // 4000 - 3800 = 200ms of budget left. Without the fix the timer is a fresh 4000ms and this is ∞.
    expect(t).toBeLessThanOrEqual(260)
  })

  it('a mount that arrives after the budget is spent lifts on the next task', () => {
    act(() => { vi.advanceTimersByTime(5300) })
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
    render(<AppSplash />)
    expect(msUntil(isDone, 1000)).toBeLessThanOrEqual(20)
  })
})

describe('AppSplash — the reveal ends on the clock, not on the frame count', () => {
  for (const fps of [60, 30, 15]) {
    it(`at ${fps}fps a ready page is fully revealed within ~250ms of the settle frames`, () => {
      frameMs = Math.round(1000 / fps)
      render(<AppSplash />)
      const t = msUntil(isDone, 3000)
      // Ready at mount (jsdom: readyState complete, no FontFaceSet) → two settle frames → 250ms ease →
      // the frame that lands on it. The old 16%-per-frame chase needed ~31 frames: ~1s at 30fps,
      // ~2s at 15fps.
      expect(t).toBeLessThanOrEqual(250 + 3 * frameMs + 8)
      expect(splash()!.style.getPropertyValue('--splash-reveal')).toBe('1')
    })
  }

  it('the eased values rise monotonically and end at exactly 1', () => {
    frameMs = 33
    render(<AppSplash />)
    const seen: number[] = []
    for (let i = 0; i < 40 && !isDone(); i++) {
      act(() => { vi.advanceTimersByTime(frameMs) })
      seen.push(Number(splash()!.style.getPropertyValue('--splash-reveal')))
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen.at(-1)).toBe(1)
  })
})

describe('AppSplash — a snap is final', () => {
  it('the ceiling landing MID-EASE leaves the mark whole — it never slides back from 1', () => {
    frameMs = 33
    // Mount 3.8s after navigation on a page that is already ready: the settle frames and the 250ms ease
    // start, and the 200ms of budget left runs out part-way through it.
    act(() => { vi.advanceTimersByTime(3800) })
    render(<AppSplash />)
    const seen: string[] = []
    let doneAt = -1
    for (let i = 0; i < 30; i++) {
      act(() => { vi.advanceTimersByTime(frameMs) })
      const v = splash()?.style.getPropertyValue('--splash-reveal')
      if (v == null) break
      seen.push(v)
      if (isDone() && doneAt < 0) doneAt = seen.length - 1
    }
    expect(doneAt).toBeGreaterThanOrEqual(0)
    // Every value written after `done` is exactly 1 — the first version eased on and wrote ~0.85.
    expect(seen.slice(doneAt)).toEqual(seen.slice(doneAt).map(() => '1'))
  })
})

describe('AppSplash — exit', () => {
  it('unmounts 220ms after done — after the 200ms fade, never before it', () => {
    render(<AppSplash />)
    msUntil(isDone, 3000, 1)
    expect(splash()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(200) })
    expect(splash()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(25) })
    expect(splash()).toBeNull()
  })

  it('reduced motion still skips the sweep: whole mark, done as soon as the page is ready', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    render(<AppSplash />)
    expect(splash()!.style.getPropertyValue('--splash-reveal')).toBe('1')
    // Two settle frames, then done — no ease.
    expect(msUntil(isDone, 1000)).toBeLessThanOrEqual(3 * frameMs + 8)
  })
})

/**
 * ⛔ THE WEB GETS NO CURTAIN — owner, 2026-09-25: "Native app only". Measured on eno.vn before this: the
 * overlay held an already-painted page for 1.4–2.5s on a fast phone and 9–10s at 4x CPU, on every full
 * load. Two halves, and both are pinned: the CSS that keeps a browser from painting the server-rendered
 * node, and the component leaving at hydration without arming its clock.
 */
describe('AppSplash — web (no html.native)', () => {
  beforeEach(() => { document.documentElement.classList.remove('native') })

  it('unmounts at hydration and arms no timer, frame or load listener', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const add = vi.spyOn(window, 'addEventListener')
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
    render(<AppSplash />)
    // Gone on the first commit after the mount effect — not after a 4s ceiling, not after a fade.
    expect(splash()).toBeNull()
    expect(raf).not.toHaveBeenCalled()
    expect(add.mock.calls.filter(([type]) => type === 'load')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    add.mockRestore()
  })

  it('the native app still gets the reveal (same test, class on)', () => {
    document.documentElement.classList.add('native')
    render(<AppSplash />)
    expect(splash()).not.toBeNull()
    expect(msUntil(isDone, 3000)).toBeLessThan(Infinity)
  })

  it('a class that arrives AFTER first paint (a native fallback adding it at hydration) does not bring a late curtain', () => {
    // The head script threw, so the CSS hid the overlay at first paint; native-bootstrap's effect (an
    // earlier sibling) then adds `native` before this component's effect runs. Reading the class in the
    // effect kept a curtain the CSS then UN-hid over a painted app (codex, opus on the first diff).
    const Late = () => { React.useEffect(() => { document.documentElement.classList.add('native') }, []); return null }
    render(<><Late /><AppSplash /></>)
    expect(document.documentElement.classList.contains('native')).toBe(true)
    expect(splash()).toBeNull()
  })

  it('globals.css hides the server-rendered overlay unless html.native is set', () => {
    // The server cannot make this call (the HTML is ISR-cached for both audiences), so the rule that
    // keeps the web from PAINTING the first frame is CSS, keyed off the pre-paint class.
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/html:not\(\.native\)\s+#app-splash\s*\{\s*display:\s*none;?\s*\}/)
  })
})
