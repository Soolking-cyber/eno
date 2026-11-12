// @vitest-environment jsdom
/**
 * NAME-FIRST TEACHER CARDS (owner, 2026-11-12: "go all" — after a blind A/B, +0.15 GPT / +0.39 Opus) — pinned at the
 * component, because listing-card.tsx is a landmine file:
 *   · a TEACHER card's body reads name → rate → proof → info line in REAL DOM order (a screen reader hears the name
 *     first), the name bold at text-base / sm:text-lg (leading-snug kept), the rate a step down at text-sm / sm:text-base;
 *   · the PROOF line (owner, 2026-11-12, "build 2"): one `p[data-teacher-proof]`, 12px foreground ink, the rate row's next
 *     sibling and the info line's previous one — RESERVED on every teacher card with a real U+00A0 and aria-hidden when
 *     there is nothing to say (an old cached payload, a payload of another shape), and never on any other card;
 *   · an identity-marked teacher keeps the h3 and its tick in one row, and that row leads the body;
 *   · the hidden full title stays right after the title block, and the link's description still resolves to it;
 *   · ⛔ every OTHER card keeps the 09-13 order (price → title → info line) with the old TITLE_LINE and price classes.
 * The real <Price> renders here (its own cn() merge is part of what is pinned); the currency context is a fixed VND
 * viewer with no rates. Everything else the card pulls in is stubbed as in the identity-mark test.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

// A teacher line is never shortened by today's card-title rules; `shorten` makes cardTitle do so, to pin where the
// hidden full title sits when one is.
const titles = vi.hoisted(() => ({ shorten: false }))
vi.mock('@/lib/card-title', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/card-title')>()
  return {
    ...actual,
    cardTitle: (input: Parameters<typeof actual.cardTitle>[0]) =>
      titles.shorten ? input.title.split(' ').slice(0, 2).join(' ') : actual.cardTitle(input),
  }
})
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
// The reader's language: English by default; a test switches to Vietnamese, where `tr` answers its inline Vietnamese.
const reader = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: reader.lang, t: (k: string) => k, tr: (en: string, viText?: string) => (reader.lang === 'vi' && viText ? viText : en) }),
  useTr: (s: string) => s,
}))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: {}, ratesPending: false, format: (n: number) => String(n) }),
}))
vi.mock('./listing-content', () => ({
  useLocalized: (title: string) => title,
  PostedAgo: () => null,
}))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./rental-check-toggle', () => ({ RentalCheckToggle: () => null }))
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

const RENTAL = { listingType: 'rent', title: 'Căn hộ 2PN Quận 7', price: 8_500_000, priceUnit: 'VND/month', sellerId: 'member-seller-1', category: { icon: 'home', slug: 'rentals' } }
const PRODUCT = { listingType: 'sell', title: 'Dell XPS 13 9310', price: 12_000_000, priceUnit: 'VND', condition: 'used', sellerId: 'member-seller-2', category: { icon: 'laptop', slug: 'electronics' } }

/** TITLE_LINE, unchanged for every card but a teacher's. */
const TITLE_CLASS = 'truncate text-sm font-normal leading-snug sm:text-base text-foreground group-hover:underline decoration-1 underline-offset-2'
/** What cn(TITLE_LINE, 'text-base font-bold leading-snug sm:text-lg') resolves to — read off the render, not reasoned. */
const TEACHER_TITLE_CLASS = 'truncate text-foreground group-hover:underline decoration-1 underline-offset-2 text-base font-bold leading-snug sm:text-lg'

const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...TEACHER, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
const parts = (c: HTMLElement) => {
  const body = c.querySelector('[data-rail-media]')!.nextElementSibling as HTMLElement
  const priceRow = body.querySelector(':scope > span.flex-wrap') as HTMLElement
  return { body, priceRow, price: priceRow.querySelector('.tabular-nums') as HTMLElement, h3: c.querySelector('h3')!, link: c.querySelector('[data-card-link]')! }
}
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

afterEach(() => { cleanup(); titles.shorten = false; reader.lang = 'en' })

/** The info line, UNCHANGED (owner, 2026-09-13: "dont alter this info line"). */
const INFO_CLASS = 'mt-auto flex items-center gap-1.5 pt-1 text-xs text-ink-4 lg:text-sm lg:text-body'
const PROOF_CLASS = 'truncate text-xs text-foreground'
const proofOf = (c: HTMLElement) => c.querySelectorAll('[data-teacher-proof]')

