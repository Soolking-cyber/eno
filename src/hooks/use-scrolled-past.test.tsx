// @vitest-environment jsdom
/**
 * useScrolledPast (build 8, the floating Map's trigger — src/components/marketplace/map-float.ts): one IntersectionObserver; "past"
 * only once the whole box is above the screen, never for a box below it or a display:none box (an empty rect at 0); false
 * while off, with no element, and where there is no IntersectionObserver (it then never observes).
 */
import React, { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrolledPast } from './use-scrolled-past'

const observed: { el: Element; cb: IntersectionObserverCallback; off: boolean }[] = []
class IO {
  private rec?: { el: Element; cb: IntersectionObserverCallback; off: boolean }
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) { this.rec = { el, cb: this.cb, off: false }; observed.push(this.rec) }
  disconnect() { if (this.rec) this.rec.off = true }
  unobserve() {}
  takeRecords() { return [] }
}
const fire = (isIntersecting: boolean, bottom: number) =>
  act(() => { const o = observed.at(-1)!; o.cb([{ isIntersecting, boundingClientRect: { bottom } } as IntersectionObserverEntry], {} as IntersectionObserver) })

function Probe({ on = true }: { on?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const past = useScrolledPast(ref, on)
  return <div ref={ref} data-past={String(past)} />
}
const past = () => document.querySelector('[data-past]')!.getAttribute('data-past')

beforeEach(() => { observed.length = 0; vi.stubGlobal('IntersectionObserver', IO) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('useScrolledPast', () => {
  it('false until the box is wholly above the screen; true there; false again once any of it is back', () => {
    render(<Probe />)
    expect(past()).toBe('false')
    fire(true, 120)
    expect(past()).toBe('false')
    fire(false, -1)
    expect(past()).toBe('true')
    fire(true, 3)
    expect(past()).toBe('false')
  })

  it('a box below the screen, or a display:none one (an empty rect at 0), is never past', () => {
    render(<Probe />)
    fire(false, 900)
    expect(past()).toBe('false')
    fire(false, 0)
    expect(past()).toBe('false')
  })

  it('off: never observes, always false; turning off ignores the last answer and disconnects', () => {
    const view = render(<Probe on={false} />)
    expect(observed).toHaveLength(0)
    view.rerender(<Probe />)
    fire(false, -10)
    expect(past()).toBe('true')
    view.rerender(<Probe on={false} />)
    expect(past()).toBe('false')
    expect(observed[0].off).toBe(true)
  })

  it('no IntersectionObserver (an old WebView): false, and nothing throws', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<Probe />)
    expect(past()).toBe('false')
  })
})
