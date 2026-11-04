// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CardVideo } from './card-video'
import { resetVisitorEngagedForTests } from '@/lib/visitor-engaged'

/** A clip is 4-20 MB: on a first screen it waits until the visitor has done something, and a real hover still starts it at once. */
const observers: { cb: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
const see = (visible: boolean) => {
  const entry = { isIntersecting: visible, intersectionRatio: visible ? 1 : 0, boundingClientRect: { width: 200 } } as unknown as IntersectionObserverEntry
  act(() => { observers.at(-1)!.cb([entry], {} as IntersectionObserver) })
}
const hoverable = (yes: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('hover') ? yes : false, addEventListener() {}, removeEventListener() {} }))

beforeEach(() => {
  vi.useFakeTimers()
  resetVisitorEngagedForTests()
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(cb: IntersectionObserverCallback) { observers.push({ cb, observe: this.observe, disconnect: this.disconnect }) }
  })
  hoverable(false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetVisitorEngagedForTests()
})

describe('a card\'s clip waits for the visitor', () => {
  it('nothing watches the viewport and no <video> exists before the visitor does anything', () => {
    const { container } = render(<CardVideo src="/a.mp4" hover={false} />)
    act(() => { vi.advanceTimersByTime(9_000) })
    expect(observers).toHaveLength(0)
    expect(container.querySelector('video')).toBeNull()
  })

  it('after the first scroll a card in view plays, after the usual settle', () => {
    const { container } = render(<CardVideo src="/a.mp4" hover={false} />)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(200)
    })
    expect(observers).toHaveLength(1)
    see(true)
    expect(container.querySelector('video')).toBeNull()
    act(() => { vi.advanceTimersByTime(450) })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/a.mp4')
  })

  it('someone reading the first screen untouched gets the clip after the grace', () => {
    const { container } = render(<CardVideo src="/a.mp4" hover={false} />)
    act(() => { vi.advanceTimersByTime(10_200) })
    see(true)
    act(() => { vi.advanceTimersByTime(450) })
    expect(container.querySelector('video')).not.toBeNull()
  })

  it('a card rendered after the visitor engaged starts watching at once', () => {
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(200)
    })
    render(<CardVideo src="/a.mp4" hover={false} />)
    expect(observers).toHaveLength(1)
  })

  it('a real hover does not wait', () => {
    hoverable(true)
    const { container } = render(<CardVideo src="/a.mp4" hover />)
    expect(observers).toHaveLength(0)
    expect(container.querySelector('video')).not.toBeNull()
  })

  it('a card gone before the visitor engaged starts nothing later', () => {
    const { unmount } = render(<CardVideo src="/a.mp4" hover={false} />)
    unmount()
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(200)
    })
    expect(observers).toHaveLength(0)
  })

  it('leaving view stops the clip and disconnects on unmount', () => {
    const { container, unmount } = render(<CardVideo src="/a.mp4" hover={false} />)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(200)
    })
    see(true)
    act(() => { vi.advanceTimersByTime(450) })
    see(false)
    expect(container.querySelector('video')).toBeNull()
    const { disconnect } = observers[0]
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
