// ── PRICE HELP FOR UNBRANDED GOODS: THE FALLBACK BAND'S KEY ─────────────────────────────────────
//
// The market band (src/lib/price-stat.ts, written nightly by /api/cron/price-stats) compares a
// listing with live listings of the same BRAND + MODEL on the same shelf, condition and year band.
// A sofa, a cot or a dress has no model, so it never had one. This module decides the ONE other
// comparison the marketplace is willing to make, and it is used ONLY when the brand+model band has
// no data (price-stat.ts `pickPriceBand`):
//
//     the same segment (listingSegment(): category/subcategory | condition [: 2-year band])
//   + the same value of ONE taxonomy facet that splits that shelf into things that price
//     differently — or the shelf alone, where the shelf is a single kind of item.
//
// Pure and import-light (taxonomy only), so a client component may read `fallbackFacetFor()` to know
// which facet value to send. The cron's SQL is built from the same table (`fallbackMapRows()`), so the
// write side and the read side cannot disagree about which shelves have a fallback or what its key is.
//
// ── WHY MOST SHELVES ARE NOT IN THE MAP ─────────────────────────────────────────────────────────
// A fallback band is honest only where the comparables are the same KIND of thing. The 3x spread
// guard (PRICE_STAT_MAX_SPREAD) does NOT establish that, and this was measured, not assumed
// (production, read-only, 2026-10-05):
//   · furniture-appliances/white-goods, shelf alone: n=245, 1.48–4.17tr (2.8x) PASSES the guard while
//     holding 90k induction cookers, 295k fans and 27.9tr fridges — a fan would read as cheap and a
//     fridge as dear, for being a fan and a fridge.
//   · electronics/phones-tablets, shelf alone: n=1,698, 7.2–19.2tr (2.7x) PASSES too, mixing an
//     iPhone 11 with a 15 Pro Max. Where the MODEL sets the price, the brand+model band is the only
//     honest comparison; when it is missing, the answer is nothing.
// So a shelf is listed only when (a) one of its own taxonomy facets separates kinds that price
// differently, or (b) the shelf already is one kind of item. Catch-all shelves (appliances, kitchen,
// decor, household, "other", gear, accessories) and model-driven shelves (phones, laptops, cameras,
// consoles, watches, audio, vehicles) are absent ON PURPOSE. Not showing a band costs nothing; a wrong
// one teaches buyers to ignore every band (the isSaleUnit() note in price-guidance.ts says the same).
//
// ── ONE KEY PER SHELF, NO WIDENING ──────────────────────────────────────────────────────────────
// A facet shelf is keyed on shelf + facet value, and a listing there WITHOUT that value gets no
// fallback band — never the shelf alone. The facet is in the map because the shelf mixes things it
// separates; measured on the same data with material read from titles, used beds split cleanly
// (wood 1.98–2.98tr, metal 0.97–1.48tr) while the whole shelf is one blurred 1.48–3.35tr band. A
// shelf band for a facet shelf is exactly the mix the facet exists to remove.
// ⚠️ This makes the furniture bands EMPTY TODAY: 3,111 of the 3,202 live furniture rows come from one
// importer that writes no attributes (material is set on 1 row). Human posts carry material (the
// wizard requires it), so the bands fill as those accumulate. That is a data job, not a reason to widen.
// The importer now reads the material from the title (src/lib/furniture-material.ts, owner 2026-10-05)
// and scripts/backfill-furniture-material.ts fills its existing rows — measured that day: 1,311 of the
// 3,236 imported rows get one. The bands STILL stay empty: every furniture group is that one shop's,
// and FALLBACK_MIN_SELLERS (kept at 3 by the owner) needs three sellers.

import { facetsFor } from './taxonomy'

/** Which comparison a band rests on. `model` = same brand + model (the original band); `similar` = this
 *  module's fallback. Carried on the band so a surface can say what it is comparing against. */
export type PriceBandBasis = 'model' | 'similar'

/**
 * `PriceStat."brandSlug"` of every fallback row. The table is reused rather than a second one created
 * (no DDL, the same nightly prune, the same primary-key lookup), and the sentinel cannot collide:
 * brandSlugify() emits `[a-z0-9-]` only, and on 2026-10-05 no listing and no PriceStat row carried a
 * brandSlug outside that set. The cron also refuses '*' as a listing brand, so a listing can never
 * write into a fallback key, and its marketPosition update never joins a fallback row — a fallback band
 * never badges a card.
 */
export const FALLBACK_BRAND_KEY = '*'

/** `PriceStat.model` of a shelf-alone fallback row. A facet row's model is `<facet>=<value>`. */
export const FALLBACK_SHELF_MODEL = '*'

