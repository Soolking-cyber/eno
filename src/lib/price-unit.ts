/**
 * THE ONE PARSE OF `Listing.priceUnit`. `<Price>` reads it to print the " / month" a buyer sees, and
 * the listing page's structured data will read it to state the unit a crawler sees. Two parses of one
 * column drift, and then the markup states a unit the page does not show — which Google's
 * structured-data rules forbid ("a true representation of the page content").
 *
 * WHAT IS STORED, MEASURED (production, 2026-09-27): '' on goods, 'VND' (rent, own sell, some
 * services), 'VND/month' (rent, job), 'VND/service', 'VND/kg' (wholesale), 'VND/hour' (job). The CI
 * fixtures (scripts/ci-fixtures.ts) also store a bare 'month' (`ci-l-4`) and a bare 'service'.
 * `listingMoneyFor` (taxonomy.ts) writes the 'VND…' forms.
 *
 * ⚠️ A BARE 'VND' HAS NO SUFFIX, EVEN WHERE IT IS A MONTHLY RENT. Batdongsan and Rever store it on
 * about 19,400 active rentals that are in fact monthly. Their importers write "Rent: <price>/month"
 * into the description, so those pages used to state the month in the text, never after the price.
 * `priceUnitSuffix` still reads the column alone; the serializers now hand it `displayPriceUnit`'s
 * answer, which knows those two sellers (below) — the same set `isMonthlyRent` (rent-index.ts) uses.
 */

/** The monthly unit `listingMoneyFor({ listingType: 'rent' })` writes for every rent listing. */
export const MONTHLY_UNIT = 'VND/month'

/**
 * ⛔ A BARE "VND" UNIT IS A MONTHLY RENT ONLY FROM THESE TWO SELLERS, AND THAT WAS READ, NOT ASSUMED.
 * scripts/import-batdongsan-rentals.ts keeps `price_type === 'lump_sum'` only, drops any `price_raw`
 * containing `/m` (a per-m² quote), and writes `Rent: <price>/month` into the description;
 * scripts/import-rever-rentals.ts takes the live price of a still-unrented rental and writes the same.
 * Both simply store `priceUnit: 'VND'` without the suffix. Anywhere else a bare 'VND' in rentals could
 * be a nightly or a one-off price, so it is excluded rather than guessed at — Nhatot stores bare
 * 'VND' too and is NOT on this list (rent-index.test.ts pins that). Ids, never names — `Seller.name`
 * is user-settable (src/lib/import-sellers.ts). Moved here from rent-index.ts, unchanged, so the
 * display rule and the index rule read one set.
 */
export const MONTHLY_BARE_VND_SELLERS: ReadonlySet<string> = new Set([
  'bds-vn-import-seller-0001', // Batdongsan.com.vn
  'cmub0wead0000zrq418bqq27m', // Rever.vn
])

/**
 * DISPLAY rule: a bare 'VND' from a seller proven to store monthly rent without the suffix reads
 * 'VND/month', so its card and its page say "/ month" after the price (measured 2026-09-29: the home
 * feed's Rever card read "5,000,000 đ ≈ $195" with no unit). The COLUMN is untouched — the importers
 * and a data fix own that; everything else passes through unchanged.
 */
export function displayPriceUnit(priceUnit: string, sellerId: string | null | undefined): string {
  return priceUnit === 'VND' && !!sellerId && MONTHLY_BARE_VND_SELLERS.has(sellerId) ? MONTHLY_UNIT : priceUnit
}

/**
 * The unit a price is quoted per, as `<Price>` prints it after the slash: 'month', 'kg', 'hour'.
 * null when there is none — no unit, a bare 'VND', or 'service'.
 *
 * ⚠️ 'service' IS NO UNIT (owner, 2026-09-13: "remove /service from price on services category"). A
 * service is priced per service by definition, so the suffix told a buyer nothing and was the widest
 * run on every visa and trip card. The STORED value stays 'VND/service': openers.ts's isRatePrice()
 * reads the column itself, not this function.
 */
export function priceUnitSuffix(priceUnit: string | null | undefined): string | null {
  if (!priceUnit || priceUnit === 'VND') return null
  const unit = priceUnit.replace(/^VND\/?/, '').trim() || null
  return unit === 'service' ? null : unit
}

/**
 * UN/CEFACT common codes (what schema.org's `unitCode` takes) for the units a listing can carry. A
 * suffix missing here has no code, so structured data states no unit for it rather than a guessed one.
 * A Map, not an object literal, so a stored unit such as 'VND/toString' finds nothing instead of
 * `Object.prototype.toString`.
 */
export const UNIT_CODES: ReadonlyMap<string, string> = new Map([
  ['month', 'MON'],
  ['week', 'WEE'],
  ['day', 'DAY'],
  ['hour', 'HUR'],
  ['kg', 'KGM'],
])
