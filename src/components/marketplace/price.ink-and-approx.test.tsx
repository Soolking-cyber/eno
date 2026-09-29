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
