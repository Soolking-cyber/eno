// @vitest-environment jsdom
/**
 * THE /c PAGES PIN THEIR SORT STRIP (UI climb 2026-11-09, phone UX hunt): `pinStrip` wraps the strip in Home's sticky bar, which
 * leaves with the header on scroll-down and returns under it (useHideOnScroll, owner 2026-08-12). Storefronts and the vehicle hub
 * do not pass it and keep their in-flow strip — and never run the scroll hook.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

const hidden = vi.hoisted(() => ({ value: false, calls: 0 }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => { hidden.calls++; return hidden.value } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: SerializedListingCard }) => <article data-testid="card">{listing.title}</article>,
}))

const { SellerListings } = await import('./seller-listings')
const card = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0 } as unknown as SerializedListingCard)
const LIST = [card('a'), card('b'), card('c')]

afterEach(() => { cleanup(); hidden.value = false; hidden.calls = 0 })

describe('SellerListings pinStrip', () => {
  it('pins the strip under the header while the header shows', () => {
    const { container } = render(<SellerListings listings={LIST} sortable pinStrip />)
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.className).toMatch(/\bsticky\b/)
    expect(bar.className).toContain('top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+3.5rem)]')
    expect(bar.querySelector('[role="tablist"]')).toBeTruthy()
  })

  it('leaves with the header on scroll-down (parked above the viewport, back at the inset when focused)', () => {
    hidden.value = true
    const { container } = render(<SellerListings listings={LIST} sortable pinStrip />)
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.className).toContain('top-[-9rem]')
    expect(bar.className).toContain('focus-within:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]')
  })

  /**
   * /c/rentals' one control row (batch 93, decision 5, 2026-11-14): the pinned strip is that one row, and the count is on the
   * heading line, which scrolls away; the pinned strip carries none (the announced copy sits outside it).
   */
  it('with phoneOneRow the pinned strip is the one row and carries no count', () => {
    const many = Array.from({ length: 10 }, (_, i) => card(`r${i}`))
    const { container } = render(
      <SellerListings listings={many} sortable pinStrip serverScope={{ params: { category: 'rentals' }, total: 5344, pageSize: 10 }} phoneOneRow={{ chips: <a href="/c/rentals/go-vap" aria-label="Go Vap District" /> }} />,
    )
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.querySelector('[data-slot="tabs"]')!.className).toContain('max-sm:overflow-x-auto')
    expect(bar.querySelector('a[href="/c/rentals/go-vap"]')).toBeTruthy()
    expect(bar.querySelector('[aria-live]')).toBeNull()
    expect(bar.textContent).not.toMatch(/10 of 5,344/)
    // The announced copy is outside, before it.
    const live = container.querySelector('p.sr-only[aria-live]')!
    expect(live.textContent).toBe('10 of 5,344')
    expect(bar.contains(live)).toBe(false)
  })

  it('without pinStrip the strip stays in flow and the scroll hook never runs (storefronts, the vehicle hub)', () => {
    const { container } = render(<SellerListings listings={LIST} sortable />)
    expect(container.querySelector('[data-pinned-strip]')).toBeNull()
    expect(container.querySelector('[role="tablist"]')).toBeTruthy()
    expect(hidden.calls).toBe(0)
  })
})
