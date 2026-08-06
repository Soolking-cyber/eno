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

/** Segment key — MUST stay identical to the cron's SQL: condition, plus a 2-year band when a
 *  year is present (vehicles). year 2015 → band 2014; null year → condition only. */
export function listingSegment(condition: string | null | undefined, year: number | null | undefined): string {
  // ⚠️ `|| 'any'` maps BOTH null and '' to 'any'; the SQL twin uses COALESCE(condition,'any'),
  // which substitutes only NULL and leaves '' as ''. A whitespace-only condition from the partner
  // sync trims to '' and is stored, so the cron filed those rows under ':2018' while every reader
  // asked for 'any:2018' and missed — the band silently never rendered. Normalising here makes the
  // two sides agree on emptiness, which is what the note above requires of this pair.
  const c = (condition || '').trim() || 'any'
  return year != null ? `${c}:${Math.floor(year / 2) * 2}` : c
}

/** The market band for a listing's (brand, model, segment), or null when there is no reliable
 *  one — no brand/model, or the segment is below the sample floor (we show nothing rather than
 *  a range built on a couple of listings). Fail-safe: any error → null (module just hides). */
export async function getPriceBand(input: {
  brandSlug: string | null
  model: string | null
  condition: string | null
  year: number | null
}): Promise<PriceBand | null> {
  if (!input.brandSlug || !input.model) return null
  try {
    const segment = listingSegment(input.condition, input.year)
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
