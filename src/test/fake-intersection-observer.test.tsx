// @vitest-environment jsdom
/**
 * The explorer suites' IntersectionObserver fake (fake-intersection-observer.ts) keeps "the reader is at
 * the bottom" as a state. These pin when that state holds — an observer armed AFTER the scroll still
 * hears it — and when it ends: the grid gaining cells, or the same number of DIFFERENT cells replacing
 * them (a reviewer's case: comparing counts alone kept a filtered feed "at the bottom" and paged it with
 * no scroll).
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeIntersectionObserver } from './fake-intersection-observer'

const Grid = ({ ids }: { ids: string[] }) => (
  <div>{ids.map((id) => <div key={id} data-feed-card={id} />)}<div data-testid="sentinel" /></div>
)
const page = (prefix: string, n = 12) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
/** Arm a fresh observer on the sentinel and report whether its first entry said "in view". */
async function armedObserverHears(): Promise<boolean> {
  const cb = vi.fn()
  new IntersectionObserver(cb).observe(document.querySelector('[data-testid="sentinel"]')!)
  await new Promise((r) => setTimeout(r, 10))
  return cb.mock.calls.some(([entries]) => (entries as IntersectionObserverEntry[]).some((e) => e.isIntersecting))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the reader at the bottom of the feed', () => {
  it('is heard by an observer armed after the scroll, while the grid is unchanged (a browser\'s first entry)', async () => {
    const io = installFakeIntersectionObserver()
    const view = render(<Grid ids={page('a')} />)
    io.scrollToSentinel()
    view.rerender(<Grid ids={page('a')} />) // a re-render that keeps the same cells moves nothing
    expect(await armedObserverHears()).toBe(true)
  })

  it('is no longer at the bottom once the grid grows (the next page pushed the sentinel down)', async () => {
    const io = installFakeIntersectionObserver()
    const view = render(<Grid ids={page('a')} />)
    io.scrollToSentinel()
    view.rerender(<Grid ids={[...page('a'), ...page('b')]} />)
    expect(await armedObserverHears()).toBe(false)
  })

  it('is no longer at the bottom when as many DIFFERENT rows replace the grid (a filter change)', async () => {
    const io = installFakeIntersectionObserver()
    const view = render(<Grid ids={page('a')} />)
    io.scrollToSentinel()
    view.rerender(<Grid ids={page('c')} />)
    expect(await armedObserverHears()).toBe(false)
  })

  it('an observer that was told to stop watching hears nothing', async () => {
    const io = installFakeIntersectionObserver()
    render(<Grid ids={page('a')} />)
    const cb = vi.fn()
    const obs = new IntersectionObserver(cb)
    const sentinel = document.querySelector('[data-testid="sentinel"]')!
    obs.observe(sentinel)
    obs.unobserve(sentinel)
    io.scrollToSentinel()
    await new Promise((r) => setTimeout(r, 10))
    expect(cb).not.toHaveBeenCalled()
    expect(io.observing()).toBe(0)
  })
})
