// @vitest-environment jsdom
/**
 * THE TEACHER CARD'S "IDENTITY VERIFIED" TICK (owner, 2026-10-15) — pinned at the component (listing-card.tsx is a
 * landmine file; its rules are in its comments):
 *   · only a TEACHER card whose payload says `identityMark: true` draws it — exactly one, as the h3's next sibling, in a
 *     row of its own; never a rent or goods card, whatever its payload says;
 *   · the h3 still reads exactly the card link's accessible name (WCAG 2.5.3), and the link names the tick in its
 *     description (aria-describedby → the tick's id);
 *   · the trust chip is untouched (one, as before);
 *   · ⛔ an UNMARKED card renders as before: the bare h3 straight in the body, the same class, no description.
 * The trust-chip test's harness: TrustScore and the tooltip are real, everything else the card pulls in is stubbed.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'vi' }))
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
  useLanguage: () => ({ lang: lang.current, t: (k: string) => k, tr: (en: string, vi: string) => (lang.current === 'vi' ? vi : en) }),
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

const TEACHER = {
  id: 'L1',
  title: 'Anna Eriksson',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 35_000_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'teacher',
  location: 'Thủ Đức, Hồ Chí Minh',
  city: 'Hồ Chí Minh',
  lat: null,
  lng: null,
  condition: null,
  savedCount: 0,
  negotiable: false,
  isPartnerBooking: false,
  sellerId: 'teacher-seller-1',
  seller: { trustScore: 70, isBusiness: false, officialPartner: false },
  category: { icon: 'GraduationCap', slug: 'teachers' },
  postedAt: '2026-10-01T00:00:00.000Z',
  brandSlug: null,
  model: null,
} as unknown as SerializedListingCard

const TITLE_CLASS = 'truncate text-sm font-normal leading-snug text-foreground group-hover:underline decoration-1 underline-offset-2'
const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...TEACHER, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container

afterEach(() => { cleanup(); lang.current = 'en' })

describe('ListingCard — a MARKED teacher card', () => {
  it('draws exactly one tick, as the h3\'s next sibling, named "Identity verified"', () => {
    const c = card({ identityMark: true })
    const marks = c.querySelectorAll('[data-identity-mark]')
    expect(marks).toHaveLength(1)
    const h3 = c.querySelector('h3')!
    expect(h3.nextElementSibling).toBe(marks[0])
    expect(marks[0].getAttribute('role')).toBe('img')
    expect(marks[0].getAttribute('aria-label')).toBe('Identity verified')
  })

  it('the h3 is the name, exactly the link\'s accessible name — and the link describes itself with the tick', () => {
    const c = card({ identityMark: true })
    const h3 = c.querySelector('h3')!
    const link = c.querySelector('[data-card-link]')!
    expect(h3.textContent).toBe('Anna Eriksson')
    expect(link.getAttribute('aria-label')).toBe(h3.textContent)
    const described = (link.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    const mark = c.querySelector('[data-identity-mark]')!
    expect(mark.id).toBeTruthy()
    expect(described).toContain(mark.id)
  })

  it('the name truncates before the tick: the h3 gains min-w-0 in a flex row, and the line keeps one row', () => {
    const c = card({ identityMark: true })
    const h3 = c.querySelector('h3')!
    expect(h3.className).toBe(`${TITLE_CLASS} min-w-0`)
    expect(h3.parentElement!.className).toBe('flex min-w-0 items-center gap-1')
  })

  it('the trust chip is untouched — one, as before', () => {
    expect(card({ identityMark: true }).querySelectorAll('[data-trust-chip]')).toHaveLength(1)
  })

  it('in Vietnamese the tick is named "Đã xác minh danh tính" — never "xác thực"', () => {
    lang.current = 'vi'
    const c = card({ identityMark: true })
    expect(c.querySelector('[data-identity-mark]')!.getAttribute('aria-label')).toBe('Đã xác minh danh tính')
    expect(c.innerHTML).not.toContain('xác thực')
  })
})

describe('ListingCard — ⛔ every UNMARKED card renders as before', () => {
  it('an unmarked teacher: no tick, no wrapper, the same h3 straight in the body, no description on the link', () => {
    for (const patch of [{}, { identityMark: undefined }]) {
      const c = card(patch)
      expect(c.querySelectorAll('[data-identity-mark]')).toHaveLength(0)
      const h3 = c.querySelector('h3')!
      expect(h3.className).toBe(TITLE_CLASS)
      // The body column, not a row made for the tick.
      expect(h3.parentElement!.className).toContain('flex-col')
      expect(c.querySelector('[data-card-link]')!.hasAttribute('aria-describedby')).toBe(false)
      cleanup()
    }
  })

  it('⛔ a rent or goods card never draws it, whatever its payload says', () => {
    for (const patch of [
      { listingType: 'rent', category: { icon: 'home', slug: 'rentals' }, identityMark: true },
      { listingType: 'sell', category: { icon: 'phone', slug: 'electronics' }, identityMark: true },
    ]) {
      const c = card(patch)
      expect(c.querySelectorAll('[data-identity-mark]')).toHaveLength(0)
      expect(c.querySelector('h3')!.className).toBe(TITLE_CLASS)
      expect(c.querySelector('[data-card-link]')!.hasAttribute('aria-describedby')).toBe(false)
      cleanup()
    }
  })
})
