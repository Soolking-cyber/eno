// @vitest-environment jsdom
/**
 * Two class-level contracts of <Price> that a text assertion cannot see.
 *
 * ⚠️ ONLY A PRICE WEARS THE PRICE INK (docs/design-language.md §3). A price-0 job renders "Salary: see
 * details" — a pointer to the posting, not an amount — so it takes body ink at the semibold tier, while "Free" (which
 * IS the price) keeps the commerce orange. The caller's size must survive either way, or the card's line
 * box and its skeleton move.
 *
 * ⚠️ THE "≈" IS A FIXED STEP, NOT A FRACTION OF THE PRICE. It was `0.8em` — 24px under the PDP's 30px
 * headline — and design-lint now bans relative sizes. 12px by default; `approxClassName` sets a surface's
 * own step, and it can never un-hide the reserved stand-in.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMoney } from '@/lib/currencies'
import { Price } from './price'

const state = vi.hoisted(() => ({ rates: { USD: 1 / 26_000 } as Record<string, number>, ratesPending: false }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: (s: string) => s,
}))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return {
    vndPerUsd: real.vndPerUsd,
    useCurrency: () => ({
      currency: 'VND',
      rates: state.rates,
      ratesPending: state.ratesPending,
      format: (n: number, locale?: 'en' | 'vi') => formatMoney(n, 'VND', state.rates, locale),
    }),
  }
})

afterEach(() => { cleanup(); state.rates = { USD: 1 / 26_000 }; state.ratesPending = false })

const root = (el: React.ReactElement) => render(el).container.firstElementChild as HTMLElement
const approx = (el: React.ReactElement) => render(el).container.querySelector<HTMLElement>('[aria-hidden="true"].ml-1\\.5')!

describe('<Price> ink', () => {
  it('a price-0 job reads "Salary: see details" in body ink (semibold), at the caller\'s size', () => {
    const el = root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" className="text-base leading-tight sm:text-lg" />)
    expect(el.textContent).toBe('Salary: see details')
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['text-body', 'font-semibold', 'text-base', 'sm:text-lg']))
    expect(el.className).not.toMatch(/\btext-price\b/)
    expect(el.className).not.toMatch(/\bfont-bold\b/)
  })

  it('"Free" and every real amount keep the price ink', () => {
    expect(root(<Price native price={0} currency="₫" priceUnit="VND" listingType="sell" />).className).toMatch(/\btext-price\b/)
    cleanup()
    expect(root(<Price native price={250_000} currency="₫" priceUnit="VND" listingType="job" />).className).toMatch(/\btext-price\b/)
  })
})

describe('<Price> "≈" slot', () => {
  it('is 12px (text-xs) by default — no relative size', () => {
    const el = approx(<Price native price={2_600_000} currency="₫" priceUnit="VND" className="text-3xl" />)
    expect(el.textContent).toContain('$100')
    expect(el.className).toMatch(/\btext-xs\b/)
    expect(el.className).not.toMatch(/em\]/)
  })

  it('takes a surface\'s own step through approxClassName', () => {
    const el = approx(<Price native price={2_600_000} currency="₫" priceUnit="VND" approxClassName="text-base" />)
    expect(el.className).toMatch(/\btext-base\b/)
    expect(el.className).not.toMatch(/\btext-xs\b/)
  })

  it('cannot be un-hidden by approxClassName while it holds the invisible stand-in', () => {
    state.rates = {}
    state.ratesPending = true
    const el = approx(<Price native price={2_600_000} currency="₫" priceUnit="VND" approxClassName="visible text-base" />)
    expect(el.className.split(' ')).toContain('invisible')
    expect(el.className.split(' ')).not.toContain('visible')
    expect(el.style.visibility).toBe('hidden')
  })
})

// rentals-09 (2026-10-04): a CARD hands a price-0 job its type · city; every other surface leaves it out.
describe('<Price> jobMeta (card only)', () => {
  it('a string replaces the salary label, in the same body ink', () => {
    const el = root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" jobMeta="Full-time · Hanoi" className="text-base" />)
    expect(el.textContent?.replace(/\s+/g, ' ')).toBe('Full-time · Hanoi')
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['text-body', 'font-semibold', 'text-base']))
    expect(el.className).not.toMatch(/\btext-muted-foreground\b/)
  })

  it('null keeps today\'s label, in muted ink', () => {
    const el = root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked jobMeta={null} />)
    expect(el.textContent).toBe('Salary: see details')
    expect(el.className).toMatch(/\btext-muted-foreground\b/)
    expect(el.className).not.toMatch(/\btext-body\b/)
  })

  it('left out, nothing changes; and it never touches a job with a figure or a teacher profile', () => {
    expect(root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" />).className).not.toMatch(/\btext-muted-foreground\b/)
    cleanup()
    expect(root(<Price native price={250_000} currency="₫" priceUnit="VND" listingType="job" jobMeta="Full-time · Hanoi" />).textContent).toContain('250,000')
    cleanup()
    expect(root(<Price native price={0} currency="₫" priceUnit="VND" listingType="teacher" jobMeta="Full-time" />).textContent).toBe('Teacher profile')
  })
})

// Review fix (2026-10-04): an employer's OWN price-0 job keeps "Salary: negotiable" — the type would drop it.
describe('<Price> jobMeta never replaces "negotiable"', () => {
  it("an employer's own job (linked={false}) keeps its label and its ink, whatever jobMeta holds", () => {
    const el = root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked={false} jobMeta="Full-time · Hanoi" />)
    expect(el.textContent).toBe('Salary: negotiable')
    expect(el.className).toMatch(/\btext-body\b/)
    expect(el.className).not.toMatch(/\btext-muted-foreground\b/)
    cleanup()
    const none = root(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked={false} jobMeta={null} />)
    expect(none.textContent).toBe('Salary: negotiable')
    expect(none.className).not.toMatch(/\btext-muted-foreground\b/)
  })
})

// Review fix (2026-10-04): the support mark's yield opt-in sits on the FIGURE, never the root or the row —
// a root holding a large rent's estimate measured 242–260px, which fab-clearance.ts reads as a bar.
describe('<Price> fabAvoid (card only)', () => {
  it('marks the amount and its unit, not the root and not the "≈ $" estimate', () => {
    const el = root(<Price native fabAvoid price={9_000_000} currency="₫" priceUnit="VND/month" />)
    expect(el.hasAttribute('data-fab-avoid')).toBe(false)
    const marked = el.querySelectorAll('[data-fab-avoid]')
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent?.replace(/\s+/g, ' ')).toBe('9,000,000 đ / month')
    expect(el.textContent).toContain('≈') // the estimate is still there, just outside the mark
  })

  it('marks nothing without the prop, so every other surface renders as before', () => {
    expect(root(<Price native price={9_000_000} currency="₫" priceUnit="VND/month" />).querySelector('[data-fab-avoid]')).toBeNull()
  })

  it("marks a linked job's type · city slot too", () => {
    const el = root(<Price native fabAvoid price={0} currency="₫" priceUnit="VND/month" listingType="job" linked jobMeta="Full-time · Hanoi" />)
    expect(el.querySelector('[data-fab-avoid]')!.textContent?.replace(/\s+/g, ' ')).toBe('Full-time · Hanoi')
  })
})
