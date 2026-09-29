// @vitest-environment jsdom
/**
 * ⛔ A REFERENCE LISTING WORE A "TRUSTED 100" CHIP IT NEVER EARNED.
 *
 * Every import storefront (Chợ Tốt, Batdongsan, Rever, Muaban, Honeycomb, the job boards) sits at the
 * default trustScore 100 so ranking treats it fairly — and the card rendered that number as the /trust
 * "Trusted" chip, on every rental in the feed. Only LINKED JOBS were excluded. The rule is now every id
 * in src/lib/import-sellers.ts, and these tests pin it:
 *   · a portal-import rental and a linked job show no trust chip;
 *   · a member's listing still does — as a named image (role=img + the full sentence), with NO native
 *     `title` (the chip explains itself through ui/tooltip, like the partner chip beside it);
 *   · an official partner shows the partner chip, never the trust chip.
 *
 * ⚠️ CHIPS ARE COUNTED BY `[data-trust-chip]`, NEVER BY `[title^="Trust score"]` — the title is gone on
 * purpose, so a title selector would pass for the wrong reason.
 *
 * TrustScore and ui/tooltip are REAL here (jsdom has no matchMedia, so the tooltip renders its bare
 * trigger — the touch path). Everything else the card pulls in that is not under test is stubbed.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

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
  PostedAgo: () => null,
}))
vi.mock('@/context/favorites-context', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const BASE = {
  id: 'l1',
  title: 'Căn hộ 2PN Quận 7',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 12_000_000,
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
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown>) =>
  render(<ListingCard listing={{ ...BASE, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container

afterEach(cleanup)

describe('ListingCard — the trust chip is for sellers eno.vn rated, and only them', () => {
  it('a portal-import rental (Chợ Tốt) shows no trust chip, though its storefront sits at 100', () => {
    const c = card({ sellerId: 'nhatot-import-seller-0001', isPartnerBooking: true })
    expect(c.querySelectorAll('[data-trust-chip]')).toHaveLength(0)
    expect(c.textContent).not.toContain('100')
  })

  it('a linked job shows no trust chip (the rule it was generalised from)', () => {
    const c = card({ sellerId: 'vietnamworks-com-import-seller-0001', isPartnerBooking: true, listingType: 'job', category: { icon: 'briefcase', slug: 'jobs' } })
    expect(c.querySelectorAll('[data-trust-chip]')).toHaveLength(0)
  })

  it("a member's listing keeps its chip — named for assistive tech, with no native title", () => {
    const c = card({})
    const chips = c.querySelectorAll('[data-trust-chip]')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('role')).toBe('img')
    expect(chips[0].getAttribute('aria-label')).toMatch(/^Trust score: 100 · /)
    expect(c.querySelectorAll('[title^="Trust score"]')).toHaveLength(0)
  })

  it('an official partner shows the partner chip instead, never the trust chip', () => {
    const c = card({ seller: { trustScore: 100, isBusiness: true, officialPartner: true } })
    expect(c.querySelectorAll('[data-trust-chip]')).toHaveLength(0)
    expect(c.querySelectorAll('[data-partner-chip]')).toHaveLength(1)
  })
})
