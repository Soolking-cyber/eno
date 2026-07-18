// Launch prep: delete the mock/seed catalog from the LIVE database.
// Removes the ~2,520 "Sample mock listing for testing" rows + the 10 mock
// "seller-%" storefronts (+ all seed reviews, which have no real write path yet).
// Preserves real Profiles, real Sellers, real Listings, and the Category taxonomy.
//
// Uses raw pg (repo script convention) — the old `@prisma/client` import crashed on
// launch day duty: Prisma 7's `prisma-client` generator emits only src/generated/prisma,
// so `@prisma/client` is MODULE_NOT_FOUND in this repo (audit 2026-07-18, P0).
//
// Run:  set -a; . ./.env; set +a; node scripts/purge-mock.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const MARKER = 'Sample mock listing for testing'

const one = async (sql, params) => Number((await client.query(sql, params)).rows[0].n)
const count = async () => ({
  listings: await one('select count(*)::int as n from "Listing"'),
  mockListings: await one('select count(*)::int as n from "Listing" where description like $1', [`%${MARKER}%`]),
  sellers: await one('select count(*)::int as n from "Seller"'),
  mockSellers: await one(`select count(*)::int as n from "Seller" where id like 'seller-%'`),
  reviews: await one('select count(*)::int as n from "Review"'),
})

console.log('BEFORE:', await count())

// FK-safe order (mirrors prisma/seed.ts wipe): reviews -> listings -> sellers.
// All reviews are seed data (no buyer-review write path exists yet) -> safe to clear.
const rev = await client.query('delete from "Review"')
const lis = await client.query('delete from "Listing" where description like $1', [`%${MARKER}%`])
const sel = await client.query(`delete from "Seller" where id like 'seller-%'`)

console.log('DELETED:', { reviews: rev.rowCount, mockListings: lis.rowCount, mockSellers: sel.rowCount })
console.log('AFTER:', await count())
await client.end()
