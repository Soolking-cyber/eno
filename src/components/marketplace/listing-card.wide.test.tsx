// @vitest-environment jsdom
/**
 * ⛔ THE WIDE PHONE CARD (owner-approved 2026-11-14, cook r06 rentals-a — listing-card.tsx `wide`; /c/rentals and the rentals feed,
 * one column of large square cards below `sm`). What the card prints, pinned at the component:
 *   · every class `wide` adds is `max-sm:` or sits on an element that is `sm:hidden`, so from `sm` the card is the grid card;
 *   · ⛔ since build 8 (owner-approved 2026-11-15, cook r08 rentals) the body is ONE column of three lines on every card (card-text.ts
 *     WIDE_BODY): the price row (28px, WIDE_PRICE_ROW), the title, the info line — no slot after the price any more;
 *   · the photo's top is one band (`data-photo-top`, a grid): status top-left — the badge, and a non-sponsored partner's "Official
 *     partner" plate (owner-approved 2026-11-15 (build 7), cook r07 rentals) — and the availability check top-right as the
 *     labelled chip, beside the heart, on every card it applies to; the plate takes the band's second row under the check's;
 *     the copy each replaces steps down below `sm` only;
 *   · the figure is 22/28 (WIDE_PRICE) and its unit 16 regular ink-3 (WIDE_UNIT) on a phone;
 *   · the title is the body role in ink; the info line 14/20 shows the freshness; the pips show; the heart's plate grows;
 *   · without `wide` the card renders none of it (the two-up card is untouched).
 * The card's own rules are the subject; what it pulls in is stubbed (listing-card.a4.test.tsx's harness).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { WIDE_BODY, WIDE_META, WIDE_PRICE, WIDE_PRICE_ROW, WIDE_TITLE, WIDE_UNIT } from '@/lib/card-text'

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
  PostedAgo: () => <time data-posted-ago="" />,
}))
vi.mock('@/lib/lang-pinned', () => ({ localizedHref: (href: string) => href }))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({
  PartnerBadge: ({ onPhoto, className }: { onPhoto?: boolean; className?: string }) => (
    <span data-partner-badge={onPhoto ? 'photo' : 'plate'} className={className} />
  ),
}))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: ({ className }: { className?: string }) => <span data-card-badges="" className={className} /> }))
vi.mock('./rental-check-toggle', () => ({
  RentalCheckToggle: ({ variant, className }: { variant: string; className?: string }) => <button type="button" data-rental-check-toggle={variant} className={className} />,
}))
vi.mock('./price', () => ({
  Price: ({ price, className, approxClassName, unitClassName }: { price: number; className?: string; approxClassName?: string; unitClassName?: string }) => (
    <span data-price="" data-class={className ?? ''} data-approx-class={approxClassName ?? ''} data-unit-class={unitClassName ?? ''}>{price}</span>
  ),
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { ListingCard } from './listing-card'

const HOME = {
  id: 'l1',
  title: 'Duplex 20 m²',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400', 'https://picsum.photos/seed/b/400'],
  video: null,
  price: 3_790_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'rent',
  location: 'Binh Thuy Ward, Binh Thuy',
  city: 'Cần Thơ',
  lat: null,
  lng: null,
  condition: null,
  savedCount: 0,
  negotiable: false,
  isPartnerBooking: false,
  sellerId: 'cm-member-seller',
  subcategorySlug: 'apartment-rental',
  seller: { trustScore: 80, isBusiness: false, officialPartner: false },
  category: { icon: 'home', slug: 'rentals' },
  postedAt: '2026-11-13T00:00:00.000Z',
  brandSlug: null,
  model: null,
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown> = {}, wide = true) => {
  const { container } = render(<ListingCard listing={{ ...HOME, ...patch } as SerializedListingCard} onOpen={vi.fn()} wide={wide} />)
  return container
}
const body = (c: HTMLElement) => c.querySelector('[data-card-root] > div:last-child') as HTMLElement
const band = (c: HTMLElement) => c.querySelector('[data-rail-media] [data-photo-top]') as HTMLElement | null
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** Every class a wide card ADDS must be phone-only — `max-sm:` — or live on an element that is `sm:hidden`. */
const phoneOnly = (cls: string[]) => cls.filter((t) => !t.startsWith('max-sm:'))

afterEach(cleanup)

