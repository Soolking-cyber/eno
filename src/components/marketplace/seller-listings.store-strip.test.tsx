// @vitest-environment jsdom
/**
 * ⛔ A STOREFRONT'S STRIP IS THE FILLED STRIP (owner, 2026-11-16 — hub Q15; review 2026-11-16: the path storefront still drew
 * the white strip with a ⇅ "Newest" while /s/[handle]'s explorer strip is filled and names its order). SellerListings
 * `strip="filled"`, below sm: the sort pill names the page's own order with no glyph, the pill is the field grey with no edge
 * (on the pill itself — the strip is in flow, and globals.css's filled rule reaches only `#explorer-toolbar` and
 * `[data-pinned-strip]`), and no rule under the strip. The cards stay the shop's own (not `look`'s goods card), and the strip
 * does not pin. Without it nothing changes.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { LISTING_GRID } from './listing-grid'

const cards = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: (p: { listing: SerializedListingCard } & Record<string, unknown>) => { cards.props.push(p); return <article data-testid="card">{p.listing.title}</article> },
}))

const { SellerListings } = await import('./seller-listings')
const card = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, sellerId: 's' } as unknown as SerializedListingCard)
const ROWS = Array.from({ length: 6 }, (_, i) => card(`r${i}`))
const SCOPE = { params: { seller: 's' }, total: 40, pageSize: 6 }
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** As seller-storefront.tsx draws the shop's own grid. */
const shop = (strip?: 'filled') =>
  render(<SellerListings listings={ROWS} searchable sortable initialSort="recent" serverScope={SCOPE} ownShop strip={strip} />)

afterEach(() => { cleanup(); cards.props = [] })

describe('SellerListings strip="filled" — the path storefront\'s strip, as /s/[handle]\'s', () => {
  it('the sort pill names the shop\'s own order, "Newest", with no glyph — the ⌄ alone', () => {
    shop('filled')
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toContain('Newest')
    expect(pill.querySelectorAll('svg')).toHaveLength(1)
  })

  it('the pill is filled on a phone, on itself: the field grey with no edge, a step deeper pressed, hovered or open', () => {
    shop('filled')
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(tokens(pill)).toEqual(expect.arrayContaining([
      'pill-rest', 'max-sm:border-transparent', 'max-sm:bg-muted', 'max-sm:hover:bg-secondary', 'max-sm:active:bg-secondary',
      'max-sm:[&_svg]:text-ink-3', 'max-sm:data-popup-open:border-transparent', 'max-sm:data-popup-open:bg-secondary',
    ]))
    // Only below sm: from sm the white pill stands (the tablist serves there anyway).
    expect(tokens(pill)).toContain('bg-background')
  })

  it('no rule under the strip on a phone (its 1px kept, transparent); the strip stays in flow — storefronts never pin', () => {
    const { container } = shop('filled')
    expect(container.querySelector('[data-pinned-strip]')).toBeNull()
    expect(tokens(container.querySelector('[data-slot="tabs"]'))).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
  })

  it('the cards stay the shop\'s own: not the goods card, not the goods rows', () => {
    const { container } = shop('filled')
    expect(cards.props.length).toBeGreaterThan(0)
    expect(cards.props.every((p) => p.look === undefined && p.ownShop === true)).toBe(true)
    const grid = [...container.querySelectorAll('div')].find((d) => d.className.startsWith(LISTING_GRID))!
    expect(tokens(grid)).not.toContain('max-sm:gap-y-10')
  })

  it('without it, as before: the ⇅ beside "Newest", the white pill, the rule', () => {
    const { container } = shop()
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.querySelectorAll('svg')).toHaveLength(2)
    expect(tokens(pill).filter((t) => t.startsWith('max-sm:'))).toEqual([])
    expect(tokens(container.querySelector('[data-slot="tabs"]'))).not.toContain('max-sm:border-b-transparent')
  })
})
