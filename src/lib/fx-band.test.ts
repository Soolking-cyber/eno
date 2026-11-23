import { describe, expect, it } from 'vitest'

import { CURRENCY_CODES } from './currencies'
import { approxCurrency, perVndRate, vndPerUsd } from './fx-band'

/** /api/fx as it answered on 2026-11-23 (open.er-api.com, base VND: "currency per 1 VND", six decimals). */
const LIVE: Record<string, number> = {
  VND: 1, USD: 3.9e-05, EUR: 3.5e-05, GBP: 3e-05, CNY: 0.00026, KRW: 0.052088, JPY: 0.006159, THB: 0.001317,
  MYR: 0.00016, SGD: 5e-05, INR: 0.003595, RUB: 0.00318, AUD: 5.8e-05, KHR: 0.157933,
}

describe('perVndRate — the band every picker currency must pass before it is drawn as an "≈"', () => {
  it('passes every currency the picker offers, at the live rates (a code missing from the nominal table would fail here)', () => {
    for (const code of CURRENCY_CODES) {
      if (code === 'VND') continue
      expect(perVndRate(LIVE, code), code).toBe(LIVE[code])
    }
  })

  it('refuses an un-inverted, thousand-scaled, zero, negative or NaN rate', () => {
    for (const bad of [1 / LIVE.EUR, LIVE.EUR * 1_000, LIVE.EUR / 1_000, 0, -LIVE.EUR, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(perVndRate({ ...LIVE, EUR: bad }, 'EUR'), String(bad)).toBeNull()
    }
  })

  it('refuses every currency when the dollar rate itself fails vndPerUsd — the cross rate is measured against it', () => {
    const broken = { ...LIVE, USD: 1 / LIVE.USD }
    expect(vndPerUsd(broken)).toBeNull()
    expect(perVndRate(broken, 'EUR')).toBeNull()
    expect(perVndRate(broken, 'USD')).toBeNull()
  })

  it('refuses a currency the picker does not offer — no nominal, no band', () => {
    expect(perVndRate({ ...LIVE, CHF: 3.4e-05 }, 'CHF')).toBeNull()
  })
})

describe('approxCurrency — the "≈" beside a đồng-led price', () => {
  it('is the pick, dollars for a đồng or USD viewer', () => {
    expect(approxCurrency('EUR', LIVE)).toEqual({ code: 'EUR', rate: LIVE.EUR })
    expect(approxCurrency('VND', LIVE)).toEqual({ code: 'USD', rate: LIVE.USD })
    expect(approxCurrency('USD', LIVE)).toEqual({ code: 'USD', rate: LIVE.USD })
  })

  it('falls back to dollars when the pick fails its band, and to nothing when the dollar does', () => {
    expect(approxCurrency('EUR', { ...LIVE, EUR: 1 / LIVE.EUR })).toEqual({ code: 'USD', rate: LIVE.USD })
    expect(approxCurrency('EUR', { VND: 1, USD: LIVE.USD })).toEqual({ code: 'USD', rate: LIVE.USD })
    expect(approxCurrency('EUR', { ...LIVE, USD: 26_000 })).toBeNull()
    expect(approxCurrency('VND', {})).toBeNull()
  })
})

describe('currencyMark — the map pin prints the mark the popup\'s "≈" prints', () => {
  it('a symbol where Intl has one, the code and a space where it has not', async () => {
    const { currencyMark } = await import('./currencies')
    expect(['USD', 'EUR', 'GBP', 'KRW', 'JPY', 'CNY', 'AUD', 'INR'].map(currencyMark)).toEqual(['$', '€', '£', '₩', '¥', 'CN¥', 'A$', '₹'])
    expect(['THB', 'MYR', 'SGD', 'RUB', 'KHR'].map(currencyMark)).toEqual(['THB ', 'MYR ', 'SGD ', 'RUB ', 'KHR '])
  })
})
