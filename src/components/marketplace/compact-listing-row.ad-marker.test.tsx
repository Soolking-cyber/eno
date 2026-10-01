// @vitest-environment jsdom
/**
 * THE COMPACT ROW'S CHIP SLOTS (2026-10-01): a commission-bearing row carries the "Ad / Quảng cáo" marker,
 * and when that row also sits on an OFFICIAL-PARTNER storefront the marker wins the slot — two chips side by
 * side crowd a one-line row. The partner plate stays on the PDP and storefront; here the status is still
 * announced (sr-only), and the trust chip does not come back (partner replaces trust).
 * The row renders TWO slots (phone: beside the title; sm+: in the meta line), so counts are per slot pair.
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
  return { ArrowRight: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Zap: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (title: string) => title }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./trust-score', () => ({ TrustScore: () => <span data-trust-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/components/marketplace/eno-slider', () => ({ EnoSlider: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { CompactListingRow } from './compact-listing-row'

const BASE = {
  id: 'l1',
  title: 'Laptop',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 12_000_000,
  currency: '₫',
  priceUnit: 'VND',
  listingType: 'sell',
  location: 'Hồ Chí Minh',
  condition: null,
  savedCount: 0,
  contactCount: 0,
  negotiable: true,
  isPartnerBooking: true,
  isSponsored: true,
  sellerId: 'partner-seller-1',
  seller: { trustScore: 100, isBusiness: true, officialPartner: true },
  category: { icon: 'phone', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  postedAt: '2026-09-20T00:00:00.000Z',
} as unknown as SerializedListingCard

const row = (patch: Record<string, unknown>) =>
  render(<CompactListingRow listing={{ ...BASE, ...patch } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container

afterEach(cleanup)

describe('CompactListingRow — Ad marker vs the partner plate', () => {
  it('sponsored + official partner → Ad marker only (both slots), no plate, no trust chip, status still announced', () => {
    const c = row({})
    expect(c.querySelectorAll('[data-ad-marker]')).toHaveLength(2)
    expect(c.querySelectorAll('[data-partner-chip]')).toHaveLength(0)
    expect(c.querySelectorAll('[data-trust-chip]')).toHaveLength(0)
    expect(Array.from(c.querySelectorAll('.sr-only')).filter((e) => e.textContent === 'Official partner')).toHaveLength(1)
  })

  it('an official partner without a commission link keeps its plate in both slots', () => {
    const c = row({ isSponsored: false, isPartnerBooking: false })
    expect(c.querySelectorAll('[data-partner-chip]')).toHaveLength(2)
    expect(c.querySelectorAll('[data-ad-marker]')).toHaveLength(0)
  })

  it('a member listing keeps its trust chip and carries no Ad marker', () => {
    const c = row({ isSponsored: false, isPartnerBooking: false, seller: { trustScore: 80, isBusiness: false, officialPartner: false, unrated: false } })
    expect(c.querySelectorAll('[data-trust-chip]')).toHaveLength(2)
    expect(c.querySelectorAll('[data-ad-marker]')).toHaveLength(0)
  })
})
