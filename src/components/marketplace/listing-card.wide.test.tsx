// @vitest-environment jsdom
/**
 * ⛔ THE WIDE PHONE CARD (owner-approved 2026-11-14, cook r06 rentals-a — listing-card.tsx `wide`; /c/rentals and the rentals feed,
 * one column of large square cards below `sm`). What the card prints, pinned at the component:
 *   · every class `wide` adds is `max-sm:` or sits on an element that is `sm:hidden`, so from `sm` the card is the grid card;
 *   · the body is a two-column grid (card-text.ts WIDE_BODY): the price and ONE trust slot on row 1, title and info across;
 *   · the trust slot holds the availability check as the labelled chip where the check applies, else "Official partner" in
 *     words where the partner shield would show — never both — and the copy each replaces steps down below `sm` only;
 *   · the title is the body role in ink; the info line 14/20 shows the freshness; the pips show; the heart's plate grows;
 *   · without `wide` the card renders none of it (the two-up card is untouched).
 * The card's own rules are the subject; what it pulls in is stubbed (listing-card.a4.test.tsx's harness).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { WIDE_BODY, WIDE_META, WIDE_TITLE } from '@/lib/card-text'

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
  PartnerBadge: ({ labelled, className }: { labelled?: boolean; className?: string }) => (
    <span data-partner-badge={labelled ? 'labelled' : 'plate'} className={className} />
  ),
}))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: ({ className }: { className?: string }) => <span data-card-badges="" className={className} /> }))
vi.mock('./rental-check-toggle', () => ({
  RentalCheckToggle: ({ variant, className }: { variant: string; className?: string }) => <button type="button" data-rental-check-toggle={variant} className={className} />,
}))
vi.mock('./price', () => ({
  Price: ({ price, approxClassName, unitClassName }: { price: number; approxClassName?: string; unitClassName?: string }) => (
    <span data-price="" data-approx-class={approxClassName ?? ''} data-unit-class={unitClassName ?? ''}>{price}</span>
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
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** Every class a wide card ADDS must be phone-only — `max-sm:` — or live on an element that is `sm:hidden`. */
const phoneOnly = (cls: string[]) => cls.filter((t) => !t.startsWith('max-sm:'))

afterEach(cleanup)

