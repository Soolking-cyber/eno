/**
 * An IntersectionObserver for jsdom, for the listings explorer's paging tests
 * (listings-explorer.back-nav-filter.test.tsx, listings-explorer.feed-ux.test.tsx).
 *
 * ⛔ IT REPORTS WHEN OBSERVING BEGINS, AS A BROWSER DOES — and the explorer's infinite feed is built
 * on that. A real observer queues an entry for every target it starts observing (the spec starts each
 * observation at previousThresholdIndex -1, so the first update always notifies), describing where the
 * target is at the next rendering update. The explorer re-creates its observer whenever what it may do
 * changes (`hasMore`, `queryFetching`, the row count…), so a reader who is ALREADY at the sentinel when
 * it is re-armed pages on that first entry — not on their next scroll. (Its own comments rely on it:
 * "each append moved the sentinel back into its own 600px rootMargin".)
 *
 * ⚠️ THE FAKE THESE SUITES USED BEFORE REPORTED ONLY WHEN THE TEST FIRED IT, AND THAT WAS THE FLAKE.
 * The explorer arms its observer in a PASSIVE effect. For a default-priority render React commits the
 * rows in one scheduler task and runs that commit's passive effects in a later one, while
 * testing-library's `waitFor` resolves on the DOM mutation and then waits a single setTimeout(0). When
 * the timer won, `scrollToSentinel()` ran between the two: the twelve cards were on screen, no load-more
 * observer was armed yet (it had returned early on `hasMore === false` while the grid was empty), the
 * "scroll" went to nobody, and the observer armed a moment later was never told — "expected [ 'pm12-0',
 * … ] to have a length of 24 but got 12" (CI 36666973345 and 36668180434; ~1 local run in 6). More
 * time could not help, and the 5s `asyncUtilTimeout` added for it did not. Measured over 39 runs of the
 * storefront case: all 38 passes had the load-more observer armed at the moment of the scroll, and the
 * one failure had none. A browser cannot lose a scroll that way; only the fake could.
 *
 * THE MODEL: being at the bottom is a STATE, not an event. `scrollToSentinel()` fires every live
 * observer, exactly as before, and remembers the grid's cells — the elements themselves; an observer
 * that starts observing while the grid still holds exactly those cells gets an in-view first entry.
 * Anything that changes the grid — the next page's reserved cells, its rows, a filter replacing them
 * with as many others (React keys the cells by listing id, so different rows are different elements) —
 * moves the sentinel away, and the reader is no longer at the bottom until they scroll again. So one
 * scroll is still at most one page, whichever order React and the test happen to run in.
 * ⚠️ Only in-view first entries are delivered. A browser also reports the out-of-view ones; everything
 * these suites render ignores a miss, and the old fake delivered nothing at all, so leaving them out
 * changes nothing a test can see.
 * ⚠️ The first entry is a setTimeout(0): a test that scrolls under `vi.useFakeTimers()` must advance
 * them for it to arrive.
 * ⚠️ NO GEOMETRY — jsdom has no layout, so "at the bottom" is the test's say-so, as it always was here.
 * Whether a real sentinel is really in view is a browser question; the storefront paging proof for this
 * fake was 28 trials on a production build in Chrome, not this file.
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** One observer instance: its callback and the targets it observes now. */
type Observation = { cb: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver }

/** A grid cell: a card, or a row reserved for the page on its way (`pendingRows`). Both views use them. */
const GRID_CELLS = '[data-feed-card], [data-feed-skeleton]'
const gridCells = () => [...document.querySelectorAll(GRID_CELLS)]
const inView = (target: Element) => ({ isIntersecting: true, target } as unknown as IntersectionObserverEntry)

/** The grid's cells when the reader scrolled to its bottom; null once the grid has changed. */
let atBottomOf: Element[] | null = null
const stillAtBottom = () => {
  if (atBottomOf === null) return false
  const now = gridCells()
  return now.length === atBottomOf.length && now.every((cell, i) => cell === atBottomOf![i])
}
let moved: MutationObserver | null = null

export function installFakeIntersectionObserver(): { scrollToSentinel: () => void; observing: () => number } {
  const observations = new Set<Observation>()
  atBottomOf = null
  moved?.disconnect()
  moved = new MutationObserver(() => { if (!stillAtBottom()) atBottomOf = null })
  moved.observe(document.body, { childList: true, subtree: true })

  class FakeIntersectionObserver {
    private o: Observation
    constructor(cb: IntersectionObserverCallback) {
      this.o = { cb, targets: new Set(), self: this as unknown as IntersectionObserver }
      observations.add(this.o)
    }
    observe(el: Element) {
      const o = this.o
      o.targets.add(el)
      // The first entry arrives at the next rendering update, against the page as it is THEN.
      setTimeout(() => {
        if (!o.targets.has(el) || !stillAtBottom()) return
        act(() => { o.cb([inView(el)], o.self) })
      }, 0)
    }
    unobserve(el: Element) { this.o.targets.delete(el) }
    disconnect() { this.o.targets.clear() }
    takeRecords() { return [] }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

  return {
    /** How many targets are being observed right now, across every observer. */
    observing: () => [...observations].reduce((n, o) => n + o.targets.size, 0),
    /** "Scroll to the bottom": every live observer reports in view (the load-more sentinel among them), and so does any armed before the grid changes. */
    scrollToSentinel() {
      atBottomOf = gridCells()
      act(() => {
        for (const o of [...observations]) if (o.targets.size) o.cb([...o.targets].map(inView), o.self)
      })
    },
  }
}
