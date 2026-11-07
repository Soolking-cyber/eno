// @vitest-environment jsdom
/**
 * Every listing card warms its listing's page on the way to a click (owner, 2026-11-07: listings "open almost
 * instantly"): a mouse over the card or keyboard focus on it prefetches /listings/<id>, once per five minutes, wherever
 * the card is drawn — never a finger (a scroll starting). Only the feed grid did this before; the rails and shelves did
 * not. src/lib/warm-listing.ts holds the dedupe.
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

const prefetch = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
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
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => null }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./trust-score', () => ({ TrustScore: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'
import { warmListing } from '@/lib/warm-listing'

const LISTING = {
  id: 'l1',
  title: 'Honda Wave 110',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400', 'https://picsum.photos/seed/b/400'],
  video: null,
  price: 12_000_000,
  prevPrice: null,
  currency: 'VND',
  priceUnit: 'VND',
  location: 'Hà Nội',
  condition: 'used',
  savedCount: 0,
  negotiable: true,
  isPartnerBooking: false,
  sellerId: 's1',
  seller: { trustScore: 50, isBusiness: false, officialPartner: false },
  category: { icon: 'bike', slug: 'motorbikes' },
  postedAt: '2026-09-20T00:00:00.000Z',
  brandSlug: null,
  model: null,
} as unknown as SerializedListingCard

afterEach(() => { cleanup() })

describe('ListingCard warms its listing on the way to a click', () => {
  const card = (id: string) => {
    const view = render(<ListingCard listing={{ ...LISTING, id } as SerializedListingCard} onOpen={() => {}} />)
    return { root: view.container.querySelector<HTMLElement>('[data-card-root]')!, link: view.container.querySelector<HTMLElement>('a[data-card-link]')! }
  }
  const warms = (id: string) => prefetch.mock.calls.filter(([h]) => h === `/listings/${id}`).length

  it('a mouse over the card warms it', () => {
    fireEvent.pointerEnter(card('warm-mouse').root, { pointerType: 'mouse' })
    expect(warms('warm-mouse')).toBe(1)
  })

  it('keyboard focus on it warms it', () => {
    fireEvent.focus(card('warm-focus').link)
    expect(warms('warm-focus')).toBe(1)
  })

  it('a finger does not: a touch is usually a scroll starting', () => {
    const { root } = card('warm-touch')
    fireEvent.pointerEnter(root, { pointerType: 'touch' })
    fireEvent.touchStart(root)
    expect(warms('warm-touch')).toBe(0)
  })

  it('mouse then focus warm once in all', () => {
    const { root, link } = card('warm-both')
    fireEvent.pointerEnter(root, { pointerType: 'mouse' })
    fireEvent.focus(link)
    expect(warms('warm-both')).toBe(1)
  })

  it('the same listing drawn twice is warmed once; again after five minutes; another listing on its own', () => {
    const t0 = 1_000_000
    warmListing({ prefetch }, 'warm-2', t0)
    warmListing({ prefetch }, 'warm-2', t0 + 60_000)
    warmListing({ prefetch }, 'warm-3', t0)
    expect(warms('warm-2')).toBe(1)
    expect(warms('warm-3')).toBe(1)
    warmListing({ prefetch }, 'warm-2', t0 + 5 * 60_000)
    expect(warms('warm-2')).toBe(2)
  })
})
