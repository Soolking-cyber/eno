// @vitest-environment jsdom
/**
 * THE COMPACT ROW'S PLACE FOR A TEACHER (teacher onboarding redesign, owner, 2026-10-08). A teacher abroad has no city
 * and no district (projection.ts teacherHome writes city '' — never the old Hồ Chí Minh fallback), so the row says
 * where they are with their location ("Not in Vietnam yet · Online") instead of a divider beside nothing; and since a
 * teacher is never a map pin (map-pin-rows.ts), a teacher row offers no "Show on map".
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

const TEACHER = {
  title: 'Jane Doe', listingType: 'teacher', price: 0, isPartnerBooking: false, isSponsored: false, sellerId: 's1',
  seller: { trustScore: 60, isBusiness: false, officialPartner: false },
  category: { icon: 'GraduationCap', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' },
}
const mapButton = (c: HTMLElement) => c.querySelector('[aria-label="Show on map"]')
const divider = (c: HTMLElement) => c.querySelector('.w-px')

describe('CompactListingRow — a teacher row', () => {
  it('abroad: the location says where they are (both lines), and there is no "Show on map"', () => {
    const c = row({ ...TEACHER, city: '', district: null, location: 'Not in Vietnam yet · Online' })
    expect(c.textContent?.match(/Not in Vietnam yet · Online/g)).toHaveLength(2)
    expect(divider(c)).not.toBeNull()
    expect(mapButton(c)).toBeNull()
  })
  it('in Vietnam: the district (or the city) as for any row — still no "Show on map"', () => {
    const c = row({ ...TEACHER, city: 'Hồ Chí Minh', district: 'Quận 7 (Phú Mỹ Hưng)', location: 'District 7 (Phu My Hung), Ho Chi Minh City' })
    expect(c.textContent).toContain('Quận 7 (Phú Mỹ Hưng)')
    expect(c.textContent).not.toContain('Phu My Hung), Ho Chi Minh City')
    expect(mapButton(c)).toBeNull()
  })
  it('a teacher with no place at all (an unanswered row): no divider beside nothing', () => {
    const c = row({ ...TEACHER, city: '', district: null, location: '' })
    expect(divider(c)).toBeNull()
  })
})

// The row passes that location to <Tr> as DATA (Listing.location, English as stored). A Vietnamese reader gets the curated
// line from the dictionary, never English or a machine translation — pinned here, since nothing else ties the
// projection's words to the dictionary (gate review, 2026-10-08).
describe('CompactListingRow — a teacher abroad, in Vietnamese', () => {
  it('every location teacherHome writes abroad has its curated Vietnamese (vi-overrides)', async () => {
    const { VI_OVERRIDES } = await import('@/generated/vi-overrides')
    const { teacherHome } = await import('@/lib/teachers/projection')
    for (const teachAreas of [['online', 'anywhere'], ['ha-noi']]) {
      const loc = teacherHome({ livesIn: 'abroad', currentCity: '', currentDistrictKey: '', currentProvince: '', teachAreas }).location
      expect(VI_OVERRIDES[loc], loc).toMatch(/^Chưa ở Việt Nam/)
    }
  })
})

describe('CompactListingRow — every other row is as it was', () => {
  it('keeps its place, its divider and its "Show on map"', () => {
    const c = row({ city: 'Hồ Chí Minh', district: null })
    expect(divider(c)).not.toBeNull()
    expect(mapButton(c)).not.toBeNull()
  })
  it('never borrows its location for a missing city (that is the teacher rule only) — and draws no empty divider', () => {
    const c = row({ city: '', district: null, location: '12 Nguyễn Huệ, Quận 1' })
    expect(c.textContent).not.toContain('Nguyễn Huệ')
    expect(divider(c)).toBeNull()
  })
})
