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
 * into the description, so those pages state the month in the text, never after the price. This
 * function reads the column alone and so gives them no suffix; `isMonthlyRent` (rent-index.ts) is
 * the rule that knows those two sellers.
 */

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
