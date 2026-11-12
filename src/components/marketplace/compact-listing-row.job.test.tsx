// @vitest-environment jsdom
/**
 * A JOB IN THE LIST VIEW READS LIKE THE JOB CARD (UI climb, 2026-11-10), AND SINCE BATCH 78 IT HAS NO TILE (owner,
 * 2026-11-12: "continue the ui ux improvement towards 10/10"; A/B codex 7.07 → 7.46, Opus 6.60 → 7.15). The row does what
 * the grid card does (listing-card.tsx `jobMeta`): the employer takes the no-pay slot and leaves the title, and the job type
 * ends the phone line. Batch 78 took away the thumbnail the 2026-11-10 cut drew (the employer's initials, or the category
 * glyph; never the poster) — a job row now draws none at all — put the role one step up (`text-base`), the no-pay slot in
 * regular ink-3, and left the slot out for a linked job with neither pay nor employer ("Salary: see posting").
 * Nothing else changes: a paying job keeps its figure and its full title, an employer's own job keeps "Salary: negotiable"
 * (<Price> decides, from `linked`), and every other kind of row keeps its tile and its geometry.
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
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (t: string) => t }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./trust-score', () => ({ TrustScore: () => <span data-trust-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: () => null }))
// The real slot rule lives in <Price> (price.ink-and-approx.test.tsx pins it); here only what the row hands it matters.
vi.mock('./price', () => ({
  Price: ({ price, jobMeta, linked, className }: { price: number; jobMeta?: string | null; linked?: boolean; className?: string }) => (
    <span data-price="" data-job-meta={jobMeta === undefined ? 'unset' : jobMeta === null ? 'null' : jobMeta} data-linked={String(linked)} data-class={className}>{price}</span>
  ),
}))
vi.mock('./category-icons', () => ({ CategoryIcon: () => <span data-category-glyph="" /> }))
vi.mock('@/components/marketplace/eno-slider', () => ({ EnoSlider: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { CompactListingRow } from './compact-listing-row'

const JOB = {
  id: 'j1',
  title: 'Primary PE Teacher — Nord Anglia Education',
  titleVi: null,
  titleI18n: null,
  images: ['https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/job-nordanglia-1-ill-1200x1200.webp'],
  video: null,
  price: 0,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'job',
  jobType: 'fulltime',
  jobEmployer: 'Nord Anglia Education',
  location: 'Hà Nội',
  city: 'Hà Nội',
  district: null,
  condition: null,
  savedCount: 0,
  contactCount: 0,
  negotiable: false,
  isPartnerBooking: true,
  isSponsored: false,
  sellerId: 'linked-jobs',
  seller: { trustScore: 100, isBusiness: true, officialPartner: false },
  category: { icon: 'Briefcase', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
  postedAt: '2026-11-05T00:00:00.000Z',
} as unknown as SerializedListingCard

const row = (patch: Record<string, unknown> = {}) =>
  render(<CompactListingRow listing={{ ...JOB, ...patch } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container

afterEach(cleanup)

/** The thumbnail tile (the square box every non-job row draws). */
const THUMB = '.h-14.w-14'
const rowRoot = (c: HTMLElement) => c.firstElementChild as HTMLElement
/** The meta line: the price slot's line, under the title. */
const metaLine = (c: HTMLElement) => c.querySelector('.min-w-0.flex-1 > div.mt-0\\.5') as HTMLElement
/** The actions cluster, the row's last child. */
const actions = (c: HTMLElement) => rowRoot(c).lastElementChild as HTMLElement

