// @vitest-environment jsdom
/**
 * ⛔ THE MEDIA-SCOPED LCP (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — ListingCard's `lcp` prop note). On the
 * undirected home a phone opens on its lanes and a desktop on its grid, so each width has its own LCP card: the Trending
 * lane's first card below `sm`, the grid's first card from `sm`. With `lcp` as a media query the card's first photo is
 * preloaded with that media at high priority — the preload built from the same props as the <img>, so it IS the img's
 * request — and the <img> is only eager: no `fetchpriority`, no next/image `priority`. `lcp={true}` is unchanged.
 * And the `lane` prop: a phone lane's text is flush with its photo, and the place stops stretching (inert from `sm`).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { getImageProps } from 'next/image'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { LISTING_CARD_SIZES } from './listing-grid'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
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
  images: ['https://xyz.supabase.co/storage/v1/object/public/listings/a.webp', 'https://xyz.supabase.co/storage/v1/object/public/listings/b.webp'],
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


const attr = (tag: string | undefined, name: string) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag ?? '')?.[1]
const preloads = (html: string) => html.match(/<link\b[^>]*rel="preload"[^>]*>/g) ?? []
const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? []
const decode = (s: string | undefined) => s?.replace(/&amp;/g, '&')
const html = (props: Partial<React.ComponentProps<typeof ListingCard>>) =>
  renderToString(<ListingCard listing={RENT} onOpen={vi.fn()} {...props} />)

afterEach(cleanup)

describe('ListingCard `lcp` as a media query', () => {
  it('preloads the first photo with that media at high priority, the preload equal to the img\'s own srcset and sizes', () => {
    const out = html({ lcp: '(max-width: 39.99rem)', priority: true })
    const [link, ...more] = preloads(out)
    expect(more).toEqual([])
    expect(attr(link, 'media')).toBe('(max-width: 39.99rem)')
    expect(attr(link, 'fetchPriority')).toBe('high')
    expect(attr(link, 'as')).toBe('image')
    const img = imgs(out)[0]
    expect(decode(attr(link, 'imageSrcSet'))).toBe(decode(attr(img, 'srcset')))
    expect(attr(link, 'imageSizes')).toBe(attr(img, 'sizes'))
    // …and equal to what next/image itself computes for that photo at the card's quality.
    const { props } = getImageProps({ src: RENT.images[0], alt: '', fill: true, sizes: attr(img, 'sizes')!, quality: 60 })
    expect(decode(attr(link, 'imageSrcSet'))).toBe(props.srcSet)
  })

  it('its img is eager, with no fetchpriority of its own (where the media does not match, nothing claims the high slot)', () => {
    const img = imgs(html({ lcp: '(min-width: 40rem)', priority: true }))[0]
    expect(attr(img, 'loading')).toBe('eager')
    expect(attr(img, 'fetchpriority')).toBeUndefined()
  })

  it('lcp={true} is unchanged: next/image\'s own preload (no media) and a high-priority img', () => {
    const out = html({ lcp: true, priority: true })
    const [link] = preloads(out)
    expect(attr(link, 'media')).toBeUndefined()
    expect(attr(imgs(out)[0], 'fetchpriority')).toBe('high')
  })

  it('no lcp: no preload, and the first photo is lazy unless `priority`', () => {
    expect(preloads(html({}))).toEqual([])
    expect(attr(imgs(html({}))[0], 'loading')).toBe('lazy')
  })
})

describe('ListingCard `lane`', () => {
  it('below sm the text is flush with the photo and the place does not stretch; nothing changes without it', () => {
    const body = (c: HTMLElement) => c.querySelector('[data-card-root] > div:last-child')!
    const lane = render(<ListingCard listing={RENT} onOpen={vi.fn()} lane />).container
    expect(body(lane).className.split(/\s+/)).toEqual(expect.arrayContaining(['px-2', 'sm:px-0.5', 'max-sm:px-0']))
    expect(lane.querySelector('span.min-w-0.flex-1.truncate')!.className).toContain('max-sm:flex-initial')
    cleanup()
    const plain = render(<ListingCard listing={RENT} onOpen={vi.fn()} />).container
    expect(body(plain).className).not.toContain('max-sm:px-0')
    expect(plain.querySelector('span.min-w-0.flex-1.truncate')!.className).not.toContain('max-sm:flex-initial')
  })

  // ⛔ Build 7 (owner-approved 2026-11-15, cook r07 home: "calmer lane cards"): one rhythm — 8px under the photo, 4 between the
  // price, the title and the info line (the same 76px body: 8 + 22 + 4 + 20 + 4 + 18) — and one overlay at most on the photo:
  // the video / "N saved" plates go on a phone lane. All phone-only; a grid card is unchanged.
  it('build 7: below sm one 8 / 4 / 4 rhythm, and no video or saved plate on the photo; nothing changes without it', () => {
    const body = (c: HTMLElement) => c.querySelector('[data-card-root] > div:last-child')!
    const meta = (c: HTMLElement) => c.querySelector('span.min-w-0.flex-1.truncate')!.parentElement!
    const plates = (c: HTMLElement) => c.querySelector('[class*="bottom-2"][class*="left-2"]')
    const busy = { ...RENT, video: 'https://xyz.supabase.co/storage/v1/object/public/listings/v.mp4', savedCount: 5 }
    const lane = render(<ListingCard listing={busy} onOpen={vi.fn()} lane />).container
    expect(body(lane).className.split(/\s+/)).toEqual(expect.arrayContaining(['gap-0.5', 'pt-2.5', 'max-sm:gap-1', 'max-sm:pt-2', 'max-sm:px-0']))
    expect(meta(lane).className.split(/\s+/)).toEqual(expect.arrayContaining(['pt-0.5', 'max-sm:pt-0']))
    expect(plates(lane)!.className.split(/\s+/)).toContain('max-sm:hidden')
    expect(8 + 22 + 4 + 20 + 4 + 18).toBe(10 + 22 + 2 + 20 + 2 + 2 + 18)
    cleanup()
    const plain = render(<ListingCard listing={busy} onOpen={vi.fn()} />).container
    expect(body(plain).className).not.toContain('max-sm:gap-1')
    expect(meta(plain).className).not.toContain('max-sm:pt-0')
    expect(plates(plain)!.className).not.toContain('max-sm:hidden')
  })
})
