// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
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
  const photo = (extra: Record<string, unknown> = {}) => render(<ListingCard listing={BASE} onOpen={vi.fn()} {...extra} />).container.querySelector('img') as HTMLImageElement

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
