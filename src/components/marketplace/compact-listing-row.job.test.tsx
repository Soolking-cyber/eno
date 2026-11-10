// @vitest-environment jsdom
/**
 * A JOB IN THE LIST VIEW READS LIKE THE JOB CARD (UI climb, 2026-11-10). Until now a linked job's row said "Salary: see
 * posting" in its bold slot, carried the employer at the end of a two-line title, and drew the importer's poster at 56px.
 * The row now does what the grid card does (listing-card.tsx `jobMeta`): the employer takes the no-pay slot and leaves the
 * title, the job type ends the phone line, and the thumbnail is the employer's initials. Nothing else changes: a paying
 * job keeps its figure and its full title, an employer's own job keeps "Salary: negotiable" (<Price> decides, from
 * `linked`), and no other kind of row is touched.
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

import { CompactListingRow, employerInitials } from './compact-listing-row'

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

  it('draws the employer initials, not the 56px poster', () => {
    const c = row()
    expect(c.querySelector('[data-job-initials]')!.textContent).toBe('NA')
    expect(c.querySelector('img')).toBeNull()
  })

  it('with no employer stored: the neutral slot, the whole title, and the category glyph (one fallback, never the poster)', () => {
    const c = row({ jobEmployer: null, title: 'Design, Engineering, Technology Teacher' })
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('null')
    expect(c.querySelector('h4')!.textContent).toBe('Design, Engineering, Technology Teacher')
    expect(c.querySelector('[data-job-initials]')).toBeNull()
    expect(c.querySelector('img')).toBeNull()
    expect(c.querySelector('[data-category-glyph]')).not.toBeNull()
  })

  it('the role is the strongest line: a semibold title, a quiet regular slot at the title\'s size, in the 24px line box', () => {
    const c = row()
    expect(c.querySelector('h4')!.className).toContain('font-semibold')
    const slot = c.querySelector('[data-price]')!.getAttribute('data-class')!
    expect(slot).toContain('text-sm')
    expect(slot).toContain('leading-6')
    expect(slot).toContain('font-normal')
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
      expect(c.querySelector('[data-job-initials]')).toBeNull()
      expect(c.querySelector('img')).not.toBeNull()
      expect(c.querySelector('[aria-label="Chat with seller"]')).not.toBeNull()
      // The job-wide part still applies.
      expect(c.querySelector('h4')!.className).toContain('font-semibold')
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
  it('a paying linked job keeps its figure (bold, at the title\'s size) and its whole title', () => {
    const c = row({ price: 80_000_000, title: 'Chemistry teacher — Nguyen Sieu School', jobEmployer: 'Nguyen Sieu School' })
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')).toContain('text-sm')
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')).not.toContain('font-normal')
    expect(c.querySelector('h4')!.textContent).toBe('Chemistry teacher — Nguyen Sieu School')
    // Still a linked job: its only image is the poster, so the initials stand in for it here too.
    expect(c.querySelector('[data-job-initials]')!.textContent).toBe('NS')
  })

  it("an employer's own job: no employer slot, its own photo", () => {
    const c = row({ isPartnerBooking: false, jobEmployer: null, title: 'Barista wanted', images: ['https://picsum.photos/seed/b/400'] })
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    expect(c.querySelector('[data-price]')!.getAttribute('data-linked')).toBe('false')
    expect(c.querySelector('[data-job-initials]')).toBeNull()
    expect(c.querySelector('img')).not.toBeNull()
  })

  it('a row that is not a job: title, slot and photo exactly as before', () => {
    const c = row({ listingType: 'sell', title: 'Laptop — Nord Anglia Education', price: 12_000_000, priceUnit: 'VND', category: { icon: 'phone', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } })
    expect(c.querySelector('h4')!.textContent).toBe('Laptop — Nord Anglia Education')
    expect(c.querySelector('h4')!.className).toContain('font-medium')
    expect(c.querySelector('[data-price]')!.getAttribute('data-class')).toBe('text-base sm:shrink-0')
    expect(c.querySelector('img')).not.toBeNull()
    expect(c.querySelector('[data-price]')!.getAttribute('data-job-meta')).toBe('unset')
    expect(c.querySelector('[data-job-initials]')).toBeNull()
    expect(c.querySelector('p.sm\\:hidden')!.textContent).not.toMatch(/Full-time/)
  })
})

describe('employerInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(employerInitials('Nord Anglia Education')).toBe('NA')
    expect(employerInitials('RMIT University Vietnam LLC')).toBe('RU')
    expect(employerInitials('Scotch AGS')).toBe('SA')
    expect(employerInitials('VUS')).toBe('V')
  })

  it('reads Vietnamese names as letters, in capitals', () => {
    expect(employerInitials('Trường Quốc tế Việt Úc')).toBe('TQ')
    expect(employerInitials('đại học Hoa Sen')).toBe('ĐH')
  })

  it('never starts on punctuation', () => {
    expect(employerInitials('(VUS) English Centre')).toBe('VE')
    expect(employerInitials('ILA – Vietnam')).toBe('IV')
    expect(employerInitials('E-Home & Co.')).toBe('EH')
  })

  it('reads through quotes and brackets to the first letter (commit review)', () => {
    expect(employerInitials('“Nord Anglia Education”')).toBe('NA')
    expect(employerInitials('"VUS"')).toBe('V')
    expect(employerInitials("'ILA' Vietnam")).toBe('IV')
    expect(employerInitials('[APAX] «Leaders»')).toBe('AL')
  })

  it('never lets the browser locale pick the capital', () => {
    const spy = vi.spyOn(String.prototype, 'toLocaleUpperCase')
    expect(employerInitials('ila english')).toBe('IE')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('is null when there is nothing to draw', () => {
    expect(employerInitials(null)).toBeNull()
    expect(employerInitials('')).toBeNull()
    expect(employerInitials('—')).toBeNull()
  })
})
