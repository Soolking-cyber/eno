// @vitest-environment jsdom
/**
 * NAME-FIRST TEACHER CARDS (owner, 2026-11-12: "go all" — after a blind A/B, +0.15 GPT / +0.39 Opus) — pinned at the
 * component, because listing-card.tsx is a landmine file:
 *   · a TEACHER card's body reads name → rate → proof → info line in REAL DOM order (a screen reader hears the name
 *     first), the name bold at the h3 role (text-t-h3, tracking-tight on a phone) / sm:text-lg (sm:leading-snug); the rate
 *     the name's lockup since build 7 (owner-approved 2026-11-15, cook r07 teachers): the figure 16/22 bold ink (16/20 from sm),
 *     its unit a 13 muted regular label on a phone, "Rate on request" 14/22 muted regular on a phone (16/20 bold from sm); the
 *     text block runs to the photo's right edge on a phone (`max-sm:pr-0`), its left inset kept;
 *   · the PROOF line (owner, 2026-11-12, "build 2"): one `p[data-teacher-proof]`, 14px ink-2 since 2026-11-14, the rate row's
 *     next sibling and the info line's previous one; a card with nothing to say (an old cached payload, a payload of another
 *     shape) holds `p[data-teacher-proof-reserve]` — a real U+00A0, aria-hidden — in the SAME slot (one fixed slot since build 7,
 *     so the place line sits at one height across a row and the card keeps its height); never on any other card;
 *   · the teacher info line is top-aligned: no `mt-auto`, no top padding;
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
const TITLE_CLASS = 'truncate -mt-px pt-px text-t-card font-normal text-ink-3 group-hover:underline decoration-1 underline-offset-2' // card-text.ts TITLE_LINE (2026-11-14)
/** What cn(TITLE_LINE, 'text-t-h3 font-bold max-sm:tracking-tight sm:text-lg sm:leading-snug text-foreground') resolves to — read off the render, not reasoned. */
const TEACHER_TITLE_CLASS = 'truncate -mt-px pt-px group-hover:underline decoration-1 underline-offset-2 text-t-h3 font-bold max-sm:tracking-tight sm:text-lg sm:leading-snug text-foreground'

const card = (patch: Record<string, unknown> = {}) =>
  render(<ListingCard listing={{ ...TEACHER, ...patch } as SerializedListingCard} onOpen={vi.fn()} />).container
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
const parts = (c: HTMLElement) => {
  const body = c.querySelector('[data-rail-media]')!.nextElementSibling as HTMLElement
  const priceRow = body.querySelector(':scope > span.flex-wrap') as HTMLElement
  return { body, priceRow, price: priceRow.querySelector('.tabular-nums') as HTMLElement, h3: c.querySelector('[role="heading"]')!, link: c.querySelector('[data-card-link]')! }
}
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

afterEach(() => { cleanup(); titles.shorten = false; reader.lang = 'en' })

/** The info line, its FACTS unchanged (owner, 2026-09-13: "dont alter this info line"); its type is the meta role since 2026-11-14
 *  (owner-approved, cook r05; card-text.ts CARD_META). */
const INFO_CLASS = 'mt-auto flex items-center gap-1.5 pt-0.5 text-t-meta text-muted-foreground lg:text-sm lg:text-body'
/** A teacher's info line (2026-11-14): the same facts and type, top-aligned — no `mt-auto`, no top padding. */
const TEACHER_INFO_CLASS = 'flex items-center gap-1.5 text-t-meta text-muted-foreground lg:text-sm lg:text-body pt-0'
const PROOF_CLASS = 'truncate text-sm text-body'
const proofOf = (c: HTMLElement) => c.querySelectorAll('[data-teacher-proof]')
const reserveOf = (c: HTMLElement) => c.querySelectorAll('[data-teacher-proof-reserve]')
/** The info line: the body's child holding the truncating facts span (the body's last child). */
const infoOf = (body: HTMLElement) => [...body.children].find((e) => e.className.includes('items-center gap-1.5')) as HTMLElement

