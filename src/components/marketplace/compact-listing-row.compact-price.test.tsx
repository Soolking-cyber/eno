// @vitest-environment jsdom
/**
 * THE LIST ROW PRINTS THE CARD'S PRICE FORM (UI climb batch 94; owner-approved 2026-11-14, decision 4 — the approved mock
 * rewrote /c/jobs rows to "80M đ / month" too). The row hands <Price> `cardCompactAbove(listing)`, so a whole-thousand sale
 * price, a rent and a salary of a million or more read in millions; under a million every digit stays. Through the REAL
 * <Price>, so it is the printed words that are pinned. The unit, dual="sm" and the row's 16px are unchanged.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { formatMoney } from '@/lib/currencies'

const state = vi.hoisted(() => ({ lang: 'en' }))

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
  useLanguage: () => ({ lang: state.lang, t: (k: string) => k, tr: (en: string, viText?: string) => (state.lang === 'vi' && viText ? viText : en) }),
  useTr: (s: string) => (state.lang === 'vi' && s === 'month' ? 'tháng' : s),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  const rates = { USD: 1 / 25_600 }
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

const SALE = {
  id: 's1',
  title: 'iPhone 15 Pro 256GB',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 12_800_000,
  prevPrice: null,
  currency: '₫',
  priceUnit: 'VND',
  listingType: 'sell',
  location: 'Hồ Chí Minh',
  city: 'Hồ Chí Minh',
  district: null,
  condition: 'used',
  savedCount: 0,
  contactCount: 0,
  negotiable: true,
  isPartnerBooking: false,
  isSponsored: false,
  sellerId: 'member-seller-1',
  seller: { trustScore: 100, isBusiness: false, officialPartner: false },
  category: { icon: 'Smartphone', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  postedAt: '2026-11-05T00:00:00.000Z',
} as unknown as SerializedListingCard

const RENT = { ...SALE, id: 'r1', title: 'Studio Quận 3', price: 8_500_000, priceUnit: 'VND/month', listingType: 'rent', condition: null, category: { icon: 'Home', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' } }

/** The row's price, as a sighted reader sees it: the sr-only full figure removed. */
const priceSeen = (patch: Record<string, unknown> = {}) => {
  const c = render(<CompactListingRow listing={{ ...SALE, ...patch } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container
  const p = c.querySelector('.text-price')!.cloneNode(true) as HTMLElement
  p.querySelectorAll('.sr-only').forEach((n) => n.remove())
  // The 'sm'-only "≈ $" is a CSS hide; jsdom keeps the text, so read the figure before it.
  p.querySelectorAll('.whitespace-nowrap.text-xs').forEach((n) => n.remove())
  return p.textContent!.replace(/\s+/g, ' ').trim()
}

afterEach(() => { cleanup(); state.lang = 'en' })

describe('the list row reads the card\'s price form (batch 94)', () => {
  it('a whole-thousand sale price of a million or more: "12.8M đ", every digit spoken', () => {
    expect(priceSeen()).toBe('12.8M đ')
    cleanup()
    const c = render(<CompactListingRow listing={SALE} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container
    expect(c.querySelector('.text-price .sr-only')?.textContent).toBe('12,800,000 đ')
  })
  it('a rent of a million or more: "8.5M đ / month" in English, "8,5 triệu / tháng" in Vietnamese', () => {
    expect(priceSeen(RENT)).toBe('8.5M đ / month')
    cleanup()
    state.lang = 'vi'
    expect(priceSeen(RENT)).toBe('8,5 triệu / tháng')
  })
  it('under a million, or not a whole thousand, every digit stays', () => {
    expect(priceSeen({ price: 950_000 })).toBe('950,000 đ')
    cleanup()
    expect(priceSeen({ price: 12_345_678 })).toBe('12,345,678 đ')
  })
})
