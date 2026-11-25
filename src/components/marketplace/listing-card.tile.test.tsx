// @vitest-environment jsdom
/**
 * ⛔ THE GOODS LISTING PAGE'S SHELF CARD (owner-approved 2026-11-15 (build 7), cook r07 "item": "calmer shelves"; ListingCard
 * `look="tile"`, passed by SameSellerShelf / RelatedListings on the goods sheet's phone grid). Below sm only: the goods card's ONE
 * TILE (the photo multiplied onto the field grey in light mode, no 5% ring) and "Ad" as a plain 700 13 muted label, still on
 * every sponsored card. The price, the title, the body, and the photo's square and size are the shell card's. The harness is
 * listing-card.goods.test.tsx's: everything the card pulls in is stubbed.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, fetchPriority: _fp, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { Heart: Icon, Building2: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Play: Icon, ArrowRight: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  useTr: (s: string) => s,
}))
vi.mock('./listing-content', () => ({
  useLocalized: (title: string) => title,
  PostedAgo: () => null,
}))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./price', () => ({
  Price: ({ price, className }: { price: number; className?: string }) => <span data-price={price} className={className}>{price}</span>,
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const PHONE = {
  id: 'g1',
  title: 'iPhone 16 128GB',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400', 'https://picsum.photos/seed/b/400'],
  video: null,
  price: 12_800_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND',
  listingType: 'sell',
  location: 'Hồ Chí Minh',
  condition: 'used',
  savedCount: 0,
  negotiable: true,
  isPartnerBooking: false,
  sellerId: 'member-seller-1',
  seller: { trustScore: 100, isBusiness: false, officialPartner: false },
  category: { icon: 'smartphone', slug: 'electronics' },
  postedAt: '2026-09-20T00:00:00.000Z',
  brandSlug: null,
  model: null,
  lat: null,
  lng: null,
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown> = {}, look?: 'tile' | 'goods', extra: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...PHONE, ...patch } as SerializedListingCard} onOpen={vi.fn()} look={look} {...extra} />).container
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

afterEach(cleanup)

describe('ListingCard look="tile"', () => {
  it('one tile below sm: no ring, the photo multiplied onto its slide\'s field grey (never in dark mode); the square stays', () => {
    const c = card({}, 'tile')
    const media = c.querySelector('[data-rail-media]')!
    // w-full + bg-tint live in .card-media (globals.css; listing-card.classes.test.ts pins them).
    expect(classes(media)).toEqual(expect.arrayContaining(['aspect-square', 'card-media', 'media-hairline', 'max-sm:before:hidden']))
    const img = c.querySelector('[data-card-strip] img')!
    expect(classes(img)).toEqual(expect.arrayContaining(['object-cover', 'max-sm:mix-blend-multiply', 'max-sm:dark:mix-blend-normal']))
    expect(classes(img.parentElement)).toContain('max-sm:bg-tint')
  })

  it('only the tile: the body, the price and the reveal are the shell card\'s (no data-look, no heading-cut price)', () => {
    const c = card({}, 'tile')
    expect(c.querySelector('[data-card-root]')!.hasAttribute('data-look')).toBe(false)
    expect(c.querySelector('[class*="max-sm:text-t-h2"]')).toBeNull()
    expect(c.querySelector('[class*="max-sm:min-h-7"]')).toBeNull()
  })

  it('any category on the shelf takes it (a hire bike too); a teacher card never', () => {
    const bike = card({ category: { icon: 'bike', slug: 'rentals' }, listingType: 'rent', priceUnit: 'VND/day', price: 300_000 }, 'tile')
    expect(classes(bike.querySelector('[data-rail-media]'))).toContain('max-sm:before:hidden')
    cleanup()
    const teacher = card({ category: { icon: 'user', slug: 'teachers' }, listingType: 'teacher' }, 'tile')
    expect(classes(teacher.querySelector('[data-rail-media]'))).not.toContain('max-sm:before:hidden')
  })

  it('"Ad" stays on every sponsored card, as a plain label below sm (no chip); the goods look and the shell keep the chip', () => {
    const tile = card({ isSponsored: true }, 'tile')
    const ad = tile.querySelector('[data-ad-marker]')!
    expect(ad.textContent).toBe('Ad')
    expect(classes(ad)).toEqual(expect.arrayContaining(['shrink-0', 'max-sm:bg-transparent', 'max-sm:px-0', 'max-sm:py-0', 'max-sm:text-t-meta', 'max-sm:font-bold', 'max-sm:text-muted-foreground']))
    // Every class it adds is max-sm: — from sm the chip is the chip.
    cleanup()
    const shell = card({ isSponsored: true })
    const chip = shell.querySelector('[data-ad-marker]')!
    const added = classes(ad).filter((c) => !classes(chip).includes(c))
    for (const c of added) expect(c).toMatch(/^max-sm:/)
    expect(classes(chip)).not.toContain('max-sm:bg-transparent')
    cleanup()
    expect(classes(card({ isSponsored: true }, 'goods').querySelector('[data-ad-marker]'))).not.toContain('max-sm:bg-transparent')
  })

  it('without a look the card is the shell card', () => {
    expect(card().innerHTML).not.toMatch(/max-sm:(mix-blend|before:hidden|bg-transparent)/)
  })
})
