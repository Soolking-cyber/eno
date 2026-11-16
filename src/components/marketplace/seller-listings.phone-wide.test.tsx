// @vitest-environment jsdom
/**
 * ⛔ /c/rentals ON A PHONE: ONE COLUMN OF LARGE SQUARE CARDS, AND THE ONE ROW STAYS (owner-approved 2026-11-14, cook r06 rentals-a —
 * SellerListings `phoneWide`, passed by (index)/page.tsx on rentals only). Pinned here:
 *   · the grid is LISTING_GRID_WIDE and every card is `wide` with the full-width `sizes`; the sort's placeholders are wide too;
 *   · photos are held from the THIRD card (HELD_FROM_WIDE), not the seventh;
 *   · `priority` is NOT changed by it — the first four stay eager, so a desktop's first row loads as before;
 *   · with `phoneOneRow` the strip bleeds to the screen edges (8px above and below), its sort glyph is 18px ink, and the pinned
 *     strip stays at the safe-area top while the header is hidden — below sm only (every class `max-sm:`);
 *   · without `phoneWide` nothing of it renders: every other category, the district pages and the storefronts are untouched.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { LISTING_GRID, LISTING_GRID_WIDE, WIDE_CARD_SIZES } from './listing-grid'

const hidden = vi.hoisted(() => ({ value: false }))
const cards = vi.hoisted(() => ({ props: [] as Record<string, unknown>[], skeletons: [] as Record<string, unknown>[] }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => hidden.value }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: (p: { listing: SerializedListingCard } & Record<string, unknown>) => { cards.props.push(p); return <article data-testid="card">{p.listing.title}</article> },
}))
vi.mock('./listing-card-skeleton', () => ({
  ListingCardSkeleton: (p: Record<string, unknown>) => { cards.skeletons.push(p); return <div data-skeleton="" /> },
}))

const { SellerListings } = await import('./seller-listings')
const card = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, sellerId: 's' } as unknown as SerializedListingCard)
const MANY = Array.from({ length: 10 }, (_, i) => card(`r${i}`))
const SCOPE = { params: { category: 'rentals' }, total: 5344, pageSize: 10 }
const ONE_ROW = { chips: <a href="/c/rentals/go-vap" aria-label="Go Vap District" /> }
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** The cards' grid: the element whose class list is one of the two grid strings. */
const grid = (c: HTMLElement) => [...c.querySelectorAll('div')].find((d) => d.className.startsWith(LISTING_GRID_WIDE) || d.className.startsWith(LISTING_GRID))!

afterEach(() => { cleanup(); hidden.value = false; cards.props = []; cards.skeletons = []; vi.unstubAllGlobals() })
/** The cards of the LAST render (the component re-renders once after mount: its readiness flag). */
const drawn = () => cards.props.slice(-MANY.length)

describe('SellerListings phoneWide', () => {
  it('the grid is LISTING_GRID_WIDE; every card is wide with the full-width sizes; held from the third', () => {
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} phoneWide />)
    expect(grid(container).className).toBe(LISTING_GRID_WIDE)
    expect(drawn()).toHaveLength(10)
    for (const p of drawn()) {
      expect(p.wide).toBe(true)
      expect(p.sizes).toBe(WIDE_CARD_SIZES)
    }
    expect(drawn().map((p) => p.holdPhoto)).toEqual([false, false, true, true, true, true, true, true, true, true])
  })

  it('⛔ desktop parity: priority stays the first four, eager at every width', () => {
    render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} phoneWide />)
    expect(drawn().map((p) => p.priority)).toEqual([true, true, true, true, false, false, false, false, false, false])
  })

  it('the one row: bled to the screen edges with 8px of air, an 18px ink sort glyph once the order is not the page\'s own — all max-sm:', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} phoneWide />)
    const tabs = container.querySelector('[data-pinned-strip] [data-slot="tabs"]')!
    expect(tokens(tabs)).toEqual(expect.arrayContaining(['max-sm:-mx-3', 'max-sm:px-3', 'max-sm:py-2', 'border-b']))
    expect(tokens(tabs)).not.toContain('max-sm:py-1')
    // ⛔ At the page's own order the pill is its words alone, "Relevance ⌄" (owner, 2026-11-16, hub Q15): the ⌄ is its one glyph.
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toBe('Relevance')
    expect(pill.querySelectorAll('svg')).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Newest' })) })
    const glyph = screen.getByRole('combobox', { name: /Sort by/ }).querySelector('svg')!
    expect(tokens(glyph)).toContain('size-4.5')
    expect(tokens(glyph)).not.toContain('text-ink-4')
  })

  it('⛔ the one row STAYS PINNED below sm while the header is hidden (the 08-12 rule holds from sm)', () => {
    hidden.value = true
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} phoneWide />)
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.getAttribute('data-stay-pinned')).toBe('true')
    expect(tokens(bar)).toEqual(expect.arrayContaining(['top-[-9rem]', 'max-sm:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]']))
  })

  it('a sort in flight: the placeholders are the wide skeleton in the wide grid', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} phoneWide />)
    // The desktop tablist is in the DOM too (sm and up); pick a tab to start a sort.
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Newest' })) })
    expect(cards.skeletons.length).toBeGreaterThan(0)
    expect(cards.skeletons.every((p) => p.wide === true)).toBe(true)
    expect([...container.querySelectorAll('div[aria-hidden="true"]')].some((d) => d.className === LISTING_GRID_WIDE)).toBe(true)
  })
})

describe('SellerListings without phoneWide — every other surface is untouched', () => {
  it('LISTING_GRID, no wide card, held from the seventh, the strip on the content box, the 08-12 pin', () => {
    hidden.value = true
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} phoneOneRow={ONE_ROW} />)
    expect(grid(container).className).toBe(LISTING_GRID)
    expect(drawn().every((p) => !p.wide && p.sizes === undefined)).toBe(true)
    expect(drawn().map((p) => p.holdPhoto).indexOf(true)).toBe(6)
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.hasAttribute('data-stay-pinned')).toBe(false)
    expect(bar.className).not.toContain('max-sm:top-')
    expect(tokens(bar.querySelector('[data-slot="tabs"]'))).not.toContain('max-sm:-mx-3')
  })
})
