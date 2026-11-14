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
  // A marker, so the info line's time can be found (relative-time.tsx is pinned on its own).
  PostedAgo: () => {
    const ago = '2h ago'
    return <time data-posted-ago="">{ago}</time>
  },
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
 * ListingCard `look="goods"`): a goods card on a goods surface — one grey tile under a multiplied photo, no ring, no fade-in on
 * scroll — every class `max-sm:`. A rental, a job or a teacher in the same surface keeps the shell card.
 * ⛔ Since build 8 (owner-approved 2026-11-15, cook r08 goods — StockX's card): ONE ORDER THAT ENDS ON THE PRICE — title (ink),
 * info line, then the price, in the DOM on a phone (the price row twice, a class picking one per width) — and the "Ad" chip as
 * the photo's white plate below sm.
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

  it('⛔ one order that ends on the price (build 8): title → info line → price in the DOM on a phone; from sm the shell\'s price → title → info line', () => {
    const c = card()
    const prices = c.querySelectorAll('[data-price="12800000"]')
    expect(prices).toHaveLength(2)
    const [shellRow, phoneRow] = [...prices].map((p) => p.parentElement!)
    const body = shellRow.parentElement!
    expect(phoneRow.parentElement).toBe(body)
    const kids = [...body.children]
    const h3 = body.querySelector('h3')!
    const meta = body.querySelector('div.text-t-meta')!
    // The shell's row leads (from sm), the title and the info line follow, the phone's row closes the block.
    expect(kids.indexOf(shellRow)).toBeLessThan(kids.indexOf(h3))
    expect(kids.indexOf(h3)).toBeLessThan(kids.indexOf(meta))
    expect(kids.indexOf(meta)).toBeLessThan(kids.indexOf(phoneRow))
    expect(kids[kids.length - 1]).toBe(phoneRow)
    // One per width, display:none for the other — out of the box tree and the accessibility tree.
    expect(classes(shellRow)).toContain('max-sm:hidden')
    expect(classes(phoneRow)).toContain('sm:hidden')
    expect(classes(phoneRow)).not.toContain('max-sm:hidden')
  })

  it('the body: 10px under the photo, no gap; the title in ink; the info line right under it; the price row at the foot, 6px down, 28px — 84px', () => {
    const c = card()
    const [, phoneRow] = [...c.querySelectorAll('[data-price="12800000"]')].map((p) => p.parentElement!)
    const body = phoneRow.parentElement!
    expect(classes(body)).toEqual(expect.arrayContaining(['pt-2.5', 'gap-0.5', 'max-sm:gap-0']))
    expect(classes(body)).not.toContain('max-sm:pt-2')
    expect(classes(body.querySelector('h3'))).toEqual(expect.arrayContaining(['text-t-card', 'font-normal', 'text-ink-3', 'max-sm:text-foreground', 'truncate']))
    expect(classes(body.querySelector('div.text-t-meta'))).toEqual(expect.arrayContaining(['mt-auto', 'max-sm:mt-0', 'pt-0.5']))
    expect(classes(phoneRow)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-baseline', 'mt-auto', 'min-h-8.5', 'pt-1.5']))
    // The sale price keeps r06's heading cut, in both rows.
    for (const p of c.querySelectorAll('[data-price="12800000"]')) expect(classes(p)).toEqual(expect.arrayContaining(['text-t-price', 'max-sm:text-t-h2']))
    const { top, title, metaTop, meta, priceTop, price } = GOODS_LINE_PX
    expect([top, title, metaTop, meta, priceTop, price]).toEqual([10, 20, 2, 18, 6, 28])
    expect(top + title + metaTop + meta + priceTop + price).toBe(84)
  })

  it('a per-unit or a word price keeps the shell 17px inside the same 28px row', () => {
    for (const patch of [{ priceUnit: 'VND/day', price: 700_000 }, { price: 0, listingType: 'free' }]) {
      const c = card(patch)
      for (const price of c.querySelectorAll('[data-price]')) {
        expect(classes(price)).toContain('text-t-price')
        expect(classes(price)).not.toContain('max-sm:text-t-h2')
      }
      expect(classes(c.querySelectorAll('[data-price]')[1].parentElement)).toContain('min-h-8.5')
      cleanup()
    }
  })

  it('⛔ "Ad" is the photo\'s white plate below sm (build 8), first in its bottom-left row; the info line\'s chip from sm — one per width', () => {
    const c = card({ isSponsored: true })
    const ads = [...c.querySelectorAll('[data-ad-marker]')]
    expect(ads).toHaveLength(2)
    const [plate, chip] = ads
    expect(plate.textContent).toBe('Ad')
    expect(c.querySelector('[data-rail-media]')!.contains(plate)).toBe(true)
    expect(classes(plate)).toEqual(expect.arrayContaining(['photo-badge', 'sm:hidden']))
    // Its row: bottom-left, 8px in, and a phone's only when the plate is all it holds.
    expect(classes(plate.parentElement)).toEqual(expect.arrayContaining(['absolute', 'left-2', 'bottom-2', 'pointer-events-none', 'sm:hidden']))
    expect(plate.parentElement!.firstElementChild).toBe(plate)
    expect(c.querySelector('div.text-t-meta')!.contains(chip)).toBe(true)
    expect(classes(chip)).toContain('max-sm:hidden')
    cleanup()
    // A video card's row keeps its plate from sm (only the Ad steps down there).
    const v = card({ isSponsored: true, video: 'https://example.com/v.mp4' })
    const row = v.querySelector('[data-rail-media] [data-ad-marker]')!.parentElement!
    expect(classes(row)).not.toContain('sm:hidden')
    cleanup()
    // No sponsorship, no plate; the shell card keeps its one chip in the info line.
    expect(card().querySelectorAll('[data-ad-marker]')).toHaveLength(0)
    const shell = card({ isSponsored: true }, 'none')
    expect(shell.querySelectorAll('[data-ad-marker]')).toHaveLength(1)
    expect(classes(shell.querySelector('[data-ad-marker]'))).not.toContain('max-sm:hidden')
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

  it('⛔ the info line carries the posted time on a phone (build 7, owner-approved 2026-11-15, cook r07 goods); the brand/model tail stays sm-only', () => {
    const c = card({ brandSlug: 'apple', model: 'iPhone 16' })
    const time = c.querySelector('time[data-posted-ago]')!
    const span = time.parentElement!
    // "Used · <place> · 2h ago" below sm: the time's span is inline there too (it was `hidden sm:inline` alone).
    expect(classes(span)).toEqual(expect.arrayContaining(['hidden', 'sm:inline', 'max-sm:inline']))
    expect(span.textContent!.startsWith(' · 2h ago')).toBe(true)
    // The tail rides in its own span, out of the box tree below sm, its middot with it; from sm the line reads as before.
    const tail = span.querySelector('span.max-sm\\:hidden')!
    expect(tail.textContent).toBe(' · Apple · iPhone 16')
    expect(span.textContent).toBe(' · 2h ago · Apple · iPhone 16')
    // Still ONE truncating line: no wrap, no second meta row.
    expect(classes(span.parentElement)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'truncate']))
  })

  it('…a goods card with no brand has no tail; a shell card keeps the time sm-only, its text unchanged', () => {
    const goods = card()
    expect(goods.querySelector('time[data-posted-ago]')!.parentElement!.querySelector('span')).toBeNull()
    cleanup()
    const plain = card({ brandSlug: 'apple', model: 'iPhone 16' }, 'none')
    const span = plain.querySelector('time[data-posted-ago]')!.parentElement!
    expect(classes(span)).toEqual(expect.arrayContaining(['hidden', 'sm:inline']))
    expect(classes(span)).not.toContain('max-sm:inline')
    expect(span.querySelector('span')).toBeNull()
    expect(span.textContent).toBe(' · 2h ago · Apple · iPhone 16')
  })

  it('without the look the card is the shell card, class for class', () => {
    const plain = card({}, 'none')
    expect(plain.querySelector('[data-card-root]')!.hasAttribute('data-look')).toBe(false)
    expect(plain.innerHTML).not.toMatch(/max-sm:(mix-blend|before:hidden|text-t-h2|min-h-7|pt-2 |mt-0|text-foreground)|min-h-8\.5/)
    // One price row, first in the body: the 09-13 order.
    const prices = plain.querySelectorAll('[data-price]')
    expect(prices).toHaveLength(1)
    expect(prices[0].parentElement!.parentElement!.firstElementChild).toBe(prices[0].parentElement)
    expect(classes(prices[0].parentElement)).toEqual(['flex', 'flex-wrap', 'items-baseline', 'gap-x-1.5'])
  })
})

