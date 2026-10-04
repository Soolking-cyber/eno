// @vitest-environment jsdom
/**
 * A4-CARDS (UX program 2, 2026-10-04): what the card PRINTS, pinned at the component.
 *   · the one-line title is the card-title.ts shortening and the card link's accessible name (WCAG 2.5.3 —
 *     the name contains what is seen), while the full title stays the h3 `title` and the photo alt — and a
 *     member's own title is never touched;
 *   · "Show on map" renders only for a rental, service or job WITH coordinates, and the default
 *     focus link goes through localizedHref in the reader's variant;
 *   · the support mark's yield (`data-fab-avoid`) sits on each <Price> figure, never on the full-width row,
 *     and the "≈ $" estimate is never hidden (owner, 2026-09-13);
 *   · a price-0 job hands <Price> its type · city, or null with no type.
 * The card's own rules are the subject; everything else it pulls in is stubbed (the trust-chip test's harness).
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
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

const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...BASE, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container

afterEach(() => { cleanup(); lang.current = 'vi'; push.mockClear(); localized.mockClear() })

describe('ListingCard — the one-line title', () => {
  it('prints the shortened importer title, names the link with it, and keeps the full one elsewhere', () => {
    const c = card()
    const h3 = c.querySelector('h3')!
    expect(h3.textContent).toBe('Căn hộ 2PN 76m² — P. An Khánh mới, Quận 2')
    expect(h3.getAttribute('title')).toBe(BASE.titleVi)
    // Label in Name (WCAG 2.5.3): the accessible name is exactly the visible line…
    const link = c.querySelector('[data-card-link]')!
    expect(link.getAttribute('aria-label')).toBe(h3.textContent)
    // …and the full title rides along as its description.
    const described = link.getAttribute('aria-describedby')!
    const desc = c.querySelector(`[id="${described}"]`)!
    expect(desc.textContent).toBe(BASE.titleVi)
    // Out of the reading flow (no second reading in browse mode) — aria-describedby still reads hidden text.
    expect(desc.hasAttribute('hidden')).toBe(true)
    expect(c.querySelector('img')!.getAttribute('alt')).toBe(BASE.titleVi)
  })

  it('an unshortened title needs no description', () => {
    const c = card({ sellerId: 'cm-member-seller' })
    expect(c.querySelector('[data-card-link]')!.hasAttribute('aria-describedby')).toBe(false)
  })

  it("never shortens a member's own rental title", () => {
    const c = card({ sellerId: 'cm-member-seller', titleVi: 'Cho thuê xe máy giá rẻ', seller: { trustScore: 80, isBusiness: false, officialPartner: false } })
    expect(c.querySelector('h3')!.textContent).toBe('Cho thuê xe máy giá rẻ')
  })

  it('an English reader sees the stored English title unchanged', () => {
    lang.current = 'en'
    expect(card().querySelector('h3')!.textContent).toBe(BASE.title)
  })
})

describe('ListingCard — goods bracket tags', () => {
  const goods = { category: { icon: 'phone', slug: 'electronics' }, listingType: 'sell', priceUnit: 'VND', sellerId: 'cm-member-seller', condition: 'used', location: 'Hồ Chí Minh', seller: { trustScore: 80, isBusiness: false, officialPartner: false } }

  it("drops a tag the info line already prints (the card's condition and location reach card-title.ts)", () => {
    const h3 = card({ ...goods, titleVi: '[Used] Dell XPS 13 9310' }).querySelector('h3')!
    expect(h3.textContent).toBe('Dell XPS 13 9310')
    expect(h3.getAttribute('title')).toBe('[Used] Dell XPS 13 9310')
  })

  it('keeps a tag that says something the info line does not', () => {
    expect(card({ ...goods, titleVi: '[Cần mua] Laptop Dell cũ' }).querySelector('h3')!.textContent).toBe('[Cần mua] Laptop Dell cũ')
    cleanup()
    expect(card({ ...goods, condition: null, titleVi: '[Like New] Dell XPS 13 9310' }).querySelector('h3')!.textContent).toBe('[Like New] Dell XPS 13 9310')
  })
})

describe('ListingCard — Show on map', () => {
  const locateBtn = (c: HTMLElement) => c.querySelector('[aria-label="Xem trên bản đồ"], [aria-label="Show on map"]')

  it('renders for a rental with coordinates, and its default link is localized', () => {
    const c = card()
    const btn = locateBtn(c)
    expect(btn).not.toBeNull()
    fireEvent.click(btn!)
    expect(localized).toHaveBeenCalledWith('/?focus=l1', 'vi')
    expect(push).toHaveBeenCalledWith('/vi-twin/?focus=l1')
  })

  it('does not render without coordinates', () => {
    expect(locateBtn(card({ lat: null, lng: null }))).toBeNull()
  })

  it('does not render on goods, even with coordinates', () => {
    expect(locateBtn(card({ category: { icon: 'phone', slug: 'electronics' }, listingType: 'sell', priceUnit: '' }))).toBeNull()
  })

  it('renders for services and jobs with coordinates', () => {
    expect(locateBtn(card({ category: { icon: 'wrench', slug: 'services' }, listingType: 'service' }))).not.toBeNull()
    cleanup()
    expect(locateBtn(card({ category: { icon: 'briefcase', slug: 'jobs' }, listingType: 'job', price: 0 }))).not.toBeNull()
  })
})

describe('ListingCard — the price row', () => {
  it('the support-mark yield sits on each <Price>, never on this full-width row', () => {
    const row = card().querySelector('[data-price]')!.parentElement!
    expect(row.hasAttribute('data-fab-avoid')).toBe(false)
    expect(row.querySelector('[data-price]')!.getAttribute('data-fab-avoid-prop')).toBe('true')
  })

  it('the struck "was" price opts into the yield too', () => {
    const prices = [...card({ prevPrice: 15_000_000 }).querySelectorAll('[data-price]')]
    expect(prices).toHaveLength(2)
    expect(prices.map((p) => p.getAttribute('data-fab-avoid-prop'))).toEqual(['true', 'true'])
  })

  it('never hides the "≈ $" estimate, on a per-unit price or any other (owner, 2026-09-13)', () => {
    expect(card().querySelector('[data-price]')!.getAttribute('data-approx-class')).toBe('')
    cleanup()
    expect(card({ priceUnit: '', category: { icon: 'phone', slug: 'electronics' }, listingType: 'sell' }).querySelector('[data-price]')!.getAttribute('data-approx-class')).toBe('')
  })

  it('a price-0 job hands <Price> its type and city', () => {
    const job = { category: { icon: 'briefcase', slug: 'jobs' }, listingType: 'job', price: 0, city: 'Hà Nội', sellerId: 'eslboards-com-import-seller-0001' }
    expect(card({ ...job, jobType: 'fulltime' }).querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('Toàn thời gian · Hà Nội')
    cleanup()
    lang.current = 'en'
    expect(card({ ...job, jobType: 'fulltime' }).querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('Full-time · Hanoi')
    cleanup()
    expect(card({ ...job, jobType: null }).querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('null')
  })

  it('every other card leaves jobMeta out', () => {
    expect(card().querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('undefined')
  })

  it("an employer's own job (not linked) never gets jobMeta — it keeps \"Lương: thỏa thuận\"", () => {
    const job = { category: { icon: 'briefcase', slug: 'jobs' }, listingType: 'job', price: 0, city: 'Hà Nội', sellerId: 'cm-employer-seller', isPartnerBooking: false }
    expect(card({ ...job, jobType: 'fulltime' }).querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('undefined')
  })

  it('a job card from a payload without the projection (full listing, stored card) keeps today\'s label', () => {
    const job = { category: { icon: 'briefcase', slug: 'jobs' }, listingType: 'job', price: 0, city: 'Hà Nội', sellerId: 'eslboards-com-import-seller-0001' }
    expect(card(job).querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('undefined')
  })
})
