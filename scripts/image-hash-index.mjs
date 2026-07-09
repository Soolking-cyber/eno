// Cross-app image duplicate / stolen-photo index — pgvector bit-Hamming HNSW over every
// listing image's perceptual (dHash) hash. Prisma does NOT manage this (bit(64) + the
// bit_hamming_ops HNSW index are outside its schema), so — like profile_auth_fk and the
// partial unique indexes — it MUST be re-applied after any DB reset. IDEMPOTENT.
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/image-hash-index.mjs
//   (DIRECT_URL is read from .env — never hardcode the prod DB password here.)
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

const SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "ListingImageHash" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "listingId" TEXT NOT NULL REFERENCES "Listing"(id) ON DELETE CASCADE,
  "sellerId"  TEXT NOT NULL,
  hash        BIT(64) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ListingImageHash_listingId_idx" ON "ListingImageHash" ("listingId");
CREATE INDEX IF NOT EXISTS "ListingImageHash_sellerId_idx" ON "ListingImageHash" ("sellerId");
CREATE INDEX IF NOT EXISTS "ListingImageHash_hash_hnsw" ON "ListingImageHash" USING hnsw (hash bit_hamming_ops);
`

try {
  await client.connect()
  await client.query(SQL)
  console.log('✓ ListingImageHash (pgvector bit-Hamming HNSW) ensured')
} catch (e) {
  console.error('image-hash-index failed:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
