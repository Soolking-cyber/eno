import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import {
  FALLBACK_BRAND_KEY,
  FALLBACK_MIN_SELLERS,
  FALLBACK_SHELF_MODEL,
  fallbackBandKey,
  fallbackMapRows,
  type PriceBandBasis,
} from '@/lib/price-fallback'

// Market-price benchmark read side (write side = /api/cron/price-stats). Given a listing's
// brand/model/condition/year, return the robust P25–median–P75 band for its segment so the PDP
// can show the buyer where the asking price stands. When the brand+model band has no data, the
// FALLBACK band (src/lib/price-fallback.ts: same segment + one taxonomy facet, or the shelf alone)
// answers instead — for the sofa, the cot and the dress, which have no model.

export const PRICE_STAT_MIN_SAMPLE = 5
// A band whose top is more than this × its bottom is too noisy to be an actionable benchmark
// (e.g. a seed group that mixes new + used + all years → 7tr–40tr). Suppress it. Kept in sync
// with the cron's marketPosition update so a card is never badged off a uselessly-wide band.
export const PRICE_STAT_MAX_SPREAD = 3

/** `basis` says which comparison the band rests on — see PriceBandBasis. */
export type PriceBand = { n: number; p25: number; median: number; p75: number; basis: PriceBandBasis }

/**
 * ⛔ A BAND IS A SALE PRICE, SO ONLY SALE LISTINGS FORM ONE OR ARE JUDGED BY ONE. Rent is charged per
 * month and "wanted" states a budget; either in the same distribution makes both numbers a fiction —
 * a ₫4m monthly rental would read as a spectacular deal against ₫40m purchase prices (astra). Today
 * every branded listing is `sell`, so this changes nothing yet and prevents the day it would.
 * The cron's eligibility predicate (SALE_ELIGIBLE_SQL below) uses this same value.
 */
export const SALE_LISTING_TYPE = 'sell'

/**
 * Segment key — MUST stay identical to SEGMENT_SQL below (the cron groups by it):
 * `<category>/<subcategory>|<condition>`, plus a 2-year band when a year is present (vehicles).
 * year 2015 → band 2014; null year → no suffix.
 *
 * ⛔ THE SHELF IS PART OF THE KEY, AND WITHOUT IT "GOOD PRICE" WAS WRONG FOR THE OWNER'S OWN EXAMPLE.
 * The band used to be keyed on brand+model+condition alone, so every listing that NAMES a device was
 * banded together with the device: measured 2026-09-15, "Mipow Transparent Silicon Case for iPhone
 * 14 Pro" at 119,000đ was 'low' against a band of p25 294,000, "Spigen Liquid Crystal iPhone 15 Pro
 * Max Case" 344,000đ against a band whose median was 952,000 (cases and phones averaged), and
 * "AppleCare+ cho iPhone 16 Plus" (filed under services) was a good price against the phone. 114
 * phone-cases, 59 screen-protectors and 24 services rows carried the badge — and a real phone in a
 * band dragged down by ₫300k cases could almost never be 'low'. A case is now compared with cases.
 *
 * ⛔ NO SUBCATEGORY, NO BAND: the caller gets `null` and the cron skips the row. A category-wide
 * "unfiled" bucket would re-mix exactly what this key separates (astra) — it is where a case with no
 * shelf and the phone it fits both land.
 */
export function listingSegment(input: {
  categorySlug: string | null | undefined
  subcategorySlug: string | null | undefined
  condition: string | null | undefined
  year: number | null | undefined
}): string | null {
  const category = (input.categorySlug || '').trim()
  const subcategory = (input.subcategorySlug || '').trim()
  if (!category || !subcategory) return null
  // ⚠️ `|| 'any'` maps BOTH null and '' to 'any'; the SQL twin uses NULLIF(btrim(condition),'') for
  // the same reason. A whitespace-only condition from the partner sync trims to '' and is stored, so
  // the cron once filed those rows under ':2018' while every reader asked for 'any:2018' and missed —
  // the band silently never rendered. Both sides must agree on emptiness.
  const c = (input.condition || '').trim() || 'any'
  const shelf = `${category}/${subcategory}|${c}`
  return input.year != null ? `${shelf}:${Math.floor(input.year / 2) * 2}` : shelf
}

