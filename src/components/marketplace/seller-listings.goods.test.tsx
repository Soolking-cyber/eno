// @vitest-environment jsdom
/**
 * ⛔ A GOODS CATEGORY ON A PHONE (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options and
 * deploy"; SellerListings `look="goods"`, (index)/page.tsx `goods`): no rule under the strip (transparent, its 1px kept), the
 * sort pill's words alone at the page's own order, the count muted at the strip's end, 12px from the strip to the grid, and the
 * price-led goods cards in rows 32px apart. Every class `max-sm:`; without the look nothing changes.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { LISTING_GRID } from './listing-grid'

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
const SCOPE = { params: { category: 'electronics' }, total: 64, pageSize: 10 }
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** The cards' grid: the element whose class list is one of the two grid strings. */
const grid = (c: HTMLElement) => [...c.querySelectorAll('div')].find((d) => d.className.startsWith(LISTING_GRID))!

afterEach(() => { cleanup(); hidden.value = false; cards.props = []; cards.skeletons = []; vi.unstubAllGlobals() })
const drawn = () => cards.props.slice(-MANY.length)
const goods = () => render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} look="goods" />)

describe('SellerListings look="goods"', () => {
  it('the strip keeps its hairline\'s 1px but paints it transparent below sm; the pinned bar stays the page\'s white', () => {
    const { container } = goods()
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(tokens(bar)).toContain('bg-background')
    const tabs = bar.querySelector('[data-slot="tabs"]')!
    expect(tokens(tabs)).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
  })

  it('the sort pill has no glyph at the page\'s own order ("Relevance ⌄")', () => {
    goods()
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toContain('Relevance')
    expect(pill.querySelectorAll('svg')).toHaveLength(1) // the ⌄ alone
  })

  it('the count at the strip\'s end is the meta role, muted — never under 13px', () => {
    const { container } = goods()
    const note = container.querySelector('[data-pinned-strip] p[aria-live]')!
    expect(tokens(note)).toEqual(expect.arrayContaining(['text-t-meta', 'text-muted-foreground', 'sm:hidden']))
    expect(tokens(note)).not.toContain('text-xs')
  })

  it('12px from the strip to the grid; rows 32px apart; every card and placeholder takes the goods look', () => {
    const { container } = goods()
    const root = container.querySelector('.space-y-4')!
    expect(tokens(root)).toContain('max-sm:space-y-3')
    expect(tokens(grid(container))).toContain('max-sm:gap-y-8')
    expect(drawn()).toHaveLength(10)
    for (const p of drawn()) expect(p.look).toBe('goods')
  })

  it('without the look: the rule, the glyph, the 12px count and the shell cards, as before', () => {
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} />)
    expect(tokens(container.querySelector('[data-slot="tabs"]'))).not.toContain('max-sm:border-b-transparent')
    expect(screen.getByRole('combobox', { name: /Sort by/ }).querySelectorAll('svg')).toHaveLength(2)
    expect(tokens(grid(container))).not.toContain('max-sm:gap-y-8')
    for (const p of drawn()) expect(p.look).toBeUndefined()
  })
})
