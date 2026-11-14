// @vitest-environment jsdom
/**
 * useStuck — the goods control rows' "pinned over the grid" read (build 8, owner-approved 2026-11-15, cook r08 goods): position
 * sticky, the page scrolled, and the box's top at or above its own computed `top`. False in the first render (hydration), off,
 * and for anything that is not sticky; re-read on scroll, on resize and when the element's own `top` glide ends.
 */
import React, { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStuck } from './use-stuck'

let Y = 0
let boxTop = 120
beforeEach(() => {
  Y = 0
  boxTop = 120
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => Y })
  // A frame runs at once here; the handle is 0, as the hook's own `frame = 0` leaves it after a read (a real frame is async).
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Probe({ on = true, sticky = true, top = '56px' }: { on?: boolean; sticky?: boolean; top?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useStuck(ref, on)
  return (
    <div
      ref={(el) => {
        ref.current = el
        if (el) el.getBoundingClientRect = () => ({ top: boxTop, bottom: boxTop + 44, left: 0, right: 390, width: 390, height: 44, x: 0, y: boxTop, toJSON: () => ({}) })
      }}
      data-stuck={stuck ? '' : undefined}
      style={{ position: sticky ? 'sticky' : 'static', top }}
    />
  )
}
const scrollTo = (y: number, top: number) => { Y = y; boxTop = top; act(() => { window.dispatchEvent(new Event('scroll')) }) }

describe('useStuck', () => {
  it('false at the top, true once the box sits on its sticky line, false again back in flow', () => {
    const { container } = render(<Probe />)
    const el = container.firstElementChild!
    expect(el.hasAttribute('data-stuck')).toBe(false)
    scrollTo(40, 80) // still in flow, 80 below a 56 line
    expect(el.hasAttribute('data-stuck')).toBe(false)
    scrollTo(300, 56) // on the line
    expect(el.hasAttribute('data-stuck')).toBe(true)
    scrollTo(10, 110)
    expect(el.hasAttribute('data-stuck')).toBe(false)
  })

  it('reads again when the element\'s own `top` glide ends (the header hid or came back with no scroll under way)', () => {
    const { container } = render(<Probe top="0px" />)
    const el = container.firstElementChild as HTMLElement
    Y = 500
    boxTop = 0
    act(() => { el.dispatchEvent(new Event('transitionend', { bubbles: true })) })
    expect(el.hasAttribute('data-stuck')).toBe(true)
  })

  it('never for a box that is not sticky, at the very top of the page, or while off', () => {
    const a = render(<Probe sticky={false} />)
    scrollTo(300, 0)
    expect(a.container.firstElementChild!.hasAttribute('data-stuck')).toBe(false)
    cleanup()
    const b = render(<Probe />)
    scrollTo(0, 56)
    expect(b.container.firstElementChild!.hasAttribute('data-stuck')).toBe(false)
    cleanup()
    const c = render(<Probe on={false} />)
    scrollTo(300, 56)
    expect(c.container.firstElementChild!.hasAttribute('data-stuck')).toBe(false)
  })
})
