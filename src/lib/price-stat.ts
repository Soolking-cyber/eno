import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

// Market-price benchmark read side (write side = /api/cron/price-stats). Given a listing's
// brand/model/condition/year, return the robust P25–median–P75 band for its segment so the PDP
// can show the buyer where the asking price stands.

export const PRICE_STAT_MIN_SAMPLE = 5
// A band whose top is more than this × its bottom is too noisy to be an actionable benchmark
// (e.g. a seed group that mixes new + used + all years → 7tr–40tr). Suppress it. Kept in sync
// with the cron's marketPosition update so a card is never badged off a uselessly-wide band.
export const PRICE_STAT_MAX_SPREAD = 3

export type PriceBand = { n: number; p25: number; median: number; p75: number }

/**
 * ⛔ A BAND IS A SALE PRICE, SO ONLY SALE LISTINGS FORM ONE OR ARE JUDGED BY ONE. Rent is charged per
 * month and "wanted" states a budget; either in the same distribution makes both numbers a fiction —
 * a ₫4m monthly rental would read as a spectacular deal against ₫40m purchase prices (astra). Today
 * every branded listing is `sell`, so this changes nothing yet and prevents the day it would.
 * The cron's ELIGIBLE_SQL uses this same value.
 */
export const SALE_LISTING_TYPE = 'sell'

/**
 * Segment key — MUST stay identical to the cron's SQL (`SEGMENT_SQL` in /api/cron/price-stats):
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

/** The market band for a listing's (brand, model, shelf, segment), or null when there is no
 *  reliable one — no brand/model/subcategory, or the segment is below the sample floor (we show
 *  nothing rather than a range built on a couple of listings). Fail-safe: any error → null. */
export async function getPriceBand(input: {
  brandSlug: string | null
  model: string | null
  categorySlug: string | null
  subcategorySlug: string | null
  listingType: string | null
  condition: string | null
  year: number | null
}): Promise<PriceBand | null> {
  if (!input.brandSlug || !input.model) return null
  if (input.listingType !== SALE_LISTING_TYPE) return null
  const segment = listingSegment(input)
  if (!segment) return null
  try {
    const rows = await db.$queryRaw<PriceBand[]>(Prisma.sql`
      SELECT n, p25, median, p75 FROM "PriceStat"
      WHERE "brandSlug" = ${input.brandSlug} AND model = ${input.model} AND segment = ${segment}
      LIMIT 1
    `)
    const b = rows[0]
    if (!b || Number(b.n) < PRICE_STAT_MIN_SAMPLE) return null
    // Too-wide band → not an actionable benchmark (a "range" of 7tr–40tr tells the buyer nothing).
    if (Number(b.p75) > Number(b.p25) * PRICE_STAT_MAX_SPREAD) return null
    return { n: Number(b.n), p25: Number(b.p25), median: Number(b.median), p75: Number(b.p75) }
  } catch {
    return null
  }
}
