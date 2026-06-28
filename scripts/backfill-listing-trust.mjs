// One-time backfill for the denormalized Listing.sellerTrustScore column (added with
// the trust-denormalization change). Run ONCE after `prisma db push` adds the column
// (existing rows land at the default 100). It copies each seller's current trustScore
// onto all of their listings so the feed's ORDER BY sellerTrustScore matches reality.
//
// Uses raw pg (not the Prisma client) to match the repo's script convention and avoid
// the Prisma 7 generated-client path. Idempotent + cheap: a single UPDATE ... FROM that
// only touches out-of-sync rows. The live dual-write in src/lib/trust.ts keeps it current.
//
//   set -a; . ./.env; set +a; node scripts/backfill-listing-trust.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()
const res = await client.query(
  `UPDATE "Listing" l SET "sellerTrustScore" = s."trustScore"
   FROM "Seller" s
   WHERE l."sellerId" = s.id AND l."sellerTrustScore" IS DISTINCT FROM s."trustScore"`,
)
console.log(`synced sellerTrustScore on ${res.rowCount} listing(s)`)
await client.end()
