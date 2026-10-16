// @vitest-environment jsdom
/**
 * THE COMPACT ROW'S PLACE FOR A TEACHER (teacher onboarding redesign, owner, 2026-10-08). A teacher abroad has no city
 * and no district (projection.ts teacherHome writes city '' — never the old Hồ Chí Minh fallback), so the row says
 * where they are with their location ("Not in Vietnam yet · Online") instead of a divider beside nothing; and since a
 * teacher is never a map pin (map-pin-rows.ts), a teacher row offers no "Show on map".
 * 2026-10-16: a teacher's name is never machine-translated (ListingCard's rule — useLocalized gets '', the name prints as
 * stored), and a MARKED teacher's row draws the "Identity verified" tick right after the name.
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
const loc = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
// A fake that "translates" what it is handed ('' — the no-op — stays ''), so a translated teacher name would show.
vi.mock('./listing-content', () => ({
  useLocalized: (...args: unknown[]) => { loc.calls.push(args); const t = String(args[0] ?? ''); return t ? `MT(${t})` : '' },
}))
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

afterEach(() => { cleanup(); loc.calls = [] })

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

// ⛔ A TEACHER'S NAME, AS STORED (2026-10-16) — the row asks useLocalized for nothing, in any language.
describe('CompactListingRow — a teacher\'s name is never machine-translated', () => {
  it('the h4 and the photo alt are the stored name; the hook gets \'\', no Vietnamese column, no embed', () => {
    const c = row({ ...TEACHER, title: 'Nguyễn Thị Minh Khai', titleVi: 'Khai (bản dịch máy)', titleI18n: { ko: 'x' }, city: 'Hà Nội', district: null, location: 'Hà Nội' })
    expect(c.querySelector('h4')!.textContent).toBe('Nguyễn Thị Minh Khai')
    expect(c.querySelector('img')!.getAttribute('alt')).toBe('Nguyễn Thị Minh Khai')
    expect(c.innerHTML).not.toMatch(/MT\(|bản dịch máy/)
    expect(loc.calls.length).toBeGreaterThan(0)
    for (const call of loc.calls) expect(call).toEqual(['', null, null])
  })
  it('any other row is localized as before', () => {
    const c = row({ title: 'Máy tính Dell', titleVi: null, city: 'Hồ Chí Minh', district: null })
    expect(c.querySelector('h4')!.textContent).toBe('MT(Máy tính Dell)')
    for (const call of loc.calls) expect(call[0]).toBe('Máy tính Dell')
  })
})

// "IDENTITY VERIFIED" (owner, 2026-10-15): the row's tick follows the name — on a MARKED teacher's row only.
describe('CompactListingRow — the "Identity verified" tick', () => {
  const marks = (c: HTMLElement) => c.querySelectorAll('[data-identity-mark]')
  it('a marked teacher: exactly one, right after the h4, named "Identity verified"', () => {
    const c = row({ ...TEACHER, identityMark: true, city: 'Hồ Chí Minh', district: null, location: 'Ho Chi Minh City' })
    expect(marks(c)).toHaveLength(1)
    expect(c.querySelector('h4')!.nextElementSibling).toBe(marks(c)[0])
    expect(marks(c)[0].getAttribute('aria-label')).toBe('Identity verified')
    // The trust chip (the row draws one per breakpoint) still hangs off the right edge after it, as before.
    expect(c.querySelectorAll('[data-trust-chip]').length).toBeGreaterThan(0)
  })
  it('an unmarked teacher, and any other row whatever its payload says: none', () => {
    expect(marks(row({ ...TEACHER, city: 'Hồ Chí Minh', district: null, location: 'x' }))).toHaveLength(0)
    cleanup()
    expect(marks(row({ identityMark: true, city: 'Hồ Chí Minh', district: null }))).toHaveLength(0)
  })
})