// ── THE SQL TWINS ─────────────────────────────────────────────────────────────────────────────
// Kept beside their TS halves (listingSegment above, fallbackBandKey in price-fallback.ts) and
// imported by /api/cron/price-stats, which used to hold them. A Next route file may export only its
// handlers, so here is also the only place a test can reach them: price-stat.sql.test.ts executes
// these exact statements in an in-process Postgres (PGlite) and compares their keys with the TS
// functions — in CI it FAILS rather than skips if PGlite is missing.

/**
 * ⚠️ regexp_replace ON `\s`, NOT btrim — btrim's default set is the SPACE CHARACTER ONLY, while the TS
 * side's String.trim() also eats tabs and newlines. A subcategory stored as "\tphone-cases" would then
 * be filed under one key by the cron and read under another by the PDP, and the band would silently
 * never render (astra). Postgres `\s` in a regex is the whitespace class, which is the same intent.
 */
const TRIM = (col: string) => Prisma.raw(`regexp_replace(${col}, '^\\s+|\\s+$', '', 'g')`)

/**
 * The segment, in SQL, for a `"Listing" l JOIN "Category" c`. ⛔ MUST MATCH listingSegment() character
 * for character — `<category>/<subcategory>|<condition>[:<year band>]`. When the key changed
 * (2026-09-15) it was checked against listingSegment() on every production row (27,133 rows, 0
 * mismatches — price-stat.test.ts records the method); since 2026-10-05 price-stat.sql.test.ts executes
 * it on every vitest run (PGlite, in-process) and compares it with listingSegment() row by row.
 * NULLIF(…,'') because a whitespace-only condition must read as 'any' on both sides.
 * The fallback band is grouped by this SAME expression: a fallback row's segment is the listing's
 * segment, so the condition class and the year band carry over unchanged.
 */
export const SEGMENT_SQL = Prisma.sql`(${TRIM('c.slug')} || '/' || ${TRIM('l."subcategorySlug"')} || '|' || COALESCE(NULLIF(${TRIM('l.condition')}, ''), 'any')
  || CASE WHEN l.year IS NOT NULL THEN ':' || ((l.year / 2) * 2)::text ELSE '' END)`

/**
 * A live SALE listing on a shelf, priced in đồng — the part of eligibility both bands share, so the
 * brand+model band and the fallback can never disagree about what "comparable and live" means.
 * No subcategory → no band (listingSegment returns null for it too), and SALE only — a band is a sale
 * price, so a monthly rental neither forms one nor is judged by one (see SALE_LISTING_TYPE).
 */
const SALE_ELIGIBLE_SQL = Prisma.sql`l.status = 'active' AND l.verified = true
  AND NULLIF(${TRIM('l."subcategorySlug"')}, '') IS NOT NULL
  AND l."listingType" = ${SALE_LISTING_TYPE}
  AND l.currency = '₫' AND l.price > 0`

/**
 * Which listings may form a BRAND+MODEL band AND be judged against one. ONE predicate for both
 * statements — the positioning UPDATE used to omit `verified` and `currency`, so a listing that could
 * never be part of a band could still be badged by one (a non-₫ price compared with đồng percentiles).
 * ⚠️ A listing whose brandSlug is the fallback sentinel is refused (none exists — brandSlugify cannot
 * emit it), so no listing can ever write into, or be badged off, a fallback row.
 */
export const ELIGIBLE_SQL = Prisma.sql`${SALE_ELIGIBLE_SQL}
  AND l."brandSlug" IS NOT NULL AND l."brandSlug" <> ${FALLBACK_BRAND_KEY} AND l.model IS NOT NULL`

/** The listing scope as marketplaceListingScope() returns it (src/lib/edition-scope.ts). */
export type ListingSellerScope = { sellerId?: { in?: readonly string[]; notIn?: readonly string[] } }

/**
 * The edition scope as SQL.
 * ⚠️ FAIL CLOSED ON ANY SHAPE IT DOES NOT TRANSLATE. The scope is a Prisma `where` fragment, and this is
 * hand-translated raw SQL: if the scope one day carries another key (a category, an `AND` list), reading
 * only the parts known today would silently build bands from listings the marketplace does not show.
 * An unknown key throws, the cron reports the failed run, and the fallback rows age out.
 */
