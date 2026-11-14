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
 *     "was" price — and since 2026-11-14 so does a whole-thousand sale price of a million or more (owner-approved,
 *     decision 4); anything under a million, or an odd sale figure, keeps the narrow-surface default.
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
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
vi.mock('./price', () => ({
  Price: ({ price, className }: { price: number; className?: string }) => <span data-price={price} className={className}>{price}</span>,
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { GOODS_LINE_PX } from '@/lib/card-text'

/**
 * ⛔ THE GOODS PHONE CARD (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options and deploy";
 * ListingCard `look="goods"`): a goods card on a goods surface — price-led text, one grey tile under a multiplied photo, no
 * ring, no fade-in on scroll — every class `max-sm:`. A rental, a job or a teacher in the same surface keeps the shell card.
 */
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

const card = (patch: Record<string, unknown> = {}, look: 'goods' | 'none' = 'goods') =>
  render(<ListingCard listing={{ ...PHONE, ...patch } as SerializedListingCard} onOpen={vi.fn()} look={look === 'goods' ? 'goods' : undefined} />).container
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

afterEach(cleanup)

describe('ListingCard look="goods"', () => {
  it('marks the root for the phone-only reveal rule, and keeps the reveal class itself (desktop keeps it)', () => {
    const root = card().querySelector('[data-card-root]')!
    expect(root.getAttribute('data-look')).toBe('goods')
    expect(classes(root)).toContain('reveal-on-scroll')
  })

  it('price-led body: 8px under the photo, no gap between lines, a 28px price row, the sale price at the heading cut — phones only', () => {
    const c = card()
    const price = c.querySelector('[data-price="12800000"]')!
    expect(classes(price)).toEqual(expect.arrayContaining(['text-t-price', 'max-sm:text-t-h2']))
    expect(classes(price.parentElement)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-baseline', 'max-sm:min-h-7']))
    const body = price.parentElement!.parentElement!
    expect(classes(body)).toEqual(expect.arrayContaining(['pt-2.5', 'gap-0.5', 'max-sm:pt-2', 'max-sm:gap-0']))
    expect(GOODS_LINE_PX.top + GOODS_LINE_PX.price + GOODS_LINE_PX.title + GOODS_LINE_PX.metaTop + GOODS_LINE_PX.meta).toBe(76)
  })

  it('a per-unit or a word price keeps the shell 17px inside the same 28px row', () => {
    for (const patch of [{ priceUnit: 'VND/day', price: 700_000 }, { price: 0, listingType: 'free' }]) {
      const c = card(patch)
      const price = c.querySelector('[data-price]')!
      expect(classes(price)).toContain('text-t-price')
      expect(classes(price)).not.toContain('max-sm:text-t-h2')
      expect(classes(price.parentElement)).toContain('max-sm:min-h-7')
      cleanup()
    }
  })

  it('one tile: no ring on a phone, the photo multiplies onto its slide\'s grey (never in dark mode)', () => {
    const c = card()
    const media = c.querySelector('[data-rail-media]')!
    expect(classes(media)).toEqual(expect.arrayContaining(['media-hairline', 'bg-tint', 'isolate', 'max-sm:before:hidden']))
    const img = c.querySelector('[data-card-strip] img')!
    expect(classes(img)).toEqual(expect.arrayContaining(['object-cover', 'max-sm:mix-blend-multiply', 'max-sm:dark:mix-blend-normal']))
    expect(classes(img.parentElement)).toContain('max-sm:bg-tint')
  })

  it('only a goods card takes it: a rental, a job and a teacher in the same surface keep the shell card', () => {
    for (const patch of [
      { category: { icon: 'home', slug: 'rentals' }, priceUnit: 'VND/month', listingType: 'rent' },
      { category: { icon: 'briefcase', slug: 'jobs' }, listingType: 'job' },
      { category: { icon: 'user', slug: 'teachers' }, listingType: 'teacher' },
    ]) {
      const c = card(patch)
      expect(c.querySelector('[data-card-root]')!.hasAttribute('data-look')).toBe(false)
      expect(classes(c.querySelector('[data-rail-media]'))).not.toContain('max-sm:before:hidden')
      expect(c.querySelector('[class*="max-sm:text-t-h2"]')).toBeNull()
      cleanup()
    }
  })

  it('without the look the card is the shell card, class for class', () => {
    const plain = card({}, 'none')
    expect(plain.querySelector('[data-card-root]')!.hasAttribute('data-look')).toBe(false)
    expect(plain.innerHTML).not.toMatch(/max-sm:(mix-blend|before:hidden|text-t-h2|min-h-7|pt-2 )/)
  })
})

describe('ListingCardSkeleton look="goods"', () => {
  it('the goods body: 8 + a 22px bar in the 28px row + 20 + 2 + 18 = 76, phones only', () => {
    const { container } = render(<ListingCardSkeleton look="goods" />)
    const root = container.firstElementChild!
    expect(root.getAttribute('data-look')).toBe('goods')
    const body = root.children[1]
    expect(classes(body)).toEqual(expect.arrayContaining(['pt-2.5', 'max-sm:pt-2', 'max-sm:gap-0']))
    const bars = Array.from(body.children)
    expect(classes(bars[0])).toEqual(expect.arrayContaining(['h-[22px]', 'max-sm:my-0.75']))
    expect(classes(bars[1])).toContain('h-5')
    expect(classes(bars[2])).toEqual(expect.arrayContaining(['mt-0.5', 'h-[18px]']))
  })

  it('a teacher or a wide cell ignores it', () => {
    const { container } = render(<><ListingCardSkeleton look="goods" teacher /><ListingCardSkeleton look="goods" wide /></>)
    expect(container.querySelector('[data-look]')).toBeNull()
  })
})