describe('a linked job with no figure', () => {
  it('hands the employer to the price slot and takes it off the title', () => {
    const c = row()
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('Nord Anglia Education')
    expect(c.querySelector('h4')!.textContent).toBe('Primary PE Teacher')
  })

  it('keeps the full title as the name of the link', () => {
    expect(row().querySelector('a[data-row-link]')!.getAttribute('aria-label')).toBe('Primary PE Teacher — Nord Anglia Education')
  })

  it('ends the phone line with the job type', () => {
    const line = row().querySelector('p.sm\\:hidden')!.textContent!
    expect(line.startsWith('Hà Nội · ')).toBe(true)
    expect(line.endsWith(' · Full-time')).toBe(true)
  })

  it('says nothing about a type the posting did not give', () => {
    const line = row({ jobType: null }).querySelector('p.sm\\:hidden')!.textContent!
    expect(line).not.toMatch(/Full-time|Part-time/)
    expect(line.endsWith(' · ')).toBe(false)
  })

  it('draws no thumbnail at all (batch 78): no tile, no initials, no glyph, no poster', () => {
    const c = row()
    expect(c.querySelector(THUMB)).toBeNull()
    expect(c.querySelector('img')).toBeNull()
    expect(c.querySelector('[data-category-glyph]')).toBeNull()
    expect(c.querySelector('[data-job-initials]')).toBeNull()
  })

  it('with no employer stored: NO slot line at all (no "Salary: see posting"), the whole title, still no tile', () => {
    const c = row({ jobEmployer: null, title: 'Design, Engineering, Technology Teacher' })
    expect(c.querySelector('[data-price]')).toBeNull()
    expect(c.querySelector('h4')!.textContent).toBe('Design, Engineering, Technology Teacher')
    expect(c.querySelector(THUMB)).toBeNull()
    expect(c.querySelector('img')).toBeNull()
    expect(c.querySelector('[data-category-glyph]')).toBeNull()
    // The meta line now holds only `sm:` things, so on a phone it leaves (no empty 2px line), and from sm it carries the place
    // with no divider standing beside nothing.
    expect(metaLine(c).className.split(' ')).toContain('max-sm:hidden')
    expect(metaLine(c).querySelector('.w-px')).toBeNull()
    expect(metaLine(c).textContent).toBe('Hà Nội')
    // The phone's place · time · type line is untouched.
    expect(c.querySelector('p.sm\\:hidden')!.textContent!.endsWith(' · Full-time')).toBe(true)
  })

  it('…and an urgent one keeps its line on a phone, for the bolt, with the divider before the place', () => {
    const c = row({ jobEmployer: null, urgent: true })
    expect(c.querySelector('[data-price]')).toBeNull()
    expect(metaLine(c).className.split(' ')).not.toContain('max-sm:hidden')
    expect(metaLine(c).querySelector('[aria-label="Urgent hiring"]')).not.toBeNull()
    expect(metaLine(c).querySelector('.w-px')).not.toBeNull()
  })

  it('the role is the strongest line, one step up: a 16px semibold title on a snug line, a regular ink-3 slot in a 20px box', () => {
    const c = row()
    const h4 = c.querySelector('h4')!.className.split(' ')
    expect(h4).toEqual(expect.arrayContaining(['text-base', 'font-semibold', 'leading-snug']))
    expect(h4).not.toContain('text-sm')
    const slot = c.querySelector('[data-price]')!.getAttribute('data-class')!.split(' ')
    expect(slot).toEqual(expect.arrayContaining(['text-sm', 'leading-5', 'font-normal', 'text-ink-3']))
    expect(slot).not.toContain('leading-6')
  })

  it('12px above and below the text, no side padding on a phone, the actions level with the first title line', () => {
    const c = row()
    const root = rowRoot(c).className.split(' ')
    expect(root).toEqual(expect.arrayContaining(['items-start', 'gap-2', 'py-3', 'sm:pl-1.5', 'sm:pr-1']))
    expect(root).not.toContain('p-1.5')
    expect(root).not.toContain('items-center')
    // No card: the row is a hover fill at most, never a bordered box (the list draws the hairline, JOB_ROWS_RULED).
    expect(root.some((k) => /^border/.test(k))).toBe(false)
    expect(actions(c).className.split(' ')).toContain('-mt-1.5')
  })

  it('gives the title the phone width of the chat button it never has', () => {
    const slots = [...row().querySelectorAll('span[aria-hidden]')].filter((e) => e.className.includes('h-9 w-9'))
    // The offer placeholder (sm only) and the chat placeholder: on a phone neither takes width on a linked job's row.
    expect(slots.length).toBe(2)
    expect(slots.every((e) => /(^|\s)hidden(\s|$)/.test(e.className) && e.className.includes('sm:block'))).toBe(true)
  })

  it('keeps that slot when a chip hangs off the title line (a partner, a sponsored row)', () => {
    for (const patch of [{ seller: { trustScore: 100, isBusiness: true, officialPartner: true } }, { isSponsored: true }]) {
      const chat = [...row(patch).querySelectorAll('span[aria-hidden]')].filter((e) => e.className.includes('h-9 w-9')).pop()!
      expect(chat.className).toContain('block')
      expect(/(^|\s)hidden(\s|$)/.test(chat.className)).toBe(false)
    }
  })
})

describe('a row whose payload carries no linked flag', () => {
  // One meaning of "linked" in the row: the flag (commit review). Without it nothing of the LINKED treatment applies,
  // and the chat button, which has always followed the flag, agrees with the rest of the row. What stays is what every
  // job row gets: the type on the phone line and the role as the strongest line.
  it('gets none of the linked treatment, employer stored or not', () => {
    for (const jobEmployer of ['Nord Anglia Education', null]) {
      const c = row({ isPartnerBooking: undefined, jobEmployer })
      expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
      expect(c.querySelector('h4')!.textContent).toBe('Primary PE Teacher — Nord Anglia Education')
      expect(c.querySelector('[data-price]')).not.toBeNull()
      expect(c.querySelector('[aria-label="Chat with seller"]')).not.toBeNull()
      // The job-wide part still applies: no tile (batch 78), the role up a step, the type on the phone line.
      expect(c.querySelector(THUMB)).toBeNull()
      expect(c.querySelector('img')).toBeNull()
      expect(c.querySelector('h4')!.className).toContain('font-semibold')
      expect(c.querySelector('h4')!.className).toContain('text-base')
      expect(c.querySelector('p.sm\\:hidden')!.textContent!.endsWith(' · Full-time')).toBe(true)
      cleanup()
    }
  })
})