function sellerScopeSql(scope: ListingSellerScope): Prisma.Sql {
  const unknown = [
    ...Object.keys(scope).filter((k) => k !== 'sellerId'),
    ...Object.keys(scope.sellerId ?? {}).filter((k) => k !== 'in' && k !== 'notIn').map((k) => `sellerId.${k}`),
  ]
  if (unknown.length) throw new Error(`[price-stats] the edition scope carries ${unknown.join(', ')}, which the fallback SQL does not translate — refusing to build bands without it`)
  const { in: allowIds, notIn } = scope.sellerId ?? {}
  const allow = allowIds === undefined
    ? Prisma.empty
    // An empty allow-list admits nobody. The scope helpers throw before returning one, but a band built
    // from "everyone" because a list came back empty is the one outcome that must be impossible here.
    : allowIds.length ? Prisma.sql`AND l."sellerId" IN (${Prisma.join([...allowIds])})` : Prisma.sql`AND FALSE`
  const deny = notIn?.length ? Prisma.sql`AND l."sellerId" NOT IN (${Prisma.join([...notIn])})` : Prisma.empty
  return Prisma.sql`${allow} ${deny}`
}

/**
 * The nightly upsert of every FALLBACK band — the brand+model upsert's twin (same SEGMENT_SQL, same
 * percentile_cont + round, same PRICE_STAT_MIN_SAMPLE floor, same table and conflict target), so the
 * fallback is precomputed exactly like the band it stands in for, never computed per request.
 *
 * What differs, each on purpose:
 *  · brand and model are NOT required — that is the point — and the shelf must be in the allow-map
 *    (fallbackMapRows(): one row per shelf-alone shelf, one per facet value);
 *  · the facet value is read with facetValuePattern(), the same regex string the reader uses, and only
 *    a taxonomy value counts;
 *  · the caller's EDITION SCOPE applies (the desk sellers out, the partner allow-list when armed), so a
 *    band is built only from listings the marketplace actually shows;
 *  · at least FALLBACK_MIN_SELLERS distinct sellers — a similar-items band claims a market.
 * Rows land under brandSlug FALLBACK_BRAND_KEY and are pruned by the cron's 36-hour sweep like any other.
 */
