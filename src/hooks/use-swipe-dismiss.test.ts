// @vitest-environment jsdom
/**
 * ⛔ A NORMAL FLICK DID NOT CLOSE A SHEET, AND A WRONG-WAY DRAG HIT A WALL.
 *
 * The release rule averaged velocity over the WHOLE gesture (axis lock and all) against 0.5 px/ms, so on the
 * 293px support sheet every 50–80px swipe at a real 0.16–0.18 px/ms snapped back, and only a 100px drag closed
 * it. These tests drive the hook with synthetic touch events on a mocked clock and pin the new contract:
 *   · the flick is judged on the LAST 100ms — 60px ending at 0.4 px/ms dismisses (it did not before);
 *   · a short wobble (20px) never dismisses, however fast;
 *   · a finger that stops before lifting is not a flick;
 *   · dragged the wrong way the panel moves at a fifth of the finger and comes home on release;
 *   · …unless something under the finger can scroll that way — then the drag is that scroller's.
 *
 * ⚠️ jsdom has no layout, so the panel's size is stubbed (offsetHeight/offsetWidth = 293, the measured sheet).
 * Without it the distance rule (30% of size) would read 0 and dismiss on ANY drag, hiding every velocity case.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseVelocity, useSwipeDismiss, type SwipeDirection } from './use-swipe-dismiss'

type Pt = { x: number; y: number }

function fire(el: Element, type: string, pts: Pt[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const list = pts.map((p) => ({ clientX: p.x, clientY: p.y, identifier: 0 }))
  const ended = type === 'touchend' || type === 'touchcancel'
  Object.defineProperty(ev, 'touches', { value: ended ? [] : list })
  Object.defineProperty(ev, 'changedTouches', { value: list })
  el.dispatchEvent(ev)
  return ev
}

const mounted: Array<() => void> = []

function mountPanel(direction: SwipeDirection = 'down', size = 293) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: size })
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: size })
  document.body.appendChild(el)
  const onDismiss = vi.fn()
  const { result, unmount } = renderHook(() => useSwipeDismiss<HTMLDivElement>({ direction, onDismiss }))
  act(() => { result.current(el) })
  mounted.push(() => { unmount(); el.remove() })
  return { el, onDismiss }
}

/**
 * A vertical drag from y=100: `steps` is a list of [msSinceLastEvent, yTravel] pairs. Each step advances the
 * mocked clock, then moves. `holdMs` waits before lifting.
 */
function drag(target: Element, steps: Array<[number, number]>, { holdMs = 0 } = {}) {
  const x = 200
  const y0 = 100
  fire(target, 'touchstart', [{ x, y: y0 }])
  const moves: Event[] = []
  for (const [dt, dy] of steps) {
    vi.advanceTimersByTime(dt)
    moves.push(fire(target, 'touchmove', [{ x, y: y0 + dy }]))
  }
  const last = steps.length ? steps[steps.length - 1][1] : 0
  if (holdMs) vi.advanceTimersByTime(holdMs)
  fire(target, 'touchend', [{ x, y: y0 + last }])
  return moves
}

/** `px` of travel at `pxPerMs`, as 10ms touchmoves, continuing from `from`. */
function ramp(from: number, px: number, pxPerMs: number): Array<[number, number]> {
  const n = Math.max(1, Math.round(px / (pxPerMs * 10)))
  return Array.from({ length: n }, (_, i) => [10, from + (px * (i + 1)) / n] as [number, number])
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  while (mounted.length) mounted.pop()!()
  vi.useRealTimers()
})

describe('releaseVelocity', () => {
  it('takes the slope across the trailing window, not the whole gesture', () => {
    // 20px over 200ms, then 40px in the last 100ms: whole-gesture 0.2 px/ms, trailing 0.4 px/ms.
    const s = [{ t: 0, p: 0 }, { t: 200, p: 20 }, { t: 250, p: 40 }, { t: 300, p: 60 }]
    expect(releaseVelocity(s, 300)).toBeCloseTo(0.4, 5)
  })
  it('is 0 when the finger stopped before lifting', () => {
    expect(releaseVelocity([{ t: 0, p: 0 }, { t: 50, p: 60 }], 200)).toBe(0)
  })
  it('reaches one sample back when the window holds a single point', () => {
    expect(releaseVelocity([{ t: 0, p: 0 }, { t: 150, p: 30 }, { t: 290, p: 90 }], 300)).toBeCloseTo(60 / 140, 5)
  })
})

