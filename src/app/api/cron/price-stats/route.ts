import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { PRICE_STAT_MIN_SAMPLE, PRICE_STAT_MAX_SPREAD } from '@/lib/price-stat'

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
export const GET = route({ auth: 'cron' }, async () => {
  const upserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO "PriceStat" ("brandSlug", model, segment, n, p25, median, p75, "updatedAt")
    SELECT
      "brandSlug",
      model,
      COALESCE(condition, 'any') || CASE WHEN year IS NOT NULL THEN ':' || ((year / 2) * 2)::text ELSE '' END AS segment,
      count(*)::int,
      round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::int,
      round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY price))::int,
      round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::int,
      now()
    FROM "Listing"
    WHERE status = 'active' AND verified = true
      AND "brandSlug" IS NOT NULL AND model IS NOT NULL
      AND currency = '₫' AND price > 0
    GROUP BY "brandSlug", model, segment
    HAVING count(*) >= ${PRICE_STAT_MIN_SAMPLE}
    ON CONFLICT ("brandSlug", model, segment)
      DO UPDATE SET n = EXCLUDED.n, p25 = EXCLUDED.p25, median = EXCLUDED.median,
                    p75 = EXCLUDED.p75, "updatedAt" = now()
  `)
  // Prune segments that weren't refreshed this run (fell below the sample floor / went stale).
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
    FROM "PriceStat" ps
    WHERE l.status = 'active' AND l.price > 0
      AND l."brandSlug" = ps."brandSlug" AND l.model = ps.model
      AND ps.segment = COALESCE(l.condition, 'any') || CASE WHEN l.year IS NOT NULL THEN ':' || ((l.year / 2) * 2)::text ELSE '' END
      AND ps.p75 <= ps.p25 * ${PRICE_STAT_MAX_SPREAD}
  `),
  ])

  return { ok: true, segments: upserted, pruned: removed, positioned }
})
