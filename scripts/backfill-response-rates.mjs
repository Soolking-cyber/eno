// Real response-rate DDL + one-shot backfill. Idempotent — safe to re-run.
//
// Does THREE things, in the only safe order:
//   1. DDL: adds Seller."responseMetricAt" + Profile."lastSeenAt" (both nullable,
//      additive — prisma db push can't run here because of the public.Profile ->
//      auth.users cross-schema FK, same as every hand-DDL script in this dir).
//   2. Runs the SAME recompute SQL as src/lib/response-rate.ts once, so real
//      measured rates exist BEFORE any build with RESPONSE_METRIC_IS_REAL=true
//      serves traffic. ⚠️ If you edit the SQL there, mirror it here.
//   3. Prints the written distribution so the "non-100 spread" check is a read-out,
//      not an eyeball of raw rows: sellers written, rate histogram, responseTime
//      breakdown. Sellers below the 5-conversation floor are NEVER written — they
//      keep responseMetricAt NULL, which is exactly what display+trust gate on.
//
//   set -a; . ./.env; set +a; node scripts/backfill-response-rates.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

try {
  await client.query('begin')

  await client.query(`alter table public."Seller" add column if not exists "responseMetricAt" timestamp(3);`)
  await client.query(`alter table public."Profile" add column if not exists "lastSeenAt" timestamp(3);`)

  const { rowCount } = await client.query(`
    WITH conv AS (
      SELECT c."sellerId",
             c."createdAt" AS opened_at,
             (SELECT MIN(m."createdAt") FROM "Message" m
               WHERE m."conversationId" = c.id
                 AND m."senderProfileId" <> c."buyerProfileId"
                 AND m.kind IN ('text', 'offer')) AS reply_at
      FROM "Conversation" c
      WHERE c."createdAt" >= now() - interval '90 days'
        AND c."createdAt" < now() - interval '24 hours'
    ),
    agg AS (
      SELECT "sellerId",
             count(*) AS n,
             count(*) FILTER (
               WHERE reply_at IS NOT NULL
                 AND reply_at - opened_at <= interval '24 hours') AS replied,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (reply_at - opened_at))
               FILTER (WHERE reply_at IS NOT NULL) AS median_gap
      FROM conv GROUP BY "sellerId"
    )
    UPDATE "Seller" s
    SET "responseRate" = round(100.0 * a.replied / a.n)::int,
        "responseTime" = CASE
          WHEN a.median_gap <= interval '1 hour' THEN 'within an hour'
          WHEN a.median_gap <= interval '24 hours' THEN 'within a day'
          ELSE 'within a few days' END,
        "responseMetricAt" = now()
    FROM agg a
    WHERE s.id = a."sellerId" AND a.n >= 5
  `)

  // Mirror of the nightly receipt sweep (response-rate.ts): stale receipts mean the
  // seller left the eligible cohort — clear so display+trust fall back to suppressed.
  await client.query(`
    update public."Seller" set "responseMetricAt" = null
    where "responseMetricAt" < now() - interval '8 days'
  `)

  await client.query('commit')
  console.log(`sellers written: ${rowCount}`)

  const dist = await client.query(`
    select width_bucket("responseRate", 0, 100, 10) as bucket,
           min("responseRate") as lo, max("responseRate") as hi, count(*) as sellers
    from public."Seller" where "responseMetricAt" is not null
    group by 1 order by 1
  `)
  console.log('rate distribution (measured sellers only):')
  for (const r of dist.rows) console.log(`  ${String(r.lo).padStart(3)}–${String(r.hi).padEnd(3)}: ${r.sellers}`)

  const times = await client.query(`
    select "responseTime", count(*) as sellers from public."Seller"
    where "responseMetricAt" is not null group by 1 order by 2 desc
  `)
  console.log('responseTime breakdown:')
  for (const r of times.rows) console.log(`  ${r.responseTime}: ${r.sellers}`)

  const unmeasured = await client.query(`
    select count(*) as n from public."Seller" where "responseMetricAt" is null
  `)
  console.log(`unmeasured sellers (stay suppressed): ${unmeasured.rows[0].n}`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  throw e
} finally {
  await client.end()
}