describe('ListingCard wide — the text block', () => {
  it('the body is the WIDE_BODY column on a phone; every class it adds is max-sm:', () => {
    const wide = tokens(body(card()))
    const plain = tokens(body(card({}, false)))
    expect(wide).toEqual(expect.arrayContaining(WIDE_BODY.split(' ')))
    expect(phoneOnly(wide.filter((t) => !plain.includes(t)))).toEqual([])
  })

  // ⛔ Build 8 (owner-approved 2026-11-15, cook r08 rentals): one fixed text order on every card, the price row 28px, no slot.
  it('three lines in one order on every card — the price row (28px on a phone), the title, the info line — and no slot', () => {
    for (const patch of [{}, { subcategorySlug: 'motorbike-rental' }, { seller: { trustScore: 90, isBusiness: true, officialPartner: true } }]) {
      const b = body(card(patch))
      const kids = [...b.children]
      expect(kids).toHaveLength(3)
      expect(kids[0].querySelector('[data-price]')).not.toBeNull()
      expect(tokens(kids[0])).toEqual(expect.arrayContaining(WIDE_PRICE_ROW.split(' ')))
      expect(kids[1].getAttribute('role')).toBe('heading') // the title: a level-3 heading for assistive tech, not an <h3> tag (2026-11-19)
      expect(kids[1].getAttribute('aria-level')).toBe('3')
      expect(kids[2]).toBe(b.lastElementChild)
      expect(b.querySelector('[data-trust-slot]')).toBeNull()
      expect(b.querySelector('[data-rental-check-toggle]')).toBeNull()
      cleanup()
    }
    expect(WIDE_PRICE_ROW.split(' ').every((t) => t.startsWith('max-sm:'))).toBe(true)
  })

  it('a home the check applies to: the labelled chip on the photo\'s top band (col 2, sm:hidden), the photo\'s glyph copy max-sm:hidden', () => {
    const c = card()
    const chip = band(c)!.querySelector('[data-rental-check-toggle]')!
    expect(chip.getAttribute('data-rental-check-toggle')).toBe('chip')
    expect(tokens(chip)).toEqual(expect.arrayContaining(['pointer-events-auto', 'col-start-2', 'sm:hidden']))
    const photoCopy = [...c.querySelectorAll('[data-rail-media] [data-rental-check-toggle]')].find((t) => !band(c)!.contains(t))!
    expect(photoCopy.getAttribute('data-rental-check-toggle')).toBe('card')
    expect(tokens(photoCopy)).toContain('max-sm:hidden')
  })

  // ⛔ Since build 7 (owner-approved 2026-11-15, cook r07 rentals): trust is the photo's plate.
  it('a partner where the check does not apply (vehicle hire): no check, "Official partner" is the photo plate (sm:hidden); the info line\'s marks step down below sm', () => {
    const c = card({ subcategorySlug: 'motorbike-rental', seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    expect(c.querySelector('[data-rental-check-toggle]')).toBeNull()
    const plate = band(c)!.querySelector('[data-partner-badge="photo"]')!
    expect(tokens(plate)).toEqual(expect.arrayContaining(['col-span-2', 'sm:hidden']))
    const meta = body(c).lastElementChild!
    // The WHOLE badge steps down below sm (its wrapper), so its role="img" name is not announced beside the plate's.
    expect(tokens(meta.querySelector('[data-partner-badge="plate"]')!.parentElement)).toEqual(expect.arrayContaining(['contents', 'max-sm:hidden']))
    const name = [...meta.querySelectorAll('.sr-only')].find((e) => e.textContent?.trim() === 'Official partner')!
    expect(tokens(name)).toContain('max-sm:hidden')
  })

  it('a partner the check applies to: status left, the check right, the plate the band\'s next row (DOM: badge, check, plate)', () => {
    const c = card({ urgent: true, seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    const kids = [...band(c)!.children]
    expect(kids.map((k) => k.getAttribute('data-card-badges') != null ? 'badge' : k.getAttribute('data-rental-check-toggle') ?? k.getAttribute('data-partner-badge'))).toEqual(['badge', 'chip', 'photo'])
    expect(tokens(body(c).lastElementChild!.querySelector('[data-partner-badge="plate"]')!.parentElement)).toEqual(expect.arrayContaining(['contents', 'max-sm:hidden']))
  })

  it('the band is ONE grid on the photo: the badge\'s column gives way to the check, inset to the 12px edge and 12px left of the heart on a phone; from sm the badge\'s old box', () => {
    const c = card({ urgent: true, seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    const b = band(c)!
    expect(tokens(b)).toEqual(expect.arrayContaining(['pointer-events-none', 'absolute', 'grid', 'grid-cols-[minmax(0,1fr)_auto]', 'items-start', 'gap-y-2.5', 'left-2', 'right-11', 'top-2', 'max-sm:left-3', 'max-sm:right-15', 'max-sm:top-3', 'max-sm:gap-x-2']))
    // From sm a column gap would narrow the badge: phone-only.
    expect(tokens(b)).not.toContain('gap-x-2')
    expect(tokens(b.firstElementChild)).toContain('max-w-full')
    // No check and no plate (a sponsored car hire): no band, the badge alone, as on every card.
    cleanup()
    const plain = card({ subcategorySlug: 'car-rental', isSponsored: true, seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    expect(band(plain)).toBeNull()
    expect(plain.querySelector('[data-partner-badge="photo"]')).toBeNull()
    expect(tokens(plain.querySelector('[data-card-badges]'))).toEqual(expect.arrayContaining(['absolute', 'max-sm:left-3', 'max-sm:top-3']))
  })

  it('the price: the figure 22/28 and its unit 16 regular ink-3 on a phone, the ≈$ at 14/20; a word price keeps 17/22; the plain card passes none', () => {
    const wide = card().querySelector('[data-price]')!
    expect(wide.getAttribute('data-class')!.split(' ')).toEqual(expect.arrayContaining(['text-t-price', WIDE_PRICE]))
    expect(wide.getAttribute('data-unit-class')).toBe(WIDE_UNIT)
    expect(WIDE_UNIT.split(' ').every((t) => t.startsWith('max-sm:'))).toBe(true)
    expect((wide.getAttribute('data-approx-class') ?? '').split(' ')).toContain('max-sm:text-sm')
    cleanup()
    expect(card({ price: 0 }).querySelector('[data-price]')!.getAttribute('data-class')).toBe('text-t-price')
    cleanup()
    const plain = card({}, false).querySelector('[data-price]')!
    expect(plain.getAttribute('data-class')).toBe('text-t-price')
    expect(plain.getAttribute('data-unit-class')).toBe('')
    expect((plain.getAttribute('data-approx-class') ?? '').split(' ')).not.toContain('max-sm:text-sm')
  })

  it('the title: the body role in ink; the info line 14/20 with the freshness shown', () => {
    const c = card()
    expect(tokens(c.querySelector('[role="heading"]'))).toEqual(expect.arrayContaining(WIDE_TITLE.split(' ')))
    const meta = body(c).lastElementChild!
    expect(tokens(meta)).toEqual(expect.arrayContaining(WIDE_META.split(' ')))
    const time = meta.querySelector('[data-posted-ago]')!.parentElement!
    expect(tokens(time)).toEqual(expect.arrayContaining(['hidden', 'sm:inline', 'max-sm:inline']))
  })
})

describe('ListingCard wide — the photo', () => {
  it('pips show (12px off the edge), badges and the heart grow and inset to the big photo — phone only', () => {
    const c = card()
    const pips = c.querySelector('[data-rail-media] > div.card-pips')!
    expect(tokens(pips)).toContain('max-sm:bottom-3')
    expect(tokens(pips)).not.toContain('max-sm:hidden')
    expect(tokens(band(c))).toEqual(expect.arrayContaining(['max-sm:left-3', 'max-sm:top-3']))
    const heart = c.querySelector('button[aria-label="Save listing"]')!
    expect(tokens(heart)).toContain('max-sm:size-11')
    expect(tokens(heart.querySelector('svg'))).toContain('max-sm:size-6')
  })
})

describe('ListingCard without `wide` — the two-up card is untouched', () => {
  it('a partner on the two-up card: no photo plate, the info line\'s shield and name at every width, the 17/22 figure', () => {
    const c = card({ seller: { trustScore: 90, isBusiness: true, officialPartner: true } }, false)
    expect(c.querySelector('[data-partner-badge="photo"]')).toBeNull()
    expect(tokens(c.querySelector('[data-partner-badge="plate"]'))).not.toContain('max-sm:hidden')
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')).toBe('text-t-price')
  })

  it('no photo band and no slot, the photo chip as before, pips phone-hidden, the time sm-only, no wide class anywhere', () => {
    const c = card({}, false)
    expect(c.querySelector('[data-trust-slot]')).toBeNull()
    expect(band(c)).toBeNull()
    expect(c.querySelectorAll('[data-rental-check-toggle]')).toHaveLength(1)
    expect(tokens(c.querySelector('[data-rail-media] [data-rental-check-toggle]'))).not.toContain('max-sm:hidden')
    expect(tokens(c.querySelector('[data-rail-media] > div.card-pips'))).toContain('max-sm:hidden')
    const html = c.innerHTML
    for (const t of [...WIDE_BODY.split(' '), ...WIDE_TITLE.split(' '), ...WIDE_PRICE_ROW.split(' '), 'max-sm:size-11', 'max-sm:size-6', 'max-sm:inline', 'max-sm:left-3', 'max-sm:right-15']) {
      expect(html, t).not.toContain(` ${t}"`)
      expect(html, t).not.toContain(` ${t} `)
    }
  })
})
