// Sale attribution on Listing — when a seller marks a listing sold via the native
// confirm sheet, they record WHO they sold to: an in-app buyer (from a conversation)
// or an external marketplace they type in. All nullable, additive, no FK → safe
// outside the profile_auth_fk push flow (same class as marketPosition/video).
// Mirrored in prisma/schema.prisma on the Listing model. IDEMPOTENT — re-apply after
// any DB reset.
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/sold-attribution-cols.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

const SQL = `
-- 'eno' (an in-app buyer picked from a conversation) | 'external' (sold elsewhere) | null.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "soldChannel" TEXT;
-- The in-app buyer's Profile id, when soldChannel='eno'. Scalar (no FK): display name
-- is resolved at read time; a deleted buyer just leaves a dangling id, never blocks.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "soldToProfileId" UUID;
-- Free text external marketplace ("Facebook", "Chợ Tốt", "in person"…), when external.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "soldPlatform" TEXT;
-- When the seller marked it sold. TIMESTAMP(3) WITHOUT time zone to match Prisma's
-- default for a plain \`DateTime\` (all the other Listing datetimes are this type) —
-- a timestamptz here would read as schema drift on the next \`prisma db push\`.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "soldAt" TIMESTAMP(3);
-- Reconcile: an earlier version created this as timestamptz. Safe (the column is
-- new/empty); a no-op once it's already timestamp(3).
ALTER TABLE "Listing" ALTER COLUMN "soldAt" TYPE TIMESTAMP(3) USING "soldAt"::timestamp(3);
`

try {
  await client.connect()
  await client.query(SQL)
  console.log('✓ sold-attribution columns applied (soldChannel, soldToProfileId, soldPlatform, soldAt)')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