describe('ListingCardSkeleton look="goods"', () => {
  it('the goods body in the card\'s order (build 8): 10 + title 20 + 2 + meta 18 + 9 + a 22px price bar + 3 = 84, phones only', () => {
    const { container } = render(<ListingCardSkeleton look="goods" />)
    const root = container.firstElementChild!
    expect(root.getAttribute('data-look')).toBe('goods')
    const body = root.children[1]
    expect(classes(body)).toEqual(expect.arrayContaining(['pt-2.5', 'max-sm:gap-0']))
    expect(classes(body)).not.toContain('max-sm:pt-2')
    const bars = Array.from(body.children)
    expect(bars).toHaveLength(4)
    // The shell's price bar, from sm only; then the title and the info line; then the phone's price bar, last.
    expect(classes(bars[0])).toEqual(expect.arrayContaining(['h-[22px]', 'max-sm:hidden']))
    expect(classes(bars[1])).toContain('h-5')
    expect(classes(bars[2])).toEqual(expect.arrayContaining(['mt-0.5', 'h-[18px]']))
    expect(classes(bars[3])).toEqual(expect.arrayContaining(['mt-2.25', 'mb-0.75', 'h-[22px]', 'sm:hidden']))
    // 9 + 22 + 3 = the card's 6px step and its 28px row.
    expect(9 + 22 + 3).toBe(GOODS_LINE_PX.priceTop + GOODS_LINE_PX.price)
  })

  it('a teacher or a wide cell ignores it', () => {
    const { container } = render(<><ListingCardSkeleton look="goods" teacher /><ListingCardSkeleton look="goods" wide /></>)
    expect(container.querySelector('[data-look]')).toBeNull()
  })
})
