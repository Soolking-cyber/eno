// @vitest-environment jsdom
/**
 * ⛔ "SALARY: SEE POSTING" IS GONE FROM THE LIST ROW, AND ONLY THERE (batch 78, owner 2026-11-12: "continue the ui ux
 * improvement towards 10/10"; A/B codex 7.07 → 7.46, Opus 6.60 → 7.15). A linked job that states neither pay nor employer
 * printed it on every such row, a line that told a list reader nothing. Through the REAL <Price>, so it is the words that
 * are pinned: the row leaves that one line out; a real salary, an employer's name and an employer's own "Salary:
 * negotiable" (price.tsx's ⛔ `jobMeta` rule) all stay; and <Price> itself still says "Salary: see posting" wherever else it
 * is asked (the job page's own "Salary: see the original posting" is another component and untouched).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { formatMoney } from '@/lib/currencies'

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
  useTr: (s: string) => s,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  const rates = { USD: 1 / 26_000 }
  return {
    vndPerUsd: real.vndPerUsd,
    useCurrency: () => ({ currency: 'VND', rates, ratesPending: false, format: (n: number, locale?: 'en' | 'vi') => formatMoney(n, 'VND', rates, locale) }),
  }
})
vi.mock('./listing-content', () => ({ useLocalized: (t: string) => t }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: () => null }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => <span data-category-glyph="" /> }))
vi.mock('@/components/marketplace/eno-slider', () => ({ EnoSlider: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

import { CompactListingRow } from './compact-listing-row'
import { Price } from './price'

const JOB = {
  id: 'j1',
  title: 'Design, Engineering, Technology Teacher',
  titleVi: null,
  titleI18n: null,
  images: ['https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/job-1-ill-1200x1200.webp'],
  video: null,
  price: 0,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'job',
  jobType: 'fulltime',
  jobEmployer: null,
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

const text = (patch: Record<string, unknown> = {}) =>
  render(<CompactListingRow listing={{ ...JOB, ...patch } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />)
    .container.textContent!.replace(/\s+/g, ' ')

afterEach(cleanup)

describe('the job row\'s slot line, through the real <Price>', () => {
  it('a linked job with no pay and no employer: no "Salary: see posting", nor any other salary words', () => {
    const t = text()
    expect(t).not.toMatch(/Salary/)
    // The rest of the row is all there: the role, and the phone's place · time · type line.
    expect(t).toContain('Design, Engineering, Technology Teacher')
    expect(t).toContain('Full-time')
  })

  it('a linked job with an employer and no pay: the employer, not the salary words', () => {
    const t = text({ jobEmployer: 'Nord Anglia Education', title: 'Primary PE Teacher — Nord Anglia Education' })
    expect(t).toContain('Nord Anglia Education')
    expect(t).not.toMatch(/Salary/)
  })

  it('a real salary stays, in the price ink', () => {
    const c = render(<CompactListingRow listing={{ ...JOB, price: 25_000_000 } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container
    const figure = c.querySelector('.text-price')!
    expect(figure).not.toBeNull()
    expect(figure.textContent).toMatch(/25/)
  })

  it('an employer\'s own job at 0 keeps "Salary: negotiable" (price.tsx\'s ⛔ rule), employer stored or not', () => {
    expect(text({ isPartnerBooking: false })).toContain('Salary: negotiable')
    cleanup()
    expect(text({ isPartnerBooking: false, jobEmployer: 'Highlands Coffee' })).toContain('Salary: negotiable')
  })

  it('a payload with no linked flag keeps <Price>\'s neutral "Salary: see details" (one meaning of "linked": the flag)', () => {
    expect(text({ isPartnerBooking: undefined })).toContain('Salary: see details')
  })

  it('<Price> itself still says "Salary: see posting": only the row leaves it out', () => {
    const c = render(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked jobMeta={null} />).container
    expect(c.textContent).toBe('Salary: see posting')
  })
})
