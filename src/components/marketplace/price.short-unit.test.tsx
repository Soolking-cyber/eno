// @vitest-environment jsdom
/**
 * `<Price shortUnit>` — the card's English short unit (UI climb batch 81, 2026-11-13): "3.79M đ/mo".
 *
 * ⛔ THE UNIT IS NEVER HIDDEN, ONLY SHORTENED (price.tsx `unit`): the short word stays on screen, a screen reader hears the
 * whole "/ month", "đ/mo" is ONE unbreakable run (the line may break only before "≈ $"), and every other language, an
 * 'sm'-only row unit, an unknown unit and a caller without the prop (the listing page) print exactly what they did.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMoney } from '@/lib/currencies'
import { RATE_COMPACT_VND } from '@/lib/vnd'
import { Price } from './price'

const state = vi.hoisted(() => ({ lang: 'en', rates: { USD: 1 / 25_600 } as Record<string, number> }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: state.lang, tr: (en: string, viText?: string) => (state.lang === 'vi' && viText ? viText : en) }),
  useTr: (s: string) => (state.lang === 'vi' && s === 'month' ? 'tháng' : s),
}))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return {
    vndPerUsd: real.vndPerUsd,
    useCurrency: () => ({ currency: 'VND', rates: state.rates, ratesPending: false, format: (n: number, l?: 'en' | 'vi') => formatMoney(n, 'VND', state.rates, l) }),
  }
})
afterEach(() => { cleanup(); state.lang = 'en' })

const card = (priceUnit: string, extra: Partial<React.ComponentProps<typeof Price>> = {}) =>
  render(<Price native compact compactAbove={RATE_COMPACT_VND} fabAvoid shortUnit price={3_790_000} currency="₫" priceUnit={priceUnit} {...extra} />).container
/** What a sighted reader sees: the sr-only run removed. */
const seen = (el: HTMLElement) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('.sr-only').forEach((n) => n.remove()); return c.textContent!.replace(/\s+/g, ' ').trim() }
/** What assistive tech reads: aria-hidden runs removed. */
const heard = (el: HTMLElement) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove()); return c.textContent!.replace(/\s+/g, ' ').trim() }

describe('<Price shortUnit> — English cards', () => {
  it('prints "3.79M đ/mo ≈ $148": the short unit glued to the mark, the estimate kept', () => {
    expect(seen(card('VND/month'))).toBe('3.79M đ/mo≈ $148')
  })
  it('a screen reader hears the whole unit, never "slash mo"', () => {
    expect(heard(card('VND/month'))).toBe('3.79M đ / month')
  })
  it('"đ/mo" is one nowrap run: the price can break before "≈ $" and nowhere inside the unit', () => {
    const runs = [...card('VND/month').querySelectorAll('span.whitespace-nowrap')].map((s) => s.textContent)
    expect(runs.some((t) => t!.startsWith('đ/mo'))).toBe(true)
    expect(runs).not.toContain('/ month')
    // …and the one break the row has left sits between the figure and the estimate: a <wbr> right after the figure's run.
    const fig = card('VND/month').querySelector('[data-fab-avoid]')!
    expect(fig.nextSibling?.nodeName).toBe('WBR')
  })
  it('hour, day and week have short forms; any other unit keeps its long form', () => {
    expect(seen(card('VND/hour', { price: 400_000 }))).toBe('400,000 đ/hr≈ $16')
    expect(seen(card('VND/day'))).toBe('3.79M đ/day≈ $148')
    expect(seen(card('VND/week'))).toBe('3.79M đ/wk≈ $148')
    expect(seen(card('VND/kg', { price: 90_000 }))).toBe('90,000 đ / kg≈ $4')
    expect(seen(card('VND/toString', { price: 90_000 }))).toBe('90,000 đ / toString≈ $4')
  })
})

describe('everything else prints exactly as before', () => {
  it('Vietnamese keeps "/ tháng" (the owner\'s 10-18 "triệu" form)', () => {
    state.lang = 'vi'
    expect(seen(card('VND/month'))).toBe('3,79 triệu / tháng≈ $148')
  })
  it('a caller without the prop — the listing page — keeps "/ month"', () => {
    expect(seen(render(<Price native price={3_790_000} currency="₫" priceUnit="VND/month" />).container)).toBe('3,790,000 đ / month≈ $148')
  })
  it('a row\'s sm-only unit keeps its long, hideable form', () => {
    const el = card('VND/month', { unit: 'sm' })
    expect(el.querySelector('.hidden.sm\\:inline')?.textContent?.trim()).toBe('/ month')
  })
  it('no unit, no figure: a sale price and a free item are untouched', () => {
    expect(seen(card('VND', { price: 2_250_000, compactAbove: undefined }))).toBe('2,250,000 đ≈ $88')
    expect(seen(card('VND/month', { price: 0 }))).toBe('Free')
  })
})
