// @vitest-environment jsdom
/**
 * THE CARD AS A FACEBOOK-SPACED PHOTO TILE (owner, 2026-10-18: "minimal squircle corners … spaced facebook
 * marketplace style … a bit larger") — pinned at the component, because listing-card.tsx is a landmine file and
 * none of this shows up as a behaviour:
 *   · the photo, the root and the card link wear ONE corner, `rounded-media`, and the photo carries the hairline;
 *   · no full-width gradient scrims sit on the photo any more;
 *   · the slot pips are hidden below sm (the swipe and the "+N" doorway still exist);
 *   · the body's text is inset onto the page gutter on a phone (`px-2 sm:px-0.5`) and the title is regular weight;
 *   · the photo's `sizes` is the grid's derived LISTING_CARD_SIZES;
 *   · a per-unit price of a million or more hands <Price> the millions threshold — for the price AND its struck
 *     "was" price — while a sale price keeps the narrow-surface default.
 * The trust-chip test's harness: everything the card pulls in is stubbed; Price records the props it was given.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { HUGE_VND, RATE_COMPACT_VND } from '@/lib/vnd'
import { LISTING_CARD_SIZES } from './listing-grid'

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
  useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
vi.mock('./price', () => ({
  Price: ({ price, compact, compactAbove }: { price: number; compact?: boolean; compactAbove?: number }) => (
    <span data-price={price} data-compact={compact ? '' : undefined} data-compact-above={compactAbove}>{price}</span>
  ),
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const RENT = {
  id: 'l1',
  title: 'Căn hộ 2PN Quận 7',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400', 'https://picsum.photos/seed/b/400', 'https://picsum.photos/seed/c/400'],
  video: null,
  price: 8_500_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'rent',
  location: 'Hồ Chí Minh',
  condition: null,
  savedCount: 0,
  negotiable: true,
  isPartnerBooking: false,
  sellerId: 'member-seller-1',
  seller: { trustScore: 100, isBusiness: false, officialPartner: false },
  category: { icon: 'home', slug: 'rentals' },
  postedAt: '2026-09-20T00:00:00.000Z',
  brandSlug: null,
  model: null,
  lat: null,
  lng: null,
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...RENT, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

afterEach(cleanup)

describe('ListingCard — the photo tile', () => {
  it('photo, root and card link share the rounded-media corner; the photo carries the hairline', () => {
    const c = card()
    const media = c.querySelector('[data-rail-media]')
    expect(classes(media)).toEqual(expect.arrayContaining(['rounded-media', 'media-hairline', 'isolate', 'relative']))
    expect(classes(media)).not.toContain('rounded-2xl')
    expect(classes(c.querySelector('[data-card-root]'))).toContain('rounded-media')
    expect(classes(c.querySelector('[data-card-link]'))).toContain('rounded-media')
  })

  it('draws no full-width gradient scrim over the photo', () => {
    const media = card().querySelector('[data-rail-media]')!
    expect(media.querySelector('[class*="bg-gradient-to"]')).toBeNull()
  })

  it('hides the slot pips below sm — and still has them from sm, where they count the slots', () => {
    const media = card().querySelector('[data-rail-media]')!
    const pips = Array.from(media.querySelectorAll('div')).find((d) => classes(d).includes('-translate-x-1/2'))
    expect(pips, 'the pip row').toBeDefined()
    expect(classes(pips!)).toContain('max-sm:hidden')
    expect(pips!.children.length).toBe(3)
  })

  it('insets the body onto the page gutter on a phone and keeps it flush from sm; the title is regular weight', () => {
    const c = card()
    const body = c.querySelector('[data-rail-media]')!.nextElementSibling
    expect(classes(body)).toEqual(expect.arrayContaining(['px-2', 'sm:px-0.5', 'pt-2']))
    expect(classes(body)).not.toContain('px-0.5')
    expect(classes(c.querySelector('h3'))).toEqual(expect.arrayContaining(['font-normal', 'text-sm']))
  })

  it("asks for the grid's derived photo sizes by default", () => {
    expect(card().querySelector('img')!.getAttribute('sizes')).toBe(LISTING_CARD_SIZES)
  })
})

describe('ListingCard — the card price form', () => {
  it('a rent of a million or more reads in millions — its struck was-price in the same form', () => {
    const c = card({ prevPrice: 9_500_000 })
    const prices = c.querySelectorAll('[data-price]')
    expect(prices).toHaveLength(2)
    for (const p of prices) {
      expect(p.hasAttribute('data-compact')).toBe(true)
      expect(Number(p.getAttribute('data-compact-above'))).toBe(RATE_COMPACT_VND)
    }
  })

  it('a sale price keeps the full figure (only HUGE_VND compacts), and so does a rent under a million', () => {
    expect(Number(card({ priceUnit: '', listingType: 'sell', price: 41_990_000 }).querySelector('[data-price]')!.getAttribute('data-compact-above'))).toBe(HUGE_VND)
    cleanup()
    expect(Number(card({ price: 950_000 }).querySelector('[data-price]')!.getAttribute('data-compact-above'))).toBe(HUGE_VND)
  })
})
