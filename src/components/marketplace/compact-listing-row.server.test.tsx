// @vitest-environment jsdom
/**
 * THE LIST ROW IN A SERVER-RENDERED LIST (2026-11-10, item 2: a category page's phone rows, seller-listings.tsx
 * `rowsOnPhone`). Two props, both off in the explorer, whose rows are client-only:
 *   · `clockInHtml`: the posted time goes through <PostedAgo inHtml>, the card's hydration-safe clock. A bare `timeAgo`
 *     in cached HTML is a day old when the reader hydrates it, and React reports the mismatch;
 *   · `lazyThumb`: the thumbnail never loads eagerly. The list is hidden from `sm` up, and a hidden eager image loads.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, fetchPriority: _fp, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { ArrowRight: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Zap: Icon, BadgeCheck: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({
  useLocalized: (t: string) => t,
  PostedAgo: ({ iso, inHtml }: { iso: string; inHtml?: boolean }) => <time data-posted-ago="" data-in-html={String(!!inHtml)} dateTime={iso} />,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./trust-score', () => ({ TrustScore: () => <span data-trust-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: () => null }))
// The real slot rule lives in <Price> (price.ink-and-approx.test.tsx pins it); here only what the row hands it matters.
vi.mock('./price', () => ({
  Price: ({ price, jobMeta, linked, className }: { price: number; jobMeta?: string | null; linked?: boolean; className?: string }) => (
    <span data-price="" data-job-meta={jobMeta === undefined ? 'unset' : jobMeta === null ? 'null' : jobMeta} data-linked={String(linked)} data-class={className}>{price}</span>
  ),
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => <span data-category-glyph="" /> }))
vi.mock('@/components/marketplace/eno-slider', () => ({ EnoSlider: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { CompactListingRow } from './compact-listing-row'

afterEach(cleanup)

const JOB = {
  id: 'j1',
  title: 'Primary PE Teacher — Nord Anglia Education',
  titleVi: null,
  titleI18n: null,
  images: ['https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/job-nordanglia-1-ill-1200x1200.webp'],
  video: null,
  price: 0,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'job',
  jobType: 'fulltime',
  jobEmployer: 'Nord Anglia Education',
  location: 'Hà Nội',
  city: 'Hà Nội',
  district: null,
  condition: null,
  savedCount: 0,
  contactCount: 0,
  negotiable: false,
  isPartnerBooking: true,
  isSponsored: false,
  sellerId: 'linked-jobs',
  seller: { trustScore: 100, isBusiness: true, officialPartner: false },
  category: { icon: 'Briefcase', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
  postedAt: '2026-11-05T00:00:00.000Z',
} as unknown as SerializedListingCard

const mount = (props: Record<string, unknown> = {}, patch: Record<string, unknown> = {}, index = 0) =>
  render(<CompactListingRow listing={{ ...JOB, ...patch } as SerializedListingCard} index={index} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} {...props} />).container

describe('CompactListingRow in server HTML', () => {
  it('`clockInHtml` prints the posted time through <PostedAgo inHtml>', () => {
    const c = mount({ clockInHtml: true })
    const t = c.querySelector('[data-posted-ago]')!
    expect(t.getAttribute('data-in-html')).toBe('true')
    expect(t.getAttribute('datetime')).toBe(JOB.postedAt)
  })

  it('without it the row prints the time itself, as the explorer\'s client-only rows always have', () => {
    const c = mount()
    expect(c.querySelector('[data-posted-ago]')).toBeNull()
  })

  it('`lazyThumb` makes even the first rows\' photos lazy; without it the first six are eager', () => {
    // A row that draws a thumbnail: since batch 78 (2026-11-12) a job row draws none, its own photo included.
    const photo = { images: ['https://sb.eno.vn/storage/v1/object/public/listings/a.webp'], isPartnerBooking: false, listingType: 'sell', price: 4_000_000, priceUnit: 'VND' }
    expect(mount({ lazyThumb: true }, photo, 0).querySelector('img')!.getAttribute('loading')).toBe('lazy')
    cleanup()
    expect(mount({}, photo, 0).querySelector('img')!.getAttribute('loading')).toBe('eager')
    cleanup()
    expect(mount({}, photo, 6).querySelector('img')!.getAttribute('loading')).toBe('lazy')
  })
})