/**
 * How many DIFFERENT SELLERS a fallback band needs, on top of PRICE_STAT_MIN_SAMPLE listings.
 *
 * "Based on N similar listings" claims a market, and one seller's catalogue is not one: on a shelf
 * where every comparable is the same shop, the band only restates that shop's price list, and on that
 * shop's own listing it would call its price "typical" against itself. Measured 2026-10-05, each of the
 * four mapped furniture shelves is a single importer's stock, so this keeps them empty even once material
 * is filled — set it to 1 to accept a single catalogue as the reference (parity with the brand+model
 * band, which has no such rule because a same-model comparison is evidence however many shops it comes
 * from). Added on the plan review's advice (Opus); it costs nothing today, when those shelves are empty
 * for want of a material anyway. ⛔ KEPT AT 3 BY THE OWNER (2026-10-05) when the material backfill was
 * approved. Measured that day with the backfill applied (read-only): every furniture group still has ONE
 * seller, so every furniture band stays dormant until other sellers post on those shelves.
 */
export const FALLBACK_MIN_SELLERS = 3

/** Never a fallback band here, whatever FALLBACK_FACET says: none of these is priced like a sale of a
 *  second-hand good (rents, wages, fees, people, homes, tickets). Re-checked by the reader AND the
 *  cron's map, so a careless map entry cannot reintroduce one. */
export const FALLBACK_NEVER_CATEGORIES: ReadonlySet<string> = new Set([
  'rentals', 'jobs', 'services', 'teachers', 'property', 'tickets-travel',
])

/**
 * FACET_CHOICES — `category/subcategory` → the ONE taxonomy facet whose value is part of the key, or
 * `null` for the shelf alone. A shelf that is not listed gets no fallback band at all (see the header).
 * Every facet here is a single-valued taxonomy facet of that shelf (price-fallback.test.ts holds it).
 */
export const FALLBACK_FACET: Readonly<Record<string, string | null>> = {
  // Furniture: material is what separates the kinds inside a shelf — a frame from a mattress, a glass
  // cabinet from a wooden wardrobe — and the wizard requires it on every human post.
  'furniture-appliances/sofa-seating': 'material',
  'furniture-appliances/tables-desks': 'material',
  'furniture-appliances/beds-mattresses': 'material',
  'furniture-appliances/storage': 'material',
  // Baby & kids: the age band IS the size axis for clothes and the main price axis for toys (a rattle
  // against a LEGO set). Strollers/car seats, kids' shoes and maternity wear are each one kind of item,
  // and their only facets (age, gender) do not move the price — the shelf alone.
  'baby-kids/toys': 'ageRange',
  'baby-kids/kids-clothing': 'ageRange',
  'baby-kids/strollers-seats': null,
  'baby-kids/kids-shoes': null,
  'baby-kids/maternity': null,
  // Fashion: size, gender and colour do not price used clothing, so splitting by them would only thin
  // the sample — the shelf alone. Watches & jewellery (two kinds) and beauty (consumables) are absent.
  'fashion-beauty/womens': null,
  'fashion-beauty/mens': null,
  'fashion-beauty/shoes': null,
  'fashion-beauty/bags': null,
  // Sports: the sport separates a football boot from a running shoe, a golf club from a pickleball
  // paddle. Sportswear is one kind of item.
  'sports/sports-shoes': 'sport',
  'sports/racket-ball': 'sport',
  'sports/sportswear': null,
  // Books: the language is the price level — an imported English edition against a Vietnamese print.
  'books-stationery/literature': 'bookLanguage',
  'books-stationery/self-help-business': 'bookLanguage',
  'books-stationery/childrens-books': 'bookLanguage',
  'books-stationery/textbooks-exam': 'bookLanguage',
  'books-stationery/languages-dictionaries': 'bookLanguage',
  'books-stationery/comics-manga': 'bookLanguage',
  'books-stationery/books-other': 'bookLanguage',
  // Electronics, only where a spec IS the price axis whatever the brand: screen size for a TV or a
  // monitor, keyboard against mouse against mouse pad, the capacity of a power bank.
  'electronics/tv-monitors': 'screenSize',
  'electronics/keyboards-mice': 'deviceKind',
  'electronics/power-banks': 'capacity',
}

/** Trimmed `category/subcategory`, or null when either half is missing — the same emptiness rule as
 *  listingSegment(), so a shelf with no band there has no fallback here either. */
function shelfOf(categorySlug: string | null | undefined, subcategorySlug: string | null | undefined): { category: string; subcategory: string } | null {
  const category = (categorySlug || '').trim()
  const subcategory = (subcategorySlug || '').trim()
  return category && subcategory ? { category, subcategory } : null
}

/**
 * The fallback rule for a shelf: `undefined` = no fallback band at all; `null` = the shelf alone;
 * a string = the facet whose value completes the key.
 */
