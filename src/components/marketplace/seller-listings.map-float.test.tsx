// @vitest-environment jsdom
/**
 * ⛔ /c/rentals' MAP FLOATS ONCE THE HEAD IS GONE (owner-approved 2026-11-15 (build 8), cook r08 rentals — map-float.ts; seller-listings.tsx
 * PinnedStrip `mapFloatAfter`). The pinned strip is the Map link's host: while the list header is on screen it says nothing (the
 * link is the row's chip, and the server HTML and first client render agree); once the header is past the top of the screen it
 * renders `data-map-float` — "shown" while the bars show, "hidden" while the header's hide signal says they are away. Only on the
 * wide one-row page, whose empty list-head marker it watches (it held the free-check line until the renters' availability check
 * was removed, 2026-11-25); every other strip never hosts it.
 * IntersectionObserver and the hide signal are stubbed: what is under test is the strip's answer to them.
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

const h = vi.hoisted(() => ({ headerHidden: false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rentals' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: SerializedListingCard }) => <article data-testid="card">{listing.title}</article>,
}))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => h.headerHidden }))

import { SellerListings } from './seller-listings'

/** One stubbed observer per observed element; `fire` answers for it as the browser would. */
const observers: { el: Element; cb: IntersectionObserverCallback }[] = []
class IO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) { observers.push({ el, cb: this.cb }) }
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
}
function fire(el: Element, isIntersecting: boolean, bottom: number) {
  const o = observers.find((x) => x.el === el)!
  act(() => o.cb([{ isIntersecting, boundingClientRect: { bottom } } as IntersectionObserverEntry], {} as IntersectionObserver))
}

const PAGE = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, title: `Home ${i}`, price: 1, postedAt: '2026-11-01T00:00:00.000Z' }) as unknown as SerializedListingCard)
const CHIPS = <a href="/?category=rentals&homes=1&view=map" rel="nofollow" aria-label="Map" />
function rentals(extra: Record<string, unknown> = {}) {
  return (
    <SellerListings
      listings={PAGE}
      sortable
      pinStrip
      phoneWide
      serverScope={{ params: { category: 'rentals' }, total: 5344, pageSize: 48 }}
      phoneOneRow={{ chips: CHIPS }}
      {...extra}
    />
  )
}
const strip = () => document.querySelector<HTMLElement>('[data-pinned-strip]')!
const head = () => document.querySelector<HTMLElement>('[data-list-head]')!

beforeEach(() => { observers.length = 0; h.headerHidden = false; vi.stubGlobal('IntersectionObserver', IO); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PinnedStrip hosts the floating Map on /c/rentals (build 8)', () => {
  it('nothing while the list header is on screen: no attribute, no lift — the server HTML and the first render agree', () => {
    render(rentals())
    expect(strip().classList.contains('group/mapfloat')).toBe(true)
    expect(strip().hasAttribute('data-map-float')).toBe(false)
    expect(observers.map((o) => o.el)).toContain(head())
    fire(head(), true, 200)
    expect(strip().hasAttribute('data-map-float')).toBe(false)
    // Below the screen is not "past" either, and neither is a display:none box (an empty rect at 0).
    fire(head(), false, 0)
    expect(strip().hasAttribute('data-map-float')).toBe(false)
  })

  it('past the top: "shown" while the bars show, "hidden" while they are away; back on screen: gone', () => {
    const view = render(rentals())
    fire(head(), false, -4)
    expect(strip().getAttribute('data-map-float')).toBe('shown')
    h.headerHidden = true
    view.rerender(rentals())
    expect(strip().getAttribute('data-map-float')).toBe('hidden')
    fire(head(), true, 30)
    expect(strip().hasAttribute('data-map-float')).toBe(false)
  })

  it('never on a two-up grid or a strip with no one-row chips', () => {
    for (const extra of [{ phoneWide: false }, { phoneOneRow: undefined }]) {
      render(rentals(extra))
      expect(strip().classList.contains('group/mapfloat')).toBe(false)
      expect(observers).toHaveLength(0)
      cleanup()
    }
  })
})