describe('useSwipeDismiss — the flick', () => {
  it('dismisses a 60px swipe that ENDS at 0.4 px/ms (the old whole-gesture average, 0.2, never did)', () => {
    const { el, onDismiss } = mountPanel('down')
    // 20px slow (includes the 10px axis lock), then 40px at 0.4 px/ms → 60px total, under the 87.9px distance rule.
    drag(el, [...ramp(0, 20, 0.1), ...ramp(20, 40, 0.4)])
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss a 20px wobble, however fast', () => {
    const { el, onDismiss } = mountPanel('down')
    drag(el, ramp(0, 20, 0.8))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(el.style.transform).toBe('')
  })

  it('does not treat a fast swipe that then HELD STILL as a flick', () => {
    const { el, onDismiss } = mountPanel('down')
    drag(el, ramp(0, 60, 0.4), { holdMs: 150 })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('still dismisses on distance alone (30% of the panel), slow or not', () => {
    const { el, onDismiss } = mountPanel('down')
    drag(el, ramp(0, 100, 0.1), { holdMs: 300 })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('reads the flick along the panel direction — a right-hand sheet flicked right', () => {
    const { el, onDismiss } = mountPanel('right')
    fire(el, 'touchstart', [{ x: 100, y: 300 }])
    for (let i = 1; i <= 15; i++) { vi.advanceTimersByTime(10); fire(el, 'touchmove', [{ x: 100 + i * 4, y: 300 }]) }
    fire(el, 'touchend', [{ x: 160, y: 300 }])
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('useSwipeDismiss — dragging the wrong way', () => {
  it('moves the panel a fifth of the finger (friction, not a wall) and brings it home on release', () => {
    const { el, onDismiss } = mountPanel('down')
    fire(el, 'touchstart', [{ x: 200, y: 300 }])
    const moves: Event[] = []
    for (let i = 1; i <= 5; i++) { vi.advanceTimersByTime(16); moves.push(fire(el, 'touchmove', [{ x: 200, y: 300 - i * 10 }])) }
    expect(el.style.transform).toBe('translate3d(0,-10px,0)')
    // The panel moved, so the page must not scroll under it as well.
    expect(moves[moves.length - 1].defaultPrevented).toBe(true)
    expect(el.style.transition).toBe('none')
    fire(el, 'touchend', [{ x: 200, y: 250 }])
    expect(el.style.transform).toBe('')
    // The transition is handed back, so the CSS eases the panel home instead of snapping it.
    expect(el.style.transition).toBe('')
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('never dismisses, even when flicked hard the wrong way', () => {
    const { el, onDismiss } = mountPanel('down')
    fire(el, 'touchstart', [{ x: 200, y: 300 }])
    for (let i = 1; i <= 10; i++) { vi.advanceTimersByTime(10); fire(el, 'touchmove', [{ x: 200, y: 300 - i * 20 }]) }
    fire(el, 'touchend', [{ x: 200, y: 100 }])
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('leaves a wrong-way drag to a list under the finger that can scroll that way', () => {
    const { el } = mountPanel('down')
    const list = document.createElement('div')
    list.style.overflowY = 'auto'
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
    list.scrollTop = 0
    el.appendChild(list)
    fire(list, 'touchstart', [{ x: 200, y: 300 }])
    let last: Event | null = null
    for (let i = 1; i <= 5; i++) { vi.advanceTimersByTime(16); last = fire(list, 'touchmove', [{ x: 200, y: 300 - i * 10 }]) }
    expect(el.style.transform).toBe('')
    expect(last!.defaultPrevented).toBe(false)
    fire(list, 'touchend', [{ x: 200, y: 250 }])
  })
})