export function fallbackFacetFor(categorySlug: string | null | undefined, subcategorySlug: string | null | undefined): string | null | undefined {
  const shelf = shelfOf(categorySlug, subcategorySlug)
  if (!shelf || FALLBACK_NEVER_CATEGORIES.has(shelf.category)) return undefined
  const key = `${shelf.category}/${shelf.subcategory}`
  return Object.prototype.hasOwnProperty.call(FALLBACK_FACET, key) ? FALLBACK_FACET[key] : undefined
}

/** The taxonomy's own values for that facet on that shelf — the only values a fallback key may carry,
 *  so an importer's free-typed "Gỗ sồi" never mints a band of its own. */
export function fallbackFacetValues(categorySlug: string, subcategorySlug: string, facetKey: string): readonly string[] {
  const facet = facetsFor(categorySlug.trim(), subcategorySlug.trim()).find((f) => f.key === facetKey)
  return facet ? facet.options.map((o) => o.value) : []
}

/**
 * The regular expression — the SAME string in Postgres (`substring(attributes from …)`) and in JS — that
 * reads a facet's value out of the stored `Listing.attributes` JSON text.
 *
 * ⚠️ A REGEX ON PURPOSE, NOT `attributes::jsonb ->> key`. The column is TEXT written by
 * sanitizeAttributes() (JSON.stringify of string values), and `"key":"value"` is the exact needle the
 * browse filter matches (attrNeedles in attr-match.ts) — so a band's comparables are exactly the
 * listings that facet's chip returns. A jsonb cast would also throw on one malformed row and take the
 * whole nightly statement down. Measured 2026-10-05 over all 44,805 rows with attributes: 0 invalid
 * JSON, 0 non-string values, 0 `": "` spacing, 0 escaped characters — the pattern reads every one of
 * them exactly as JSON.parse would. Facet keys are `[A-Za-z0-9_]` (price-fallback.test.ts holds it), so
 * the pattern has no metacharacter that Postgres ARE and JS could read differently.
 */
export function facetValuePattern(facetKey: string): string {
  return `"${facetKey}":"([^"]*)"`
}

/** A facet's value: from the stored attributes TEXT through facetValuePattern() (the cron's exact rule),
 *  or from an object of form values (the post wizard's `attr_<key>`). */
export function readFacetValue(attributes: string | Record<string, unknown> | null | undefined, facetKey: string): string | null {
  if (typeof attributes === 'string') {
    const match = new RegExp(facetValuePattern(facetKey)).exec(attributes)
    return match ? match[1] : null
  }
  if (attributes && typeof attributes === 'object') {
    const value = attributes[facetKey]
    return typeof value === 'string' ? value : null
  }
  return null
}

/**
 * `PriceStat.model` of a listing's fallback band — FALLBACK_SHELF_MODEL, `<facet>=<value>`, or null when
 * the listing has none (an unlisted shelf, a never-category, or a facet shelf without a taxonomy value).
 */
export function fallbackBandKey(input: {
  categorySlug: string | null | undefined
  subcategorySlug: string | null | undefined
  attributes?: string | Record<string, unknown> | null
}): string | null {
  const facet = fallbackFacetFor(input.categorySlug, input.subcategorySlug)
  if (facet === undefined) return null
  if (facet === null) return FALLBACK_SHELF_MODEL
  const value = readFacetValue(input.attributes, facet)
  if (!value || !fallbackFacetValues(input.categorySlug || '', input.subcategorySlug || '', facet).includes(value)) return null
  return `${facet}=${value}`
}

/** One row of the cron's allow-map: a shelf-alone shelf once, a facet shelf once per taxonomy value. */
export type FallbackMapRow = { cat: string; sub: string; facet: string | null; val: string | null; pattern: string | null }

/** FALLBACK_FACET as the rows the nightly SQL joins against (`jsonb_to_recordset`). Built here, from the
 *  same table and the same vocabulary the reader uses — the SQL never retypes a shelf or a value. */
export function fallbackMapRows(): FallbackMapRow[] {
  const rows: FallbackMapRow[] = []
  for (const [key, facet] of Object.entries(FALLBACK_FACET)) {
    const slash = key.indexOf('/')
    const cat = key.slice(0, slash)
    const sub = key.slice(slash + 1)
    if (fallbackFacetFor(cat, sub) === undefined) continue
    if (facet === null) {
      rows.push({ cat, sub, facet: null, val: null, pattern: null })
      continue
    }
    for (const val of new Set(fallbackFacetValues(cat, sub, facet))) {
      rows.push({ cat, sub, facet, val, pattern: facetValuePattern(facet) })
    }
  }
  return rows
}
