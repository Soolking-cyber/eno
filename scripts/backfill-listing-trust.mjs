// One-time backfill for the denormalized Listing.sellerTrustScore column (added with
// the trust-denormalization change). Run ONCE after `prisma db push` adds the column
// (existing rows land at the default 100). It copies each seller's current trustScore
// onto all of their listings so the feed's ORDER BY sellerTrustScore matches reality.
//
// Idempotent + cheap: a single UPDATE ... FROM, only touching rows that are out of
// sync. After this, the live dual-write in src/lib/trust.ts keeps it current.
//
//   node scripts/backfill-listing-trust.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const n = await db.$executeRawUnsafe(
  `UPDATE "Listing" l SET "sellerTrustScore" = s."trustScore"
   FROM "Seller" s
   WHERE l."sellerId" = s.id AND l."sellerTrustScore" IS DISTINCT FROM s."trustScore"`,
)
console.log(`synced sellerTrustScore on ${n} listing(s)`)
await db.$disconnect()
