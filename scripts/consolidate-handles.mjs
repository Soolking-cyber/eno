// One handle per account (backfill for existing data).
//
// Before: a business/seller account could hold TWO handles — a personal one on the
// Profile (auto-claimed at signup) AND a shop one on the Seller (auto-claimed on first
// listing / going business). Going forward src/lib/handle.ts#consolidateSellerHandle
// prevents this; this script fixes accounts created before that.
//
// Rule: when a Profile owns a Seller, the account's single handle lives on the SELLER.
//   1. TRANSFER — if the seller has no handle, move the profile's handle to it.
//   2. DEDUPE   — if the seller already has a handle, drop the profile's.
// Individuals with no storefront keep their personal handle untouched.
//
// Run:  cd /Users/mk1e3/eno.vn && set -a; . ./.env; set +a; node scripts/consolidate-handles.mjs
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()

  const before = (await c.query(`
    SELECT count(*)::int AS n
    FROM "Handle" h
    JOIN "Seller" s ON s."ownerId" = h."profileId"
    WHERE h."profileId" IS NOT NULL
  `)).rows[0].n
  console.log(`profiles that own a storefront AND still hold a personal handle: ${before}`)

  // 1. Transfer the profile handle to the seller when the seller has none (keeps the
  //    clean name on the shop). One seller per owner in practice.
  const moved = await c.query(`
    UPDATE "Handle" h
    SET "sellerId" = s.id, "profileId" = NULL
    FROM "Seller" s
    WHERE h."profileId" IS NOT NULL
      AND s."ownerId" = h."profileId"
      AND NOT EXISTS (SELECT 1 FROM "Handle" sh WHERE sh."sellerId" = s.id)
  `)
  console.log(`transferred profile→shop: ${moved.rowCount}`)

  // 2. Drop the leftover profile handle when the seller already has its own.
  const dropped = await c.query(`
    DELETE FROM "Handle" h
    USING "Seller" s, "Handle" sh
    WHERE h."profileId" IS NOT NULL
      AND s."ownerId" = h."profileId"
      AND sh."sellerId" = s.id
  `)
  console.log(`dropped duplicate profile handles: ${dropped.rowCount}`)

  const after = (await c.query(`
    SELECT count(*)::int AS n
    FROM "Handle" h
    JOIN "Seller" s ON s."ownerId" = h."profileId"
    WHERE h."profileId" IS NOT NULL
  `)).rows[0].n
  console.log(`remaining storefront-owners with a personal handle (should be 0): ${after}`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