describe('ListingCard wide — the text block', () => {
  it('the body is the WIDE_BODY grid on a phone; every class it adds is max-sm:', () => {
    const wide = tokens(body(card()))
    const plain = tokens(body(card({}, false)))
    expect(wide).toEqual(expect.arrayContaining(WIDE_BODY.split(' ')))
    expect(phoneOnly(wide.filter((t) => !plain.includes(t)))).toEqual([])
  })

  it('row 1: the price, then ONE trust slot (sm:hidden) — DOM order is the visual order', () => {
    const b = body(card())
    const kids = [...b.children]
    expect(kids[0].querySelector('[data-price]')).not.toBeNull()
    const slot = kids[1] as HTMLElement
    expect(slot.hasAttribute('data-trust-slot')).toBe(true)
    expect(tokens(slot)).toEqual(expect.arrayContaining(['min-h-9', 'sm:hidden']))
    expect(kids[2].tagName).toBe('H3')
  })

  it('a home the check applies to: the labelled chip in the slot, the photo copy max-sm:hidden', () => {
    const c = card()
    const chip = c.querySelector('[data-trust-slot] [data-rental-check-toggle]')!
    expect(chip.getAttribute('data-rental-check-toggle')).toBe('chip')
    const photoCopy = c.querySelector('[data-rail-media] [data-rental-check-toggle]')!
    expect(photoCopy.getAttribute('data-rental-check-toggle')).toBe('card')
    expect(tokens(photoCopy)).toContain('max-sm:hidden')
  })

  it('a partner where the check does not apply (vehicle hire): "Official partner" in words; the info line\'s marks step down below sm', () => {
    const c = card({ subcategorySlug: 'motorbike-rental', seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    expect(c.querySelector('[data-trust-slot] [data-partner-badge]')!.getAttribute('data-partner-badge')).toBe('labelled')
    expect(c.querySelector('[data-rental-check-toggle]')).toBeNull()
    const meta = body(c).lastElementChild!
    expect(tokens(meta.querySelector('[data-partner-badge="plate"]'))).toContain('max-sm:hidden')
    const name = [...meta.querySelectorAll('.sr-only')].find((e) => e.textContent === 'Official partner')!
    expect(tokens(name)).toContain('max-sm:hidden')
  })

  it('never both: a partner the check applies to keeps the chip in the slot and its shield on the info line', () => {
    const c = card({ seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    expect(c.querySelectorAll('[data-trust-slot] > *')).toHaveLength(1)
    expect(c.querySelector('[data-trust-slot] [data-rental-check-toggle="chip"]')).not.toBeNull()
    expect(tokens(c.querySelector('[data-partner-badge="plate"]'))).not.toContain('max-sm:hidden')
  })

  it('a sponsored row: no partner words (the Ad label keeps its slot), the slot still holds the row', () => {
    const c = card({ subcategorySlug: 'car-rental', isSponsored: true, seller: { trustScore: 90, isBusiness: true, officialPartner: true } })
    expect(c.querySelector('[data-trust-slot]')!.children).toHaveLength(0)
  })

  it('the price: its unit regular and its ≈$ at 14/20 on a phone; the plain card passes neither', () => {
    const wide = card().querySelector('[data-price]')!
    expect(wide.getAttribute('data-unit-class')).toBe('max-sm:font-normal')
    expect((wide.getAttribute('data-approx-class') ?? '').split(' ')).toContain('max-sm:text-sm')
    cleanup()
    const plain = card({}, false).querySelector('[data-price]')!
    expect(plain.getAttribute('data-unit-class')).toBe('')
    expect((plain.getAttribute('data-approx-class') ?? '').split(' ')).not.toContain('max-sm:text-sm')
  })

  it('the title: the body role in ink across both columns; the info line 14/20 with the freshness shown', () => {
    const c = card()
    expect(tokens(c.querySelector('h3'))).toEqual(expect.arrayContaining(WIDE_TITLE.split(' ')))
    const meta = body(c).lastElementChild!
    expect(tokens(meta)).toEqual(expect.arrayContaining(WIDE_META.split(' ')))
    const time = meta.querySelector('[data-posted-ago]')!.parentElement!
    expect(tokens(time)).toEqual(expect.arrayContaining(['hidden', 'sm:inline', 'max-sm:inline']))
  })
})

describe('ListingCard wide — the photo', () => {
  it('pips show (12px off the edge), badges and the heart grow and inset to the big photo — phone only', () => {
    const c = card()
    const pips = c.querySelector('[data-rail-media] > div.pointer-events-none.absolute.left-1\\/2')!
    expect(tokens(pips)).toContain('max-sm:bottom-3')
    expect(tokens(pips)).not.toContain('max-sm:hidden')
    expect(tokens(c.querySelector('[data-card-badges]'))).toEqual(expect.arrayContaining(['max-sm:left-3', 'max-sm:top-3']))
    const heart = c.querySelector('button[aria-label="Save listing"]')!
    expect(tokens(heart)).toContain('max-sm:size-11')
    expect(tokens(heart.querySelector('svg'))).toContain('max-sm:size-6')
  })
})

describe('ListingCard without `wide` — the two-up card is untouched', () => {
  it('no trust slot, the photo chip as before, pips phone-hidden, the time sm-only, no wide class anywhere', () => {
    const c = card({}, false)
    expect(c.querySelector('[data-trust-slot]')).toBeNull()
    expect(tokens(c.querySelector('[data-rail-media] [data-rental-check-toggle]'))).not.toContain('max-sm:hidden')
    expect(tokens(c.querySelector('[data-rail-media] > div.pointer-events-none.absolute.left-1\\/2'))).toContain('max-sm:hidden')
    const html = c.innerHTML
    for (const t of [...WIDE_BODY.split(' '), ...WIDE_TITLE.split(' '), 'max-sm:size-11', 'max-sm:size-6', 'max-sm:inline', 'max-sm:left-3']) {
      expect(html, t).not.toContain(` ${t}"`)
      expect(html, t).not.toContain(` ${t} `)
    }
  })
})
