/**
 * ── WHICH SECOND-HAND PRICES A PRICE PAGE MAY QUOTE ───────────────────────────────────────────────────
 *
 * Since 2026-10-03 the iPhone price pages read second-hand SHOP listings (lowest-prices.ts). One
 * "3.890.000" typed for a 38.900.000 phone would headline the page, its FAQ answer and the Product
 * `lowPrice`. Pure, so it is unit-tested.
 *
 * ⛔ EVERY TIER IS GUARDED, NOT ONLY THE BUSY ONES (commit-gate review): the first guard looked only at
 * tiers of three or more listings, and a new model's tiers start with one or two — exactly when a typo
 * would lead the page. And a price is out of line in EITHER direction (review: a lone "389.000.000" for a
 * 38.900.000 phone is the same typo upward). A price is left out when it falls outside ANY of:
 *   · ½–2× the median of its (model, storage) tier, when the tier has three or more listings;
 *   · 0.4–2.5× the median of every listing of that MODEL, when the model has three or more
 *     (storage tiers of one model differ — Apple Vietnam's 2TB Pro Max is ~1.7× its 256GB — so this
 *     yardstick is looser than the tier's own);
 *   · 0.3–3× Apple Vietnam's own launch price for the model, when this file knows it.
 * ⛔ AND A PRICE NOTHING CAN CHECK IS NOT QUOTED (commit-gate review): a model with fewer than three
 * listings and no known Apple price has no yardstick, so its tier is left out rather than published
 * unexamined — the table shows fewer rows, never an unchecked "lowest price".
 */

/**
 * Apple Vietnam's own price for the cheapest storage tier — the ONE place the price pages read it from
 * (the model pages' `rrp`, the hub's copy and this guard), so a correction lands everywhere at once.
 */
export const APPLE_VN_FROM_PRICE: Readonly<Record<string, number>> = {
  'iPhone 18 Pro': 38_999_000,
  'iPhone 18 Pro Max': 41_999_000,
  'iPhone Duo': 64_999_000,
}

/**
 * Apple Vietnam's on-sale date (first deliveries, ICT) for a model not yet in buyers' hands when this was
 * written. A second-hand unit cannot exist before it, so a "used" row of that model before the date is a
 * mislabelled pre-order or a lure — never quoted, and never Product markup (commit-gate review: the Duo
 * page's own FAQ says one can only appear after 23 October).
 */
export const APPLE_VN_ON_SALE: Readonly<Record<string, string>> = {
  'iPhone Duo': '2026-10-23',
}

/** False while `model` is not yet on sale in Vietnam (see APPLE_VN_ON_SALE). */
export function onSaleYet(model: string, now: Date = new Date()): boolean {
  const day = APPLE_VN_ON_SALE[model]
  return !day || now.getTime() >= Date.parse(`${day}T00:00:00+07:00`)
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The price band a listing of this tier may show, or null when nothing is known to judge it by. */
export function priceBand(tier: readonly { price: number }[], modelRows: readonly { price: number }[], fromPrice?: number): { min: number; max: number } | null {
  const bands: { min: number; max: number }[] = []
  if (tier.length >= 3) { const m = median(tier.map((r) => r.price)); bands.push({ min: m / 2, max: m * 2 }) }
  // BOTH yardsticks, not either-or (review): three bad rows in one tier agree with each other, not with the
  // rest of the model.
  if (modelRows.length >= 3) { const m = median(modelRows.map((r) => r.price)); bands.push({ min: m * 0.4, max: m * 2.5 }) }
  if (fromPrice) bands.push({ min: fromPrice * 0.3, max: fromPrice * 3 })
  if (!bands.length) return null
  return { min: Math.max(...bands.map((b) => b.min)), max: Math.min(...bands.map((b) => b.max)) }
}

/** The tier minus implausible prices, either way (see the header). */
export function plausibleTier<T extends { price: number }>(tier: readonly T[], modelRows: readonly T[], fromPrice?: number): T[] {
  const band = priceBand(tier, modelRows, fromPrice)
  return band === null ? [] : tier.filter((r) => r.price >= band.min && r.price <= band.max)
}
