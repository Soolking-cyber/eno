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
import { RATE_COMPACT_VND } from '@/lib/vnd'
import { Price } from './price'

const state = vi.hoisted(() => ({ currency: 'VND', rates: {} as Record<string, number>, lang: 'en' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: state.lang, tr: (en: string, viText?: string) => (state.lang === 'vi' && viText ? viText : en) }),
  // The unit as the real useTr prints it in Vietnamese — the curated "month" → "tháng" (vi-overrides.ts).
  useTr: (s: string) => (state.lang === 'vi' && s === 'month' ? 'tháng' : s),
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

afterEach(() => { cleanup(); state.currency = 'VND'; state.rates = {}; state.lang = 'en' })

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

/**
 * A CARD'S PER-UNIT PRICE IN MILLIONS (owner, 2026-10-18): the card hands `compactAbove={RATE_COMPACT_VND}` for a
 * rent, a hire or a monthly salary (vnd.ts cardCompactAbove), so "8,500,000 đ / month ≈ $332" — two lines on every
 * phone — becomes "8.5M đ / month ≈ $332". The đồng figure still leads (with its mark in English; Vietnamese drops
 * it after "triệu" — the block below), the unit and the "≈ $" stay, and a figure that is not a whole thousand is
 * marked approximate, never stated as exact.
 */
describe('<Price native compact compactAbove={RATE_COMPACT_VND}>', () => {
  it('reads a rent in millions — đồng first, the unit and the "≈ $" kept', () => {
    state.rates = { USD: 1 / 25_600 }
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} price={8_500_000} currency="₫" priceUnit="VND/month" />)).toBe('8.5M đ / month≈ $332')
  })
  it('marks a figure that is not a whole thousand as approximate', () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={8_555_500} currency="₫" priceUnit="VND/month" />)).toBe('≈ 8.556M đ / month')
  })
  it("the struck was-price as the card renders it (listing-card.tsx: the card's one threshold, no unit) reads in the same millions", () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={9_500_000} currency="₫" priceUnit="VND" />)).toBe('9.5M đ')
  })
  it('keeps every digit under a million, and the default threshold still starts at 10 tỷ', () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={950_000} currency="₫" priceUnit="VND/month" />)).toBe('950,000 đ / month')
    cleanup()
    expect(text(<Price native compact dual={false} price={8_500_000} currency="₫" priceUnit="VND/month" />)).toBe('8,500,000 đ / month')
  })
  it('a tỷ and up under the same threshold is the tỷ words, unchanged', () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={1_200_000_000} currency="₫" priceUnit="VND/month" />)).toBe('1.2 billion đ / month')
  })
})

/**
 * VIETNAMESE CARD RENTS PRINT NO "đ" AFTER "triệu" (owner, 2026-10-18: "go on apply all recommended" — Chợ Tốt's
 * "8,5 triệu/tháng"). "8,5 triệu đ / tháng ≈ $332" pushed the estimate onto a second line on a 390px phone;
 * "8,5 triệu / tháng ≈ $332" fits (the measurements are in vnd.ts RATE_COMPACT_VND). That form only: the tỷ words,
 * the full figure, English and the MT languages keep their mark.
 */
describe('<Price native compact compactAbove={RATE_COMPACT_VND}> in Vietnamese', () => {
  const cardPrice = (price: number, priceUnit = 'VND/month', dual = false) => (
    <Price native compact compactAbove={RATE_COMPACT_VND} dual={dual} price={price} currency="₫" priceUnit={priceUnit} />
  )

  it('reads a rent "8,5 triệu / tháng" — no mark after "triệu" — with the "≈ $" kept', () => {
    state.lang = 'vi'
    state.rates = { USD: 1 / 25_600 }
    expect(text(cardPrice(8_500_000, 'VND/month', true))).toBe('8,5 triệu / tháng≈ $332')
  })
  it('rounds an odd figure to the thousand and marks it "≈" — still no mark', () => {
    state.lang = 'vi'
    expect(text(cardPrice(8_499_600))).toBe('≈ 8,5 triệu / tháng')
  })
  it('the struck was-price as the card renders it (the same threshold, no unit) reads in the same millions', () => {
    state.lang = 'vi'
    expect(text(cardPrice(9_500_000, 'VND'))).toBe('9,5 triệu')
  })
  it('a tỷ and up keeps "tỷ đ"; under a million, and on the PDP, every digit keeps its mark', () => {
    state.lang = 'vi'
    expect(text(cardPrice(1_200_000_000))).toBe('1,2 tỷ đ / tháng')
    cleanup()
    expect(text(cardPrice(950_000))).toBe('950.000 đ / tháng')
    cleanup()
    expect(text(<Price native dual={false} price={8_500_000} currency="₫" priceUnit="VND/month" />)).toBe('8.500.000 đ / tháng')
  })
  it('English keeps "8.5M đ", and an MT language its own scale with the mark', () => {
    expect(text(cardPrice(8_500_000))).toBe('8.5M đ / month')
    cleanup()
    state.lang = 'zh-Hans'
    expect(text(cardPrice(8_500_000))).toBe('850万 đ / month')
  })
  it('assistive tech gets the figure as printed — no label over it, the estimate hidden', () => {
    state.lang = 'vi'
    state.rates = { USD: 1 / 25_600 }
    const { container } = render(cardPrice(8_500_000, 'VND/month', true))
    const exposed = container.cloneNode(true) as HTMLElement
    exposed.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
    expect(exposed.textContent?.replace(/\s+/g, ' ').trim()).toBe('8,5 triệu / tháng')
    expect(container.querySelector('[aria-label]')).toBeNull()
  })
})
