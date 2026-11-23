// Pure FX plausibility bands for display approximations. No React and no 'use client': <Price>, the map and the
// currency context all read these, and dozens of tests mock the context with a hand-picked subset of its exports.

/**
 * ĐỒNG PER ONE DOLLAR (≈ 26 000) from the /api/fx table, or null when the rate is unusable.
 *
 * ⚠️ THE BAND IS THE POINT, and it is the same reasoning visa/fx.ts spells out at length: the
 * upstream publishes "currency per 1 VND", so `rates.USD` ≈ 0.0000383 and the figure we want is the
 * RECIPROCAL. Every way of getting that wrong lands far outside the tens of thousands — an
 * un-inverted rate gives 0.0000383, a rate quoted in thousands gives 26.1, a broken payload gives 0
 * or NaN — so asserting the magnitude catches all of them, while a bare `> 0` check catches none.
 *
 * Callers that merely DISPLAY an approximation degrade to showing one currency. The builder's
 * custom-budget field additionally refuses to submit, because there the number becomes the model's
 * spending target rather than a hint. Both were flagged in review as accepting an absurd rate.
 */
export function vndPerUsd(rates: Record<string, number>): number | null {
  const perVnd = rates.USD
  if (!perVnd || !Number.isFinite(perVnd) || perVnd <= 0) return null
  const rate = 1 / perVnd
  return rate >= 5_000 && rate <= 100_000 ? rate : null
}

/**
 * Units of each picker currency (lib/currencies.ts) per ONE US dollar, rounded, late 2026. A MAGNITUDE reference for
 * `perVndRate`'s band and nothing else: it is never multiplied into a figure anyone reads, so it does not need updating
 * unless a currency moves more than threefold.
 */
const NOMINAL_PER_USD: Readonly<Record<string, number>> = {
  EUR: 0.9, GBP: 0.77, CNY: 7.2, KRW: 1_400, JPY: 150, THB: 34, MYR: 4.4, SGD: 1.33, INR: 86, RUB: 90, AUD: 1.5, KHR: 4_050,
}

/**
 * `currency` per 1 VND from the /api/fx table (the table's own shape, so it multiplies), or null when it is unusable.
 * ⚠️ THE SAME BAND AS `vndPerUsd`, CARRIED TO EVERY PICKER CURRENCY (2026-11-23, owner: "the currency change is not
 * working"). Picking EUR used to change nothing on a card: its "≈" was dollars for every viewer, because a first cut that
 * showed the picked currency had no sanity check outside USD (price.tsx `native`). Now a currency counts only when the
 * dollar rate passes `vndPerUsd` AND the currency's own cross rate (units per dollar) sits within 3× of its nominal one —
 * which still catches an un-inverted, thousand-scaled, zero or NaN value, each of which lands orders of magnitude away.
 */
export function perVndRate(rates: Record<string, number>, currency: string): number | null {
  if (!vndPerUsd(rates)) return null
  if (currency === 'USD') return rates.USD
  const nominal = NOMINAL_PER_USD[currency]
  const r = rates[currency]
  if (!nominal || !r || !Number.isFinite(r) || r <= 0) return null
  const perUsd = r / rates.USD
  return perUsd >= nominal / 3 && perUsd <= nominal * 3 ? r : null
}

/**
 * The currency of the "≈" beside a đồng-led price (a card, a map pin): the viewer's pick, or dollars for a đồng viewer —
 * and dollars again whenever the pick's rate fails `perVndRate`, so a broken rate degrades to the old "≈ $", never to a
 * wrong figure. Null when even the dollar rate is unusable: no "≈" at all.
 */
export function approxCurrency(picked: string, rates: Record<string, number>): { code: string; rate: number } | null {
  if (picked && picked !== 'VND' && picked !== '₫' && picked !== 'USD') {
    const r = perVndRate(rates, picked)
    if (r) return { code: picked, rate: r }
  }
  const usd = perVndRate(rates, 'USD')
  return usd ? { code: 'USD', rate: usd } : null
}
