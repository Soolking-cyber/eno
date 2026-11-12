// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HELD_PHOTO_ATTR } from '@/lib/image-hold'
import type { SerializedListingCard } from '@/lib/types'

const lang = vi.hoisted(() => ({ current: 'vi' as 'vi' | 'en' }))
const push = vi.hoisted(() => vi.fn())
const localized = vi.hoisted(() => vi.fn((href: string, variant: string) => (variant === 'vi' ? `/vi-twin${href}` : href)))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }))
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
  useLanguage: () => ({ lang: lang.current, t: (k: string) => k, tr: (en: string, vi: string) => (lang.current === 'vi' ? vi : en) }),
  useTr: (s: string) => s,
}))
vi.mock('./listing-content', () => ({
  useLocalized: (title: string, titleVi: string | null) => (lang.current === 'vi' && titleVi ? titleVi : title),
  PostedAgo: () => null,
}))
vi.mock('@/lib/lang-pinned', () => ({ localizedHref: localized }))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => null }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
vi.mock('./price', () => ({
  Price: ({ price, jobMeta, approxClassName, fabAvoid }: { price: number; jobMeta?: string | null; approxClassName?: string; fabAvoid?: boolean }) => (
    <span data-price="" data-fab-avoid-prop={String(!!fabAvoid)} data-approx-class={approxClassName ?? ''} data-job-meta={jobMeta === undefined ? 'undefined' : jobMeta === null ? 'null' : jobMeta}>{price}</span>
  ),
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const BASE = {
  id: 'l1',
  title: '2 bed · 2 bath · 76 m² for rent — An Khánh Ward (new), District 2',
  titleVi: 'Cho thuê Căn hộ / Chung cư 2PN 76m² — P. An Khánh mới, Quận 2',
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 12_000_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'rent',
  location: 'Hồ Chí Minh',
  city: 'Hồ Chí Minh',
  lat: 10.79,
  lng: 106.75,
  condition: null,
  savedCount: 0,
  negotiable: false,
  isPartnerBooking: true,
  sellerId: 'bds-vn-import-seller-0001',
  seller: { trustScore: 100, isBusiness: false, officialPartner: false, unrated: true },
  category: { icon: 'home', slug: 'rentals' },
  postedAt: '2026-09-20T00:00:00.000Z',
  brandSlug: null,
  model: null,
} as unknown as SerializedListingCard


afterEach(() => { cleanup(); lang.current = 'vi'; push.mockClear(); localized.mockClear() })


// ⛔ OPT-IN (src/lib/image-hold.ts): the home grid's card 2 is lazy and on the first screen, so lazy alone must never mean held.
describe('which card photo waits', () => {
  // The photo, not its blurred fill (photo-fill.tsx), which is painted first under it.
  const photo = (extra: Record<string, unknown> = {}) => render(<ListingCard listing={BASE} onOpen={vi.fn()} {...extra} />).container.querySelector('img:not([aria-hidden])') as HTMLImageElement

  it('a lazy card nobody marked is not held: a rail, a shelf, the first screen', () => {
    const img = photo()
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.hasAttribute(HELD_PHOTO_ATTR)).toBe(false)
  })

  it('a card its grid marked is held, and stays lazy', () => {
    const img = photo({ holdPhoto: true })
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.hasAttribute(HELD_PHOTO_ATTR)).toBe(true)
  })

  it('an eager or LCP card is never held, whatever it was told', () => {
    expect(photo({ holdPhoto: true, priority: true }).hasAttribute(HELD_PHOTO_ATTR)).toBe(false)
    expect(photo({ holdPhoto: true, priority: true, lcp: true }).hasAttribute(HELD_PHOTO_ATTR)).toBe(false)
  })

  it('a held photo keeps its address in the HTML, for whoever runs no script', () => {
    expect(photo({ holdPhoto: true }).getAttribute('src')).toBeTruthy()
  })
})

// ⛔ A CARD SHOWS THE WHOLE PHOTO OVER ITS OWN BLURRED FILL (owner, 2026-11-12; photo-fill.tsx).
describe('the whole photo and its fill', () => {
  const imgs = (extra: Record<string, unknown> = {}, listing = BASE) => {
    const c = render(<ListingCard listing={listing} onOpen={vi.fn()} {...extra} />).container
    return { fill: c.querySelector('img[aria-hidden]') as HTMLImageElement | null, photo: c.querySelector('img:not([aria-hidden])') as HTMLImageElement }
  }

  it('the photo is fitted whole, over a decorative fill made from the SAME file (no second request)', () => {
    const { fill, photo } = imgs()
    expect(photo.className).toContain('object-contain')
    expect(photo.className).not.toContain('object-cover')
    expect(fill).not.toBeNull()
    expect(fill!.getAttribute('alt')).toBe('')
    expect(fill!.getAttribute('src')).toBe(photo.getAttribute('src'))
    expect(fill!.getAttribute('sizes')).toBe(photo.getAttribute('sizes'))
    expect(fill!.className).toContain('blur-lg')
    // Painted first, so the photo sits on top of it.
    expect(fill!.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a held photo holds its fill with it, and a lazy one loads it lazily', () => {
    const held = imgs({ holdPhoto: true })
    expect(held.fill!.hasAttribute(HELD_PHOTO_ATTR)).toBe(true)
    expect(held.fill!.getAttribute('loading')).toBe('lazy')
    cleanup()
    const lazy = imgs()
    expect(lazy.fill!.hasAttribute(HELD_PHOTO_ATTR)).toBe(false)
    expect(lazy.fill!.getAttribute('loading')).toBe('lazy')
  })

  it('on the LCP card the fill is eager and never held (it can be the LCP element)', () => {
    const { fill } = imgs({ lcp: true, priority: true, holdPhoto: true })
    expect(fill!.getAttribute('loading')).toBe('eager')
    expect(fill!.hasAttribute(HELD_PHOTO_ATTR)).toBe(false)
  })

  it('a photo that fails takes its fill with it (the placeholder, no blurred stale image), and a retry brings both back', () => {
    vi.useFakeTimers()
    try {
      const c = render(<ListingCard listing={BASE} onOpen={vi.fn()} />).container
      act(() => { fireEvent.error(c.querySelector('img:not([aria-hidden])')!) })
      expect(c.querySelectorAll('img')).toHaveLength(0)
      act(() => { vi.advanceTimersByTime(3000) })
      expect(c.querySelector('img[aria-hidden]')).not.toBeNull()
      expect(c.querySelector('img:not([aria-hidden])')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a teacher keeps the face crop and gets no fill', () => {
    const { fill, photo } = imgs({}, { ...BASE, listingType: 'teacher' } as SerializedListingCard)
    expect(fill).toBeNull()
    expect(photo.className).toContain('object-cover')
    expect(photo.className).toContain('object-[50%_18%]')
  })
})
