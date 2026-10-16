// @vitest-environment jsdom
/**
 * ⛔ A TEACHER'S NAME IS NEVER MACHINE-TRANSLATED ON A CARD (2026-10-16). A teacher row's title IS the person's name
 * (projection.ts), and the "Identity verified" tick sits beside it: a translated name under the tick would put it beside
 * a name nobody checked. So ListingCard prints a teacher card's `title` as stored, in every language, and asks
 * useLocalized for nothing (it still runs — hooks are unconditional — with '', its no-op: no embed read, no request).
 * Every other card is localized as before. Here useLocalized is a fake that "translates" whatever it is handed.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

const loc = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, fetchPriority: _fp, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { Heart: Icon, Building2: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Play: Icon, ArrowRight: Icon, BadgeCheck: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'ko', t: (k: string) => k, tr: (en: string) => en }),
  useTr: (s: string) => s,
}))
vi.mock('./listing-content', () => ({
  // A "translation" of whatever it is handed — '' (the no-op) stays ''.
  useLocalized: (...args: unknown[]) => { loc.calls.push(args); const t = String(args[0] ?? ''); return t ? `MT(${t})` : '' },
  PostedAgo: () => null,
}))
vi.mock('@/context/favorites-context', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => null }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const BASE = {
  id: 'L1', title: 'Nguyễn Thị Minh Khai', titleVi: 'Khai (bản dịch máy)', titleI18n: { ko: '응우옌 티 민 카이' },
  images: ['https://picsum.photos/seed/a/400'], video: null, price: 0, prevPrice: null, currency: '₫', priceUnit: 'VND/month',
  listingType: 'teacher', location: 'Hà Nội', city: 'Hà Nội', lat: null, lng: null, condition: null, savedCount: 0,
  negotiable: false, isPartnerBooking: false, sellerId: 'teacher-seller-1',
  seller: { trustScore: 60, isBusiness: false, officialPartner: false },
  category: { icon: 'GraduationCap', slug: 'teachers' }, postedAt: '2026-10-01T00:00:00.000Z', brandSlug: null, model: null,
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...BASE, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container

beforeEach(() => { loc.calls = [] })
afterEach(cleanup)

describe('ListingCard — a teacher\'s name, as stored', () => {
  it('the h3, the link name, the h3 title and the photo alt are the stored name — never a translation, never titleVi', () => {
    const c = card({ identityMark: true })
    const h3 = c.querySelector('h3')!
    expect(h3.textContent).toBe('Nguyễn Thị Minh Khai')
    expect(h3.getAttribute('title')).toBe('Nguyễn Thị Minh Khai')
    expect(c.querySelector('[data-card-link]')!.getAttribute('aria-label')).toBe('Nguyễn Thị Minh Khai')
    expect(c.querySelector('img')!.getAttribute('alt')).toBe('Nguyễn Thị Minh Khai')
    expect(c.innerHTML).not.toMatch(/MT\(|bản dịch máy|응우옌/)
  })

  it('the hook is asked for nothing: \'\', no Vietnamese column, no embed', () => {
    card()
    expect(loc.calls.length).toBeGreaterThan(0)
    for (const call of loc.calls) expect(call).toEqual(['', null, null])
  })

  it('every other card is localized as before (the hook gets its title, titleVi and embed)', () => {
    const c = card({ listingType: 'sell', category: { icon: 'phone', slug: 'electronics' }, title: 'Laptop Dell', titleVi: 'Máy tính Dell', titleI18n: { ko: '델 노트북' } })
    expect(c.querySelector('h3')!.textContent).toBe('MT(Laptop Dell)')
    expect(loc.calls.length).toBeGreaterThan(0)
    for (const call of loc.calls) expect(call).toEqual(['Laptop Dell', 'Máy tính Dell', { ko: '델 노트북' }])
  })
})