describe('ListingCard — a TEACHER card leads with the name', () => {
  it('the h3 comes before the rate in DOM order, as the body\'s first child; the info line follows, top-aligned', () => {
    const { body, priceRow, price, h3 } = parts(card({ teacherProof: ['tefl'] }))
    expect(body.firstElementChild).toBe(h3)
    expect(h3.nextElementSibling).toBe(priceRow)
    expect(precedes(h3, price)).toBe(true)
    // With a proof line the info line closes the body; it no longer floats to the foot (no mt-auto, 2026-11-14).
    expect(body.lastElementChild).toBe(infoOf(body))
    expect(classes(body.lastElementChild)).not.toContain('mt-auto')
    expect(precedes(priceRow, body.lastElementChild!)).toBe(true)
  })

  it('the name is bold and in ink, the h3 role (17/24) on a phone and 18px from sm; the rate 16/22 bold ink, 16/20 from sm (build 7)', () => {
    const { body, h3, price } = parts(card())
    expect(h3.className).toBe(TEACHER_TITLE_CLASS)
    expect(classes(h3)).toEqual(expect.arrayContaining(['font-bold', 'text-t-h3', 'sm:text-lg', 'sm:leading-snug', 'truncate']))
    expect(classes(h3)).not.toContain('font-normal')
    expect(classes(h3)).not.toContain('text-sm')
    expect(classes(h3)).not.toContain('text-base')
    expect(classes(price)).toEqual(expect.arrayContaining(['text-base', 'leading-5.5', 'sm:leading-5', 'font-bold', 'text-price']))
    expect(classes(price)).not.toContain('text-sm')
    expect(classes(price)).not.toContain('text-muted-foreground')
    expect(classes(price)).not.toContain('sm:text-lg')
    // The unit is a label beside the figure on a phone (TEACHER_RATE_UNIT): English glues the short "/mo" to the figure's run.
    const unit = [...price.querySelectorAll('span[aria-hidden="true"]')].find((e) => e.textContent === '/mo')!
    expect(classes(unit)).toEqual(['max-sm:text-t-meta', 'max-sm:font-normal', 'max-sm:text-muted-foreground'])
    // The text block keeps its left inset and runs to the photo's right edge on a phone (TEACHER_BODY).
    expect(classes(body)).toEqual(expect.arrayContaining(['px-2', 'max-sm:pr-0', 'sm:px-0.5']))
  })

  it('in Vietnamese the long unit (" / <unit>", no short form) is the same label', () => {
    reader.lang = 'vi'
    const { price } = parts(card())
    // The unit word is translated by the real provider (this suite stubs it, so it prints the stored word).
    const unit = [...price.querySelectorAll('span')].find((e) => e.className === 'max-sm:text-t-meta max-sm:font-normal max-sm:text-muted-foreground')!
    expect(unit.textContent).toMatch(/^ \/ \S/)
    expect(price.querySelector('span[aria-hidden="true"]')).toBeNull() // no glued short run in Vietnamese
  })

  it('a teacher with no rate: "Rate on request" 14 muted REGULAR in the figure\'s 22px slot on a phone — never louder than a rate (build 7); 16/20 bold muted from sm', () => {
    const { h3, price } = parts(card({ price: 0 }))
    expect(precedes(h3, price)).toBe(true)
    expect(price.textContent).toContain('Rate on request')
    expect(classes(price)).toEqual(expect.arrayContaining(['text-sm', 'leading-5.5', 'font-normal', 'sm:text-base', 'sm:leading-5', 'sm:font-bold', 'text-muted-foreground']))
    expect(classes(price)).not.toContain('font-semibold')
    expect(classes(price)).not.toContain('font-bold')
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

describe('ListingCard — a TEACHER card\'s proof line (owner, 2026-11-12, "build 2"; one fixed slot since build 7, 2026-11-15)', () => {
  it('name → rate → PROOF → info line: one p, the rate row\'s next sibling, the info line\'s previous one; no reserve', () => {
    const c = card({ teacherProof: ['celta', '5-10-years'] })
    const { body, priceRow } = parts(c)
    const all = proofOf(c)
    expect(all).toHaveLength(1)
    const p = all[0] as HTMLElement
    expect(p.tagName).toBe('P')
    expect(p.parentElement).toBe(body)
    expect(priceRow.nextElementSibling).toBe(p)
    expect(p.nextElementSibling).toBe(infoOf(body))
    expect(p.nextElementSibling).toBe(body.lastElementChild)
    expect(p.className).toBe(PROOF_CLASS)
    expect(p.textContent).toBe('CELTA · 5–10 yrs')
    expect(p.hasAttribute('aria-hidden')).toBe(false)
    expect(reserveOf(c)).toHaveLength(0)
  })

  it('in Vietnamese: the inline Vietnamese, a certificate\'s name unchanged', () => {
    reader.lang = 'vi'
    const p = proofOf(card({ teacherProof: ['celta', '5-10-years'] }))[0]
    expect(p.textContent).toBe('CELTA · 5–10 năm')
  })

  it('a band alone reads short, like the card beside it (batch 86)', () => {
    expect(proofOf(card({ teacherProof: ['5-10-years'] }))[0].textContent).toBe('5–10 yrs')
  })

  it('⛔ nothing to say (an old cached payload, no key): no proof line — its reserve holds the SAME slot, and the place line closes the body', () => {
    const c = card()
    const { body, priceRow } = parts(c)
    expect(proofOf(c)).toHaveLength(0)
    const info = infoOf(body)
    const all = reserveOf(c)
    expect(all).toHaveLength(1)
    const r = all[0] as HTMLElement
    expect(priceRow.nextElementSibling).toBe(r)
    expect(r.nextElementSibling).toBe(info)
    expect(body.lastElementChild).toBe(info)
    expect(r.tagName).toBe('P')
    expect(r.className).toBe('text-sm') // the proof line's 14/20 box: every teacher card is one height
    // ⚠️ EXACT, not a whitespace-normalising matcher: a plain space would collapse to a 0px line and lose the reserve.
    expect(r.textContent).toBe('\u00a0')
    expect(r.textContent!.charCodeAt(0)).toBe(0xa0)
    expect(r.getAttribute('aria-hidden')).toBe('true')
  })

  it('the reserve is WRITTEN as the escape in the source, never a typed U+00A0 an editor or tool can turn into a space', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/marketplace/listing-card.tsx', 'utf8')
    expect(src).toContain(String.raw`{'\u00a0'}`)
    expect(src).not.toContain('\u00a0')
  })

  it('⛔ a payload of another shape (a /saved card cached by an older or newer build) renders the reserve, never a crash', () => {
    for (const teacherProof of ['TEFL · 5–10 yrs', { 0: 'tefl' }, 42, [], ['__proto__', 'cambridge-diploma']]) {
      const c = card({ teacherProof })
      expect(proofOf(c), JSON.stringify(teacherProof)).toHaveLength(0)
      const r = reserveOf(c)[0]
      expect(r.textContent, JSON.stringify(teacherProof)).toBe('\u00a0')
      expect(r.getAttribute('aria-hidden')).toBe('true')
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

  it('the info line\'s facts and type are unchanged; a teacher\'s is top-aligned (no mt-auto, no top padding), every other card\'s byte-for-byte', () => {
    for (const [patch, cls] of [[{}, TEACHER_INFO_CLASS], [{ teacherProof: ['tefl'] }, TEACHER_INFO_CLASS], [PRODUCT, INFO_CLASS]] as const) {
      const { body } = parts(card(patch))
      expect(infoOf(body).className).toBe(cls)
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

  it('⛔ a rental or a product carrying a stray teacherProof draws no proof line and no reserve', () => {
    for (const patch of [RENTAL, PRODUCT]) {
      const c = card({ ...patch, teacherProof: ['celta', '5-10-years'] })
      expect(proofOf(c)).toHaveLength(0)
      expect(reserveOf(c)).toHaveLength(0)
      expect(c.textContent).not.toContain('CELTA')
      cleanup()
    }
  })
})

describe('ListingCard — ⛔ every other card keeps the 09-13 order', () => {
  it('a rental and a product: the price row leads, then the h3 with TITLE_LINE, at the price role', () => {
    for (const patch of [RENTAL, PRODUCT]) {
      const { body, priceRow, price, h3 } = parts(card(patch))
      expect(body.firstElementChild).toBe(priceRow)
      expect(priceRow.nextElementSibling).toBe(h3)
      expect(body.querySelector('[data-teacher-proof]')).toBeNull()
      expect(precedes(price, h3)).toBe(true)
      expect(h3.className).toBe(TITLE_CLASS)
      expect(h3.parentElement).toBe(body)
      // The price role at every width since 2026-11-14 (card-text.ts CARD_PRICE) — AND the colour class `text-price`, which
      // fab-clearance.ts selects (`[data-card-root] .text-price`): tailwind-merge must keep both (lib/utils.ts theme.text).
      expect(classes(price)).toEqual(expect.arrayContaining(['text-t-price', 'text-price', 'font-bold', 'tabular-nums']))
      expect(classes(price)).not.toContain('text-base')
      expect(classes(price)).not.toContain('sm:text-lg')
      expect(classes(price)).not.toContain('text-sm')
      cleanup()
    }
  })
})