describe('ListingCard — a TEACHER card leads with the name', () => {
  it('the h3 comes before the rate in DOM order, as the body\'s first child; the info line still closes the body', () => {
    const { body, priceRow, price, h3 } = parts(card())
    expect(body.firstElementChild).toBe(h3)
    expect(h3.nextElementSibling).toBe(priceRow)
    expect(precedes(h3, price)).toBe(true)
    expect(classes(body.lastElementChild)).toContain('mt-auto')
    expect(precedes(priceRow, body.lastElementChild!)).toBe(true)
  })

  it('the name is bold, 16px on a phone and 18px from sm, leading-snug kept; the rate drops a step', () => {
    const { h3, price } = parts(card())
    expect(h3.className).toBe(TEACHER_TITLE_CLASS)
    expect(classes(h3)).toEqual(expect.arrayContaining(['font-bold', 'text-base', 'sm:text-lg', 'leading-snug', 'truncate']))
    expect(classes(h3)).not.toContain('font-normal')
    expect(classes(h3)).not.toContain('text-sm')
    expect(classes(h3)).not.toContain('sm:text-base')
    expect(classes(price)).toEqual(expect.arrayContaining(['text-sm', 'leading-tight', 'sm:text-base', 'font-bold', 'text-price']))
    expect(classes(price)).not.toContain('text-base')
    expect(classes(price)).not.toContain('sm:text-lg')
  })

  it('a teacher with no rate keeps its muted figure at the same smaller size', () => {
    const { h3, price } = parts(card({ price: 0 }))
    expect(precedes(h3, price)).toBe(true)
    expect(price.textContent).toContain('Rate on request')
    expect(classes(price)).toEqual(expect.arrayContaining(['text-sm', 'leading-tight', 'sm:text-base', 'text-muted-foreground']))
    expect(classes(price)).not.toContain('sm:text-lg')
  })

  it('the link is still named exactly by the h3 (WCAG 2.5.3) and needs no description', () => {
    const { h3, link } = parts(card())
    expect(h3.textContent).toBe('Anna Eriksson')
    expect(link.getAttribute('aria-label')).toBe(h3.textContent)
    expect(link.hasAttribute('aria-describedby')).toBe(false)
  })

  it('an identity-marked teacher: h3 + tick stay one row, the tick the h3\'s next sibling, and the row precedes the rate', () => {
    const c = card({ identityMark: true })
    const { body, priceRow, price, h3, link } = parts(c)
    const row = h3.parentElement!
    const mark = c.querySelector('[data-identity-mark]')!
    expect(row.className).toBe('flex min-w-0 items-center gap-1')
    expect(h3.nextElementSibling).toBe(mark)
    expect(body.firstElementChild).toBe(row)
    expect(row.nextElementSibling).toBe(priceRow)
    expect(precedes(row, price)).toBe(true)
    expect(h3.className).toBe(`${TEACHER_TITLE_CLASS} min-w-0`)
    expect(link.getAttribute('aria-label')).toBe(h3.textContent)
    const described = (link.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    expect(described).toContain(mark.id)
    expect(c.ownerDocument.getElementById(mark.id)).toBe(mark)
  })

  it('a shortened teacher line: the hidden full title sits right after the title block, before the rate, and still describes the link', () => {
    titles.shorten = true
    for (const patch of [{}, { identityMark: true }]) {
      const c = card({ ...patch, title: 'Anna Maria Eriksson Lindqvist' })
      const { priceRow, h3, link } = parts(c)
      const block = patch.identityMark ? h3.parentElement! : h3
      const full = block.nextElementSibling as HTMLElement
      expect(h3.textContent).toBe('Anna Maria')
      expect(link.getAttribute('aria-label')).toBe('Anna Maria')
      expect(full.tagName).toBe('SPAN')
      expect(full.hidden).toBe(true)
      expect(full.textContent).toBe('Anna Maria Eriksson Lindqvist')
      expect(full.nextElementSibling).toBe(priceRow)
      const described = (link.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
      expect(described).toContain(full.id)
      expect(c.ownerDocument.getElementById(full.id)).toBe(full)
      cleanup()
    }
  })
})

describe('ListingCard — a TEACHER card\'s proof line (owner, 2026-11-12, "build 2")', () => {
  it('name → rate → PROOF → info line: one p, the rate row\'s next sibling, the info line\'s previous one', () => {
    const c = card({ teacherProof: ['celta', '5-10-years'] })
    const { body, priceRow } = parts(c)
    const all = proofOf(c)
    expect(all).toHaveLength(1)
    const p = all[0] as HTMLElement
    expect(p.tagName).toBe('P')
    expect(p.parentElement).toBe(body)
    expect(priceRow.nextElementSibling).toBe(p)
    expect(p.nextElementSibling).toBe(body.lastElementChild)
    expect(classes(p.nextElementSibling)).toContain('mt-auto')
    expect(p.className).toBe(PROOF_CLASS)
    expect(p.textContent).toBe('CELTA · 5–10 yrs')
    expect(p.hasAttribute('aria-hidden')).toBe(false)
  })

  it('in Vietnamese: the inline Vietnamese, a certificate\'s name unchanged', () => {
    reader.lang = 'vi'
    const p = proofOf(card({ teacherProof: ['celta', '5-10-years'] }))[0]
    expect(p.textContent).toBe('CELTA · 5–10 năm')
  })

  it('a band alone reads as the profile\'s phrase', () => {
    expect(proofOf(card({ teacherProof: ['5-10-years'] }))[0].textContent).toBe('5–10 years teaching')
  })

  it('⛔ RESERVED when there is nothing to say — an old cached payload (no key): a real U+00A0, aria-hidden, same place', () => {
    const c = card()
    const { body, priceRow } = parts(c)
    const all = proofOf(c)
    expect(all).toHaveLength(1)
    const p = all[0] as HTMLElement
    expect(priceRow.nextElementSibling).toBe(p)
    expect(p.nextElementSibling).toBe(body.lastElementChild)
    expect(p.className).toBe(PROOF_CLASS)
    // ⚠️ EXACT, not a whitespace-normalising matcher: a plain space would collapse to a 0px line and lose the reserve.
    expect(p.textContent).toBe('\u00a0')
    expect(p.textContent!.charCodeAt(0)).toBe(0xa0)
    expect(p.getAttribute('aria-hidden')).toBe('true')
  })

  it('the reserve is WRITTEN as the escape in the source, never a typed U+00A0 an editor or tool can turn into a space', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/marketplace/listing-card.tsx', 'utf8')
    expect(src).toContain(String.raw`{proofLine ?? '\u00a0'}`)
    expect(src).not.toContain('\u00a0')
  })

  it('⛔ a payload of another shape (a /saved card cached by an older or newer build) renders the reserved line, never a crash', () => {
    for (const teacherProof of ['TEFL · 5–10 yrs', { 0: 'tefl' }, 42, [], ['__proto__', 'cambridge-diploma']]) {
      const p = proofOf(card({ teacherProof }))[0]
      expect(p.textContent, JSON.stringify(teacherProof)).toBe('\u00a0')
      expect(p.getAttribute('aria-hidden')).toBe('true')
      cleanup()
    }
  })

  it('an identity-marked teacher: the same place — after the rate row, before the info line', () => {
    const c = card({ identityMark: true, teacherProof: ['tefl', 'master'] })
    const { body, priceRow, h3 } = parts(c)
    const p = proofOf(c)[0] as HTMLElement
    expect(body.firstElementChild).toBe(h3.parentElement)
    expect(h3.parentElement!.nextElementSibling).toBe(priceRow)
    expect(priceRow.nextElementSibling).toBe(p)
    expect(p.nextElementSibling).toBe(body.lastElementChild)
    expect(p.textContent).toBe("TEFL · Master's")
  })

  it('the info line\'s class string is unchanged, with and without a proof line', () => {
    for (const patch of [{}, { teacherProof: ['tefl'] }, PRODUCT]) {
      const { body } = parts(card(patch))
      expect(body.lastElementChild!.className).toBe(INFO_CLASS)
      cleanup()
    }
  })

  it('the link is still named exactly by the h3, and the proof adds no description', () => {
    for (const patch of [{ teacherProof: ['celta', '5-10-years'] }, { identityMark: true, teacherProof: ['celta'] }]) {
      const c = card(patch)
      const { h3, link } = parts(c)
      const p = proofOf(c)[0] as HTMLElement
      expect(link.getAttribute('aria-label')).toBe(h3.textContent)
      expect(link.getAttribute('aria-label')).not.toContain('CELTA')
      // The proof is no description: it has no id, and the link describes only the tick (when there is one).
      expect(p.id).toBe('')
      const described = (link.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
      expect(described).toEqual(patch.identityMark ? [c.querySelector('[data-identity-mark]')!.id] : [])
      cleanup()
    }
  })

  it('⛔ a rental or a product carrying a stray teacherProof draws no proof line', () => {
    for (const patch of [RENTAL, PRODUCT]) {
      const c = card({ ...patch, teacherProof: ['celta', '5-10-years'] })
      expect(proofOf(c)).toHaveLength(0)
      expect(c.textContent).not.toContain('CELTA')
      cleanup()
    }
  })
})

describe('ListingCard — ⛔ every other card keeps the 09-13 order and classes', () => {
  it('a rental and a product: the price row leads, then the h3 with the old TITLE_LINE, at the old price size', () => {
    for (const patch of [RENTAL, PRODUCT]) {
      const { body, priceRow, price, h3 } = parts(card(patch))
      expect(body.firstElementChild).toBe(priceRow)
      expect(priceRow.nextElementSibling).toBe(h3)
      expect(body.querySelector('[data-teacher-proof]')).toBeNull()
      expect(precedes(price, h3)).toBe(true)
      expect(h3.className).toBe(TITLE_CLASS)
      expect(h3.parentElement).toBe(body)
      expect(classes(price)).toEqual(expect.arrayContaining(['text-base', 'leading-tight', 'sm:text-lg']))
      expect(classes(price)).not.toContain('text-sm')
      expect(classes(price)).not.toContain('sm:text-base')
      cleanup()
    }
  })
})
