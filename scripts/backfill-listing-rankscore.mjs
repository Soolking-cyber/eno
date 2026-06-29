// One-time backfill for the denormalized Listing.rankScore column (added with the balanced
// search/feed ranking). Run ONCE after `prisma db push` adds the column (existing rows land
// at the default 0, which would sort them LAST). This computes the blended trust⊕recency
// rankScore for every listing — the SAME formula as the SQL re-decay in src/lib/ranking.ts
// (SET_RANK_SCORE) — so the feed orders correctly immediately. The daily cron + the live
// dual-write (create/bump/trust-change) keep it current afterwards.
//
// Uses raw pg (not the Prisma 7 generated client) to match the repo's script convention.
// Keep the numeric weights in sync with RANK in src/lib/ranking.ts.
//
//   set -a; . ./.env; set +a; node scripts/backfill-listing-rankscore.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

// Mirror of RANK in src/lib/ranking.ts — BROWSE_TRUST_W=0.5, BROWSE_RECENCY_W=0.5,
// TRUST_FLOOR=40, TRUST_SPAN=120, DECAY_DAYS=14, FEATURED_BOOST=0.15.
const client = new pg.Client({ connectionString: url })
await client.connect()
const res = await client.query(
  `UPDATE "Listing" SET "rankScore" =
     0.5 * LEAST(GREATEST(("sellerTrustScore"::float - 40) / 120, 0), 1)
     + 0.5 * EXP(- GREATEST(EXTRACT(EPOCH FROM (now() - "postedAt")), 0) / 86400.0 / 14)
     + CASE WHEN "featured" THEN 0.15 ELSE 0 END`,
)
console.log(`backfilled rankScore on ${res.rowCount} listing(s)`)
await client.end()
