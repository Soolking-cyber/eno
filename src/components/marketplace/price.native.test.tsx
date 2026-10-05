// @vitest-environment jsdom
/**
 * `<Price native>` — the scan-surface price (feed cards, rows, map popups; owner, 2026-09-13).
 *
 * ⚠️ THE ĐỒNG AMOUNT ALWAYS LEADS AND THE "≈ $" ALWAYS FOLLOWS. The owner asked for the dollar
 * approximation back after a first cut dropped it ("approximate price in usd disappeared add it back
 * after d price"), so each case pins one state: the default đồng viewer ("đ ≈ $"), a viewer who picked
 * USD (still "đ ≈ $", never the dollar alone — ND 340/2025 — and never the đồng figure twice), an
 * unusable rate (one figure, never a dangling "≈"), and the unit suffixes.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMoney } from '@/lib/currencies'
import { Price } from './price'

const state = vi.hoisted(() => ({ currency: 'VND', rates: {} as Record<string, number> }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: (s: string) => s,
}))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return {
    vndPerUsd: real.vndPerUsd,
    useCurrency: () => ({
      currency: state.currency,
      rates: state.rates,
      ratesPending: false,
      format: (n: number, locale?: 'en' | 'vi') => formatMoney(n, state.currency, state.rates, locale),
    }),
  }
})

afterEach(() => { cleanup(); state.currency = 'VND'; state.rates = {} })

const text = (el: React.ReactElement) => render(el).container.textContent?.replace(/\s+/g, ' ').trim()

describe('<Price native>', () => {
  it('shows the đồng amount then the USD approximation for the default viewer', () => {
    state.rates = { USD: 1 / 26_000 }
    expect(text(<Price native price={2_600_000} currency="₫" priceUnit="VND" />)).toBe('2,600,000 đ≈ $100') // the gap is the span's ml-1.5 margin
  })

  it('a viewer who picked USD still gets đồng first, and the đồng figure only once', () => {
    state.currency = 'USD'
    state.rates = { USD: 1 / 26_000 }
    const t = text(<Price native price={2_600_000} currency="₫" priceUnit="VND" />)!
    expect(t).toBe('2,600,000 đ≈ $100')
    expect(t.indexOf('đ')).toBeLessThan(t.indexOf('$'))
    expect(t.split('đ').length - 1).toBe(1)
  })

  it('draws no second figure when the rate is unusable', () => {
    state.rates = { USD: 26_000 } // un-inverted — the plausibility band must refuse it
    expect(text(<Price native price={2_600_000} currency="₫" priceUnit="VND" />)).toBe('2,600,000 đ')
    cleanup()
    state.rates = {}
    expect(text(<Price native price={2_600_000} currency="₫" priceUnit="VND" />)).toBe('2,600,000 đ')
  })

  it('keeps the unit suffix — "/ month" is the difference between a rent and a sale', () => {
    expect(text(<Price native dual={false} price={15_000_000} currency="₫" priceUnit="VND/month" />)).toBe('15,000,000 đ / month')
  })

  it('prints the hour, day and week a human rental is now stamped with (A5, 2026-10-04), card and detail alike', () => {
    expect(text(<Price native dual={false} price={60_000} currency="₫" priceUnit="VND/hour" />)).toBe('60,000 đ / hour')
    cleanup()
    expect(text(<Price native dual={false} price={150_000} currency="₫" priceUnit="VND/day" />)).toBe('150,000 đ / day')
    cleanup()
    expect(text(<Price native dual={false} price={900_000} currency="₫" priceUnit="VND/week" />)).toBe('900,000 đ / week')
    cleanup()
    expect(text(<Price price={900_000} currency="₫" priceUnit="VND/week" dual={false} />)).toBe('900,000 đ / week')
  })

  it('never shows "/ service" (owner, 2026-09-13) — on native or detail prices', () => {
    expect(text(<Price native dual={false} price={3_030_000} currency="₫" priceUnit="VND/service" />)).toBe('3,030,000 đ')
    cleanup()
    expect(text(<Price price={3_030_000} currency="₫" priceUnit="VND/service" dual={false} />)).toBe('3,030,000 đ')
  })
})

/**
 * `compact` (break-ui, 2026-10-05): a narrow surface reads 10 billion đồng and up in words — only a whole number
 * of millions (never a rounded amount), only while the figure shown is đồng — and "≈ $0" is never drawn.
 */
describe('<Price native compact>', () => {
  it('reads a huge whole-million price in words, with the đồng mark once', () => {
    state.rates = { USD: 1 / 26_000 }
    const t = text(<Price native compact price={95_000_000_000} currency="₫" priceUnit="VND" />)!
    expect(t.startsWith('95 billion đ')).toBe(true)
    expect(t.split('đ').length - 1).toBe(1)
  })
  it('keeps every digit below the threshold', () => {
    expect(text(<Price native compact price={9_990_000_000} currency="₫" priceUnit="VND" />)).toBe('9,990,000,000 đ')
  })
  it('marks an amount that is not a whole number of millions as approximate, never as exact', () => {
    expect(text(<Price native compact price={10_000_500_000} currency="₫" priceUnit="VND" />)).toBe('≈ 10.001 billion đ')
  })
  it('a shared threshold lets the drop pair read alike', () => {
    expect(text(<Price native compact compactAbove={1_000_000_000} price={9_990_000_000} currency="₫" priceUnit="VND" />)).toBe('9.99 billion đ')
  })
  it('without `compact` (the PDP) every digit stays', () => {
    expect(text(<Price native price={95_000_000_000} currency="₫" priceUnit="VND" />)).toBe('95,000,000,000 đ')
  })
  it('never draws "≈ $0" for a one-đồng "contact me" price', () => {
    state.rates = { USD: 1 / 26_000 }
    expect(text(<Price native price={1} currency="₫" priceUnit="VND" />)).toBe('1 đ')
  })
})