export function fallbackStatsUpsertSql(scope: ListingSellerScope): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "PriceStat" ("brandSlug", model, segment, n, p25, median, p75, "updatedAt")
    SELECT
      ${FALLBACK_BRAND_KEY}::text,
      CASE WHEN k.facet IS NULL THEN ${FALLBACK_SHELF_MODEL}::text ELSE k.facet || '=' || k.val END,
      k.segment,
      count(*)::int,
      round(percentile_cont(0.25) WITHIN GROUP (ORDER BY k.price))::int,
      round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY k.price))::int,
      round(percentile_cont(0.75) WITHIN GROUP (ORDER BY k.price))::int,
      now()
    FROM (
      SELECT ${SEGMENT_SQL} AS segment, l.price, l."sellerId", m.facet, m.val
      FROM "Listing" l
      JOIN "Category" c ON c.id = l."categoryId"
      JOIN jsonb_to_recordset(${JSON.stringify(fallbackMapRows())}::jsonb)
             AS m(cat text, sub text, facet text, val text, pattern text)
        ON m.cat = ${TRIM('c.slug')} AND m.sub = ${TRIM('l."subcategorySlug"')}
       AND (m.facet IS NULL OR substring(l.attributes from m.pattern) = m.val)
      WHERE ${SALE_ELIGIBLE_SQL} ${sellerScopeSql(scope)}
    ) k
    GROUP BY k.segment, k.facet, k.val
    HAVING count(*) >= ${PRICE_STAT_MIN_SAMPLE} AND count(DISTINCT k."sellerId") >= ${FALLBACK_MIN_SELLERS}
    ON CONFLICT ("brandSlug", model, segment)
      DO UPDATE SET n = EXCLUDED.n, p25 = EXCLUDED.p25, median = EXCLUDED.median,
                    p75 = EXCLUDED.p75, "updatedAt" = now()
  `
}

// ── THE READ SIDE ─────────────────────────────────────────────────────────────────────────────

/** A PriceStat row as the reader selects it. Numbers arrive as numbers from INT columns; Number() keeps
 *  a driver that hands back strings or bigints from changing the arithmetic. */
export type PriceStatRow = { brandSlug: string; model: string; n: unknown; p25: unknown; median: unknown; p75: unknown }

function bandFrom(row: PriceStatRow, basis: PriceBandBasis): PriceBand | null {
  const band = { n: Number(row.n), p25: Number(row.p25), median: Number(row.median), p75: Number(row.p75) }
  if (![band.n, band.p25, band.median, band.p75].every(Number.isFinite)) return null
  if (band.n < PRICE_STAT_MIN_SAMPLE) return null
  // Too-wide band → not an actionable benchmark (a "range" of 7tr–40tr tells the buyer nothing).
  if (band.p75 > band.p25 * PRICE_STAT_MAX_SPREAD) return null
  return { ...band, basis }
}

/**
 * Which band a listing gets, from the PriceStat rows that matched its keys. Pure, so the selection
 * rule is tested without a database.
 *
 *  1. THE BRAND+MODEL BAND, WHEN IT HAS DATA (a row with n ≥ PRICE_STAT_MIN_SAMPLE). It is the
 *     answer even when the answer is "nothing": a same-model group too spread out to pass the 3x
 *     guard does NOT fall back — the fallback is a coarser comparison than the one that already
 *     failed, so its spread could only be an artefact of mixing more unlike things. (Same rule as
 *     price-guidance.ts: "STEP 4 DOES NOT WIDEN AND RETRY".)
 *  2. Otherwise THE FALLBACK band for `fallbackKey`, under the same n and spread rules.
 */
export function pickPriceBand(
  rows: readonly PriceStatRow[],
  keys: { brandSlug: string | null; model: string | null; fallbackKey: string | null },
): PriceBand | null {
  const own = keys.brandSlug && keys.model
    ? rows.find((r) => r.brandSlug === keys.brandSlug && r.model === keys.model)
    : undefined
  if (own && Number(own.n) >= PRICE_STAT_MIN_SAMPLE) return bandFrom(own, 'model')
  const similar = keys.fallbackKey
    ? rows.find((r) => r.brandSlug === FALLBACK_BRAND_KEY && r.model === keys.fallbackKey)
    : undefined
  return similar ? bandFrom(similar, 'similar') : null
}

/** The market band for a listing — its (brand, model, shelf, segment) band, or, when that has no data,
 *  its fallback band — or null when there is no reliable one (no subcategory, not a sale, or a segment
 *  below the sample floor: we show nothing rather than a range built on a couple of listings).
 *  ONE query for both keys. Fail-safe: any error → null. */
export async function getPriceBand(input: {
  brandSlug: string | null
  model: string | null
  categorySlug: string | null
  subcategorySlug: string | null
  listingType: string | null
  condition: string | null
  year: number | null
  /** `Listing.attributes` (the stored JSON text) or a form's facet values — read only for the fallback's
   *  facet (price-fallback.ts). Absent → a facet shelf has no fallback band. */
  attributes?: string | Record<string, unknown> | null
}): Promise<PriceBand | null> {
  if (input.listingType !== SALE_LISTING_TYPE) return null
  const segment = listingSegment(input)
  if (!segment) return null
  // The sentinel is never a brand: a caller handing it in (the guidance API takes a raw brandSlug) is
  // asking for no brand+model band, not for a fallback row under the wrong basis.
  const brandSlug = input.brandSlug && input.brandSlug !== FALLBACK_BRAND_KEY ? input.brandSlug : null
  const model = brandSlug && input.model ? input.model : null
  const fallbackKey = fallbackBandKey(input)
  if (!model && !fallbackKey) return null
  const wanted: Prisma.Sql[] = []
  if (model) wanted.push(Prisma.sql`("brandSlug" = ${brandSlug} AND model = ${model})`)
  if (fallbackKey) wanted.push(Prisma.sql`("brandSlug" = ${FALLBACK_BRAND_KEY} AND model = ${fallbackKey})`)
  try {
    const rows = await db.$queryRaw<PriceStatRow[]>(Prisma.sql`
      SELECT "brandSlug", model, n, p25, median, p75 FROM "PriceStat"
      WHERE segment = ${segment} AND (${Prisma.join(wanted, ' OR ')})
      LIMIT 2
    `)
    return pickPriceBand(rows, { brandSlug, model, fallbackKey })
  } catch {
    return null
  }
}
