// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * NAV-3 (UX3, 2026-10-05) — every new page starts with the bars showing, and hide-on-scroll is otherwise
 * exactly the owner's (2026-07-16): down hides, up shows, near the top shows, and a document that grew is
 * not a scroll (2026-09-24). Measured before the fix (nav audit N4): a listing opened from a scrolled feed
 * kept the tab bar at opacity 0 until the reader scrolled up.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const nav = vi.hoisted(() => ({ pathname: '/' as string | null }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { useHideOnScroll } from './use-hide-on-scroll'

let Y = 0
let H = 4000

function Probe() {
  return <div data-testid="probe" data-hidden={String(useHideOnScroll())} />
}
const hidden = () => screen.getByTestId('probe').getAttribute('data-hidden') === 'true'
/** One scroll frame at `y` (and, optionally, a document of height `h`). rAF runs synchronously here. */
const scroll = (y: number, h = H) => {
  Y = y
  H = h
  act(() => { window.dispatchEvent(new Event('scroll')) })
}

beforeEach(() => {
  Y = 0
  H = 4000
  nav.pathname = '/'
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => Y })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => H })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('hide-on-scroll, as the owner set it', () => {
  it('starts shown; the first frame only anchors; down hides, up shows', () => {
    render(<Probe />)
    expect(hidden()).toBe(false)
    scroll(400) // first frame: anchor, decide nothing — a page restored mid-scroll must not hide at once
    expect(hidden()).toBe(false)
    scroll(700)
    expect(hidden()).toBe(true)
    scroll(500)
    expect(hidden()).toBe(false)
  })

  it('a few pixels of jitter decide nothing', () => {
    render(<Probe />)
    scroll(400)
    scroll(404)
    expect(hidden()).toBe(false)
  })

  it('2026-09-24 kept: a feed that grows under a still reader (scrollY advanced by the append) does not hide the bars', () => {
    render(<Probe />)
    scroll(3000)
    scroll(2900) // a real scroll up: shown
    expect(hidden()).toBe(false)
    scroll(2900 + 438, H + 438) // the next page appended; the browser kept the content anchored
    expect(hidden()).toBe(false)
  })
})

describe('NAV-3: every new page starts with the bars showing', () => {
  it('near the top always shows — even in the frame whose document height changed (the arrival at y=0)', () => {
    render(<Probe />)
    scroll(1200)
    scroll(1800)
    expect(hidden()).toBe(true)
    // A card tap: the new page is another height and opens at the top. This frame used to be swallowed by
    // the "document grew" early return, leaving the bars hidden until the reader scrolled up.
    scroll(0, 2200)
    expect(hidden()).toBe(false)
  })

  it('a pathname change shows the bars in the same render, with no scroll event at all', () => {
    const { rerender } = render(<Probe />)
    scroll(1200)
    scroll(1800)
    expect(hidden()).toBe(true)
    nav.pathname = '/listings/abc'
    rerender(<Probe />)
    expect(hidden()).toBe(false)
  })

  it('the new page re-anchors: a deep restored position is not read as a scroll down from the old page', () => {
    const { rerender } = render(<Probe />)
    scroll(100)
    scroll(500)
    expect(hidden()).toBe(true)
    nav.pathname = '/listings/abc'
    rerender(<Probe />)
    expect(hidden()).toBe(false)
    // Back to a feed restored at y=3000, same document height: measured against the old page's 500 that is
    // a 2,500px "scroll down". It is the new page's first frame, so it anchors and decides nothing.
    scroll(3000)
    expect(hidden()).toBe(false)
    scroll(3300) // and the reader's own scroll down still hides, as before
    expect(hidden()).toBe(true)
  })

  it('returning to the path where the bars were hidden does not bring that decision back', () => {
    const { rerender } = render(<Probe />)
    scroll(1200)
    scroll(1800)
    expect(hidden()).toBe(true)
    nav.pathname = '/listings/abc'
    rerender(<Probe />)
    nav.pathname = '/'
    rerender(<Probe />)
    expect(hidden()).toBe(false)
  })

  it('outside the App Router (pathname null) it still works and never resets on its own', () => {
    nav.pathname = null
    render(<Probe />)
    scroll(400)
    scroll(900)
    expect(hidden()).toBe(true)
  })
})