describe('the chat slot follows the same flag', () => {
  it('a linked job has no chat button; an employer\'s own job has one', () => {
    expect(row().querySelector('[aria-label="Chat with seller"]')).toBeNull()
    cleanup()
    expect(row({ isPartnerBooking: false, jobEmployer: null }).querySelector('[aria-label="Chat with seller"]')).not.toBeNull()
  })
})

describe('what the job rule must not touch', () => {
  it('a paying linked job keeps its figure (bold price ink, at the slot\'s size) and its whole title', () => {
    const c = row({ price: 80_000_000, title: 'Chemistry teacher — Nguyen Sieu School', jobEmployer: 'Nguyen Sieu School' })
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    const slot = c.querySelector('[data-price]')!.getAttribute('data-class')!.split(' ')
    expect(slot).toEqual(expect.arrayContaining(['text-sm', 'leading-5']))
    expect(slot).not.toContain('font-normal')
    expect(slot).not.toContain('text-ink-3')
    expect(c.querySelector('h4')!.textContent).toBe('Chemistry teacher — Nguyen Sieu School')
    expect(c.querySelector(THUMB)).toBeNull()
  })

  it("an employer's own job: no employer slot, its \"Salary: negotiable\" slot kept (ink-3), and no tile, its photo included", () => {
    const c = row({ isPartnerBooking: false, jobEmployer: null, title: 'Barista wanted', images: ['https://picsum.photos/seed/b/400'] })
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    expect(c.querySelector('[data-price]')!.getAttribute('data-linked')).toBe('false')
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')!.split(' ')).toContain('text-ink-3')
    expect(c.querySelector(THUMB)).toBeNull()
    expect(c.querySelector('img')).toBeNull()
  })

  it('a row that is not a job: title, slot and photo exactly as before', () => {
    const c = row({ listingType: 'sell', title: 'Laptop — Nord Anglia Education', price: 12_000_000, priceUnit: 'VND', category: { icon: 'phone', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } })
    expect(c.querySelector('h4')!.textContent).toBe('Laptop — Nord Anglia Education')
    // tailwind-merge keeps the snug leading only when it follows the size (the ⚠️ on the h4): pinned for both kinds.
    expect(c.querySelector('h4')!.className.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'leading-snug', 'font-medium']))
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')).toBe('text-base sm:shrink-0')
    expect(c.querySelector('img')).not.toBeNull()
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    expect(c.querySelector('p.sm\\:hidden')!.textContent).not.toMatch(/Full-time/)
  })

  // Batch 78 is a JOB change: every other kind of row keeps its square tile and its geometry, photo or glyph.
  const KINDS: [string, Record<string, unknown>][] = [
    ['a rental', { listingType: 'rent', title: '2BR apartment, District 2', price: 15_000_000, isPartnerBooking: false, category: { icon: 'home', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' } }],
    ['goods', { listingType: 'sell', title: 'Road bike', price: 4_000_000, priceUnit: 'VND', isPartnerBooking: false, category: { icon: 'bike', slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe' } }],
    ['a teacher', { listingType: 'teacher', title: 'Nguyễn Thị Minh Khai', price: 0, priceUnit: 'VND/hour', isPartnerBooking: false, category: { icon: 'GraduationCap', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' } }],
  ]
  for (const [kind, patch] of KINDS) {
    it(`${kind} keeps its 56px square tile, its photo in it, and the row's old geometry`, () => {
      const c = row(patch)
      const tile = c.querySelector(THUMB)!
      expect(tile).not.toBeNull()
      expect(tile.className.split(' ')).toEqual(expect.arrayContaining(['h-14', 'w-14', 'shrink-0', 'rounded-lg', 'bg-tint']))
      expect(tile.querySelector('img')).not.toBeNull()
      const root = rowRoot(c).className.split(' ')
      expect(root).toEqual(expect.arrayContaining(['items-center', 'gap-3', 'p-1.5', 'pr-1', 'rounded-xl']))
      expect(root).not.toContain('py-3')
      expect(actions(c).className.split(' ')).not.toContain('-mt-1.5')
      expect(c.querySelector('[data-price]')).not.toBeNull()
      cleanup()
      // …and with no photo, the category glyph in the same tile.
      const bare = row({ ...patch, images: [] })
      expect(bare.querySelector(THUMB)!.querySelector('[data-category-glyph]')).not.toBeNull()
      cleanup()
    })
  }
})
