// ONE ADDITIVE INDEX for the feed's COUNTs (2026-09-23, audit M2). IDEMPOTENT — safe to re-run.
//
// Run:  node scripts/listing-count-index-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// WHY. Every public listing count carries `sellerId NOT IN (desk)` (the licensed marketplace may not
// count the visa/trip desk), and no index on "Listing" holds sellerId — so every count, index or
// not, had to visit the heap. Measured on production: the whole-feed total was a sequential scan of
// the 366 MB heap, 187 ms, and the single most expensive statement in the database (13% of all DB
// time, 2026-09-20 → 09-23). An index-only count over the same rows measured 36 ms. With sellerId in
// the key, both the whole-feed count and the per-category count can stay index-only.
//
// PROVEN ON A LOCAL COPY before it was proposed (prod's id/verified/status/categoryId/sellerId,
// padded to prod's 3.4 KB row width, Postgres 14): the planner chose an Index Only Scan with 0 heap
// fetches for both shapes — whole feed 492 → 21 ms, largest category 1,181 → 33 ms. The index is
// 840 kB: B-tree deduplication folds it, because there are only a few dozen sellers.
//
// It is declared in prisma/schema.prisma (`@@index([verified, status, categoryId, sellerId])`) under
// Prisma's default name, so a future `prisma migrate diff` sees it as expected rather than emitting
// a DROP INDEX for it.
//
// ⚠️ NOT A DEPLOY PREREQUISITE. Prisma does not read indexes at runtime; code on main runs the same
// with or without it. It only makes the counts cheaper.
//
// ⚠️ CONCURRENTLY, SO NO WRITE LOCK — and therefore NOT in a transaction (Postgres refuses). A
// CONCURRENTLY build that fails leaves an INVALID index behind, and `IF NOT EXISTS` would then skip
// the rebuild and report success over an index the planner never uses — so an INVALID leftover is
// dropped first and rebuilt in the same run, and validity is checked again at the end.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('Set DIRECT_URL (or DATABASE_URL) — read from .env')
  process.exit(1)
}
const NAME = 'Listing_verified_status_categoryId_sellerId_idx'
const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  // A server-side statement_timeout would kill the build half-way and leave it INVALID every run.
  await c.query('SET statement_timeout = 0')
  // …but the build WAITS for every open transaction that can see Listing, and one idle-in-transaction
  // session would hold it forever. Bound the wait instead: a timeout leaves an INVALID index, which
  // the next run drops and rebuilds (above) — re-run it in a quieter moment.
  await c.query(`SET lock_timeout = '2min'`)
  const IN_PUBLIC = `ic.relname = $1 AND ic.relnamespace = 'public'::regnamespace`
  const existing = await c.query(`SELECT i.indisvalid FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid WHERE ${IN_PUBLIC}`, [NAME])
  if (existing.rows[0] && !existing.rows[0].indisvalid) {
    console.warn(`${NAME} exists but is INVALID (a failed earlier build) — dropping it and rebuilding`)
    await c.query(`DROP INDEX CONCURRENTLY IF EXISTS public."${NAME}"`)
  }
  await c.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${NAME}" ON public."Listing" ("verified", "status", "categoryId", "sellerId")`)
  const after = await c.query(
    `SELECT i.indisvalid, pg_size_pretty(pg_relation_size(ic.oid)) AS size
       FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid WHERE ${IN_PUBLIC}`,
    [NAME],
  )
  if (!after.rows[0]?.indisvalid) {
    console.error(`${NAME} is not valid after the build — re-run this script (it drops and rebuilds an INVALID index)`)
    process.exitCode = 1 // not process.exit(): let `finally` close the connection
  } else {
    console.log(`${NAME} ready (${after.rows[0].size})`)
  }
} finally {
  await c.end()
}
