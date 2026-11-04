// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { resetVisitorEngagedForTests, useVisitorEngaged, whenVisitorEngaged } from './visitor-engaged'

const pointer = (type: string, pointerType: string) => Object.assign(new Event(type), { pointerType })
const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })

beforeEach(() => {
  vi.useFakeTimers()
  setHidden(false)
  resetVisitorEngagedForTests()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setHidden(false)
  resetVisitorEngagedForTests()
})

describe('a visitor who looks and leaves pays for nothing speculative', () => {
  it('nothing runs before the visitor does anything', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    vi.advanceTimersByTime(9_999)
    expect(then).not.toHaveBeenCalled()
  })

  it.each(['touchmove', 'keydown', 'wheel', 'scroll'])('%s counts, once', (gesture) => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    window.dispatchEvent(new Event(gesture))
    window.dispatchEvent(new Event(gesture))
    vi.advanceTimersByTime(200)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a mouse moving counts', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    window.dispatchEvent(pointer('pointermove', 'mouse'))
    vi.advanceTimersByTime(200)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a tap does not count: what it asked for must not share the phone with what this releases', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    const tap = [
      new Event('touchstart'),
      pointer('pointerdown', 'touch'),
      pointer('pointermove', 'touch'), // the finger's small wobble
      new Event('touchend'),
      pointer('pointerup', 'touch'),
      new Event('mousemove'),
      new Event('mousedown'),
      new Event('mouseup'),
      new Event('click'),
    ]
    for (const e of tap) window.dispatchEvent(e)
    vi.advanceTimersByTime(9_999)
    expect(then).not.toHaveBeenCalled()
    // Someone who tapped something that did not navigate is still reached by the grace.
    vi.advanceTimersByTime(201)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('the waiting work does not run inside the gesture, ahead of that gesture\'s own handlers', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    window.dispatchEvent(new Event('touchmove'))
    expect(then).not.toHaveBeenCalled()
    const later = vi.fn()
    whenVisitorEngaged(later)
    expect(later).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a rail scrolling itself is not the visitor; a finger on the rail is', () => {
    const rail = document.body.appendChild(document.createElement('div'))
    const then = vi.fn()
    whenVisitorEngaged(then)
    rail.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(then).not.toHaveBeenCalled()
    rail.dispatchEvent(new Event('touchmove', { bubbles: true }))
    vi.advanceTimersByTime(200)
    expect(then).toHaveBeenCalledTimes(1)
    rail.remove()
  })

  it('someone reading the first screen without touching it gets there after the grace', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    vi.advanceTimersByTime(10_200)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a tab hidden from the start waits, and the grace starts when it is shown', () => {
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    const then = vi.fn()
    whenVisitorEngaged(then)
    vi.advanceTimersByTime(60_000)
    expect(then).not.toHaveBeenCalled()
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(9_999)
    expect(then).not.toHaveBeenCalled()
    vi.advanceTimersByTime(201)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('time in another tab does not count: 1 s read, 8 s away, back for 1 s is not ten seconds of reading', () => {
    const then = vi.fn()
    whenVisitorEngaged(then)
    vi.advanceTimersByTime(1_000)
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(8_000)
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1_200)
    expect(then).not.toHaveBeenCalled()
    vi.advanceTimersByTime(9_000)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a reader the browser put back down the page is engaged from the start', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 })
    resetVisitorEngagedForTests()
    const then = vi.fn()
    whenVisitorEngaged(then)
    expect(then).toHaveBeenCalledTimes(1)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('once engaged, a later caller runs at once (a soft navigation does not go back to waiting)', () => {
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(200)
    const then = vi.fn()
    whenVisitorEngaged(then)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('a card that left before the visitor engaged is not called', () => {
    const then = vi.fn()
    const stop = whenVisitorEngaged(then)
    stop()
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(200)
    expect(then).not.toHaveBeenCalled()
  })

  it('the hook flips with the first gesture', () => {
    const { result } = renderHook(() => useVisitorEngaged())
    expect(result.current).toBe(false)
    act(() => {
      window.dispatchEvent(new Event('touchmove'))
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe(true)
  })
})
