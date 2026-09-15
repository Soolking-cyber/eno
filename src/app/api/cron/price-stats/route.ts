import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { PRICE_STAT_MIN_SAMPLE, PRICE_STAT_MAX_SPREAD, SALE_LISTING_TYPE } from '@/lib/price-stat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Market-price benchmarks (Vercel Cron → vercel.json). Guarded by CRON_SECRET. Recomputes the
// robust percentile band (P25 / median / P75) for every brand+model+segment that has at least
// MIN_SAMPLE active listings, in ONE aggregate upsert. Segment = condition, plus a 2-year band
// when the listing has a `year` (vehicles) — so "Honda Wave (used, 2018–2019)" is its own row.
// P-percentiles (not mean) shrug off scam/typo outliers. Stale segments (dropped below the
// sample floor) are pruned so the PDP never shows an out-of-date band.
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`. One of five byte-identical `bearerOk()` copies, now a single
// timing-safe comparison in `src/lib/api/handler.ts`. Both branches unchanged:
//   · unset CRON_SECRET, or a missing/malformed/wrong Bearer token → `{"error":"forbidden"}` 401
//   · success → `{"ok":true,"segments":…,"pruned":…,"positioned":…}` 200
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, AS A SHAPE: any unhandled throw in this handler now returns
// `{"error":"internal_error"}` 500 instead of Next's default 500 HTML. There is no try/catch here
// at all — the two `$executeRaw` calls and the `$transaction` are bare — so this is the live
// behaviour on a DB error, not a hypothetical.
/**
 * The segment, in SQL, for a `"Listing" l JOIN "Category" c`. ⛔ MUST MATCH listingSegment() in
 * src/lib/price-stat.ts character for character — `<category>/<subcategory>|<condition>[:<year band>]`
 * — and price-stat.test.ts pins the TS half, having been checked against this SQL on every production
 * row when the key changed (27,133 rows, 0 mismatches — the test's header records the method; nothing
 * in CI executes this expression, so a change HERE must be re-measured the same way).
 * The shelf is in the key so a phone case is never banded with the phone it fits; see listingSegment()
 * for the measured cases that made it necessary.
 * ⚠️ regexp_replace ON `\s`, NOT btrim — btrim's default set is the SPACE CHARACTER ONLY, while the TS
 * side's String.trim() also eats tabs and newlines. A subcategory stored as "\tphone-cases" would then
 * be filed under one key by the cron and read under another by the PDP, and the band would silently
 * never render (astra). Postgres `\s` in a regex is the whitespace class, which is the same intent.
 * NULLIF(…,'') because a whitespace-only condition must read as 'any' on both sides.
 */
const TRIM = (col: string) => Prisma.raw(`regexp_replace(${col}, '^\\s+|\\s+$', '', 'g')`)
const SEGMENT_SQL = Prisma.sql`(${TRIM('c.slug')} || '/' || ${TRIM('l."subcategorySlug"')} || '|' || COALESCE(NULLIF(${TRIM('l.condition')}, ''), 'any')
  || CASE WHEN l.year IS NOT NULL THEN ':' || ((l.year / 2) * 2)::text ELSE '' END)`

/**
 * Which listings may form a band AND be judged against one. ONE predicate for both statements —
 * the positioning UPDATE used to omit `verified` and `currency`, so a listing that could never be
 * part of a band could still be badged by one (a non-₫ price compared with đồng percentiles).
 * No subcategory → no band (listingSegment returns null for it too), and SALE only — a band is a sale
 * price, so a monthly rental neither forms one nor is judged by one (see SALE_LISTING_TYPE).
 */
const ELIGIBLE_SQL = Prisma.sql`l.status = 'active' AND l.verified = true
  AND l."brandSlug" IS NOT NULL AND l.model IS NOT NULL
  AND NULLIF(${TRIM('l."subcategorySlug"')}, '') IS NOT NULL
  AND l."listingType" = ${SALE_LISTING_TYPE}
  AND l.currency = '₫' AND l.price > 0`

export const GET = route({ auth: 'cron' }, async () => {
  const upserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO "PriceStat" ("brandSlug", model, segment, n, p25, median, p75, "updatedAt")
    SELECT
      l."brandSlug",
      l.model,
      ${SEGMENT_SQL} AS segment,
      count(*)::int,
      round(percentile_cont(0.25) WITHIN GROUP (ORDER BY l.price))::int,
      round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY l.price))::int,
      round(percentile_cont(0.75) WITHIN GROUP (ORDER BY l.price))::int,
      now()
    FROM "Listing" l
    JOIN "Category" c ON c.id = l."categoryId"
    WHERE ${ELIGIBLE_SQL}
    GROUP BY l."brandSlug", l.model, segment
    HAVING count(*) >= ${PRICE_STAT_MIN_SAMPLE}
    ON CONFLICT ("brandSlug", model, segment)
      DO UPDATE SET n = EXCLUDED.n, p25 = EXCLUDED.p25, median = EXCLUDED.median,
                    p75 = EXCLUDED.p75, "updatedAt" = now()
  `)
  // Prune segments that weren't refreshed this run (fell below the sample floor / went stale).
  // ⚠️ This is also what retires the pre-2026-09-15 keys (condition-only, no shelf): no reader asks
  // for them any more and they stop being refreshed, so they age out here within 36 hours.
  const removed = await db.$executeRaw(Prisma.sql`
    DELETE FROM "PriceStat" WHERE "updatedAt" < now() - interval '36 hours'
  `)

  // Denormalize each active listing's position vs its band onto Listing.marketPosition so the
  // feed can badge "Good price" without a per-render PriceStat join. Clear first (a listing whose
  // band vanished or whose price moved out of 'low' must lose its badge), then set from the bands
  // that pass the min-spread guard — never badge off a uselessly-wide "range". Segment expression
  // MUST match listingSegment() / the upsert above.
  const [, positioned] = await db.$transaction([
    db.$executeRaw(Prisma.sql`
    UPDATE "Listing" SET "marketPosition" = NULL
    WHERE status = 'active' AND "marketPosition" IS NOT NULL
  `),
    db.$executeRaw(Prisma.sql`
    UPDATE "Listing" l SET "marketPosition" =
      CASE WHEN l.price < ps.p25 THEN 'low' WHEN l.price > ps.p75 THEN 'high' ELSE 'typical' END
    FROM "PriceStat" ps, "Category" c
    WHERE c.id = l."categoryId" AND ${ELIGIBLE_SQL}
      AND l."brandSlug" = ps."brandSlug" AND l.model = ps.model
      AND ps.segment = ${SEGMENT_SQL}
      AND ps.p75 <= ps.p25 * ${PRICE_STAT_MAX_SPREAD}
  `),
  ])

  return { ok: true, segments: upserted, pruned: removed, positioned }
})
