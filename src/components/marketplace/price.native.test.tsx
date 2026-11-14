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
import { cardCompactAbove, rateCompactAbove, RATE_COMPACT_VND } from '@/lib/vnd'
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

/** What a sighted reader sees: the sr-only run (batch 94's full figure, batch 81's long unit) removed. */
const text = (el: React.ReactElement) => {
  const c = render(el).container.cloneNode(true) as HTMLElement
  c.querySelectorAll('.sr-only').forEach((n) => n.remove())
  return c.textContent?.replace(/\s+/g, ' ').trim()
}
/** What assistive tech reads: aria-hidden runs removed. */
const heard = (el: React.ReactElement) => {
  const c = render(el).container.cloneNode(true) as HTMLElement
  c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
  return c.textContent?.replace(/\s+/g, ' ').trim()
}

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

/**
 * A CARD'S SALE PRICE IN MILLIONS (UI climb batch 94; owner-approved 2026-11-14, decision 4: "12.8M đ ≈ $499"). The card hands
 * `cardCompactAbove(listing)` — RATE_COMPACT_VND for a whole-thousand sale price of a million or more — so the đồng figure
 * still leads, the "≈ $" stays, and English and the MT languages speak every digit from an sr-only run while Vietnamese
 * hears "12,8 triệu" as printed. The listing page's sticky bar hands `rateCompactAbove`: its sale price keeps every digit
 * and its DOM gains no sr-only run.
 */
describe('a card\'s sale price in millions (batch 94)', () => {
  const sale = (price: number, priceUnit = 'VND', dual = false) => (
    <Price native compact compactAbove={cardCompactAbove({ price, priceUnit })} dual={dual} price={price} currency="₫" priceUnit={priceUnit} />
  )
  const bar = (price: number, priceUnit = 'VND') => (
    <Price compact compactAbove={rateCompactAbove({ price, priceUnit })} dual="sm" price={price} currency="₫" priceUnit={priceUnit} className="text-lg leading-6" />
  )

  it('English: "12.8M đ ≈ $500", up to three decimals, every digit under a million', () => {
    state.rates = { USD: 1 / 25_600 }
    expect(text(sale(12_800_000, 'VND', true))).toBe('12.8M đ≈ $500')
    cleanup()
    expect(text(sale(1_190_000))).toBe('1.19M đ')
    cleanup()
    expect(text(sale(4_049_000))).toBe('4.049M đ')
    cleanup()
    expect(text(sale(1_000_000))).toBe('1M đ')
    cleanup()
    expect(text(sale(950_000))).toBe('950,000 đ')
    cleanup()
    expect(text(sale(3_030_000, 'VND/service'))).toBe('3.03M đ')
    cleanup()
    expect(text(sale(12_345_678))).toBe('12,345,678 đ') // not a whole thousand: never rounded
  })
  it('English: a screen reader hears every digit, once, with the "≈ $" still hidden', () => {
    state.rates = { USD: 1 / 25_600 }
    expect(heard(sale(12_800_000, 'VND', true))).toBe('12,800,000 đ')
    cleanup()
    const { container } = render(sale(12_800_000))
    expect(container.querySelector('.sr-only')?.textContent).toBe('12,800,000 đ')
    expect(container.querySelector('[aria-label]')).toBeNull()
    // The figure's runs keep their nowrap spans: "12.8M" and "đ", each with its aria-hidden text inside.
    const runs = [...container.querySelectorAll('span.whitespace-nowrap')]
    expect(runs.map((r) => r.textContent)).toEqual(['12.8M', 'đ'])
    for (const r of runs) expect(r.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
  it('English rent card: the visible text is unchanged and a screen reader hears the full figure and unit', () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={8_500_000} currency="₫" priceUnit="VND/month" />)).toBe('8.5M đ / month')
    cleanup()
    expect(heard(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={8_500_000} currency="₫" priceUnit="VND/month" />)).toBe('8,500,000 đ / month')
    cleanup()
    // An odd rent is "≈" on screen; the screen reader hears the exact stored amount, never the rounded one.
    expect(heard(<Price native compact compactAbove={RATE_COMPACT_VND} dual={false} price={8_555_500} currency="₫" priceUnit="VND/month" />)).toBe('8,555,500 đ / month')
  })
  it('the tỷ words are words already: no sr-only run', () => {
    const { container } = render(sale(1_200_000_000))
    expect(container.querySelector('.sr-only')).toBeNull()
    expect(container.textContent).toBe('1.2 billion đ')
  })
  it('Vietnamese: "12,8 triệu ≈ $500" with no "đ", every digit under a million, "tỷ đ" kept; heard as printed', () => {
    state.lang = 'vi'
    state.rates = { USD: 1 / 25_600 }
    expect(text(sale(12_800_000, 'VND', true))).toBe('12,8 triệu≈ $500')
    cleanup()
    expect(heard(sale(12_800_000, 'VND', true))).toBe('12,8 triệu')
    cleanup()
    const { container } = render(sale(12_800_000))
    expect(container.querySelector('.sr-only')).toBeNull()
    cleanup()
    expect(text(sale(950_000))).toBe('950.000 đ')
    cleanup()
    expect(text(sale(1_200_000_000))).toBe('1,2 tỷ đ')
  })
  it('the sticky bar (not native, rateCompactAbove): a sale keeps every digit, a rent reads in millions, no sr-only run', () => {
    let c = render(bar(12_800_000)).container
    expect(c.textContent).toBe('12,800,000 đ')
    expect(c.querySelector('.sr-only')).toBeNull()
    expect(c.querySelector('[aria-hidden]')).toBeNull()
    cleanup()
    c = render(bar(12_000_000, 'VND/month')).container
    expect(c.textContent?.replace(/\s+/g, ' ').trim()).toBe('12M đ / month')
    expect(c.querySelector('.sr-only')).toBeNull()
    expect(c.querySelector('[aria-hidden]')).toBeNull()
  })
  it('a viewer who picked USD still reads the đồng millions first', () => {
    state.currency = 'USD'
    state.rates = { USD: 1 / 25_600 }
    const t = text(sale(12_800_000, 'VND', true))!
    expect(t).toBe('12.8M đ≈ $500')
    expect(t.indexOf('đ')).toBeLessThan(t.indexOf('$'))
  })
  it('price 0 keeps its words under the millions threshold', () => {
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} price={0} currency="₫" priceUnit="VND" />)).toBe('Free')
    cleanup()
    expect(text(<Price native compact compactAbove={RATE_COMPACT_VND} cardWords price={0} currency="₫" priceUnit="VND/month" listingType="job" linked={false} />)).toBe('Negotiable')
  })
  it('an MT language prints its own short scale and still speaks the full figure', () => {
    state.lang = 'zh-Hans'
    expect(text(sale(12_800_000))).toBe('1280万 đ')
    cleanup()
    expect(heard(sale(12_800_000))).toBe('12,800,000 đ')
  })
})
