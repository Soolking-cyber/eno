// ⛔ SUPERSEDED 2026-10-17 — this script builds NOTHING and exits 1 (so an old runbook line fails, never reports
// success); the note at the end says where the index went. Everything above that note is history.
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
//
// ⛔ SUPERSEDED 2026-10-17 (speed plan item 9). Listing_verified_status_categoryId_sellerId_idx was replaced by the partial Listing_live_categoryId_sellerId_idx
// (… AND verified AND status = 'active') in scripts/listing-index-diet-ddl.mjs, which also DROPS Listing_verified_status_categoryId_sellerId_idx.
// Running the old body would rebuild a full index over 141k rows to serve 2k live ones — so this file now does nothing
// but say where the index lives. The history above stays because it explains WHY the index exists.
console.error('Listing_verified_status_categoryId_sellerId_idx is superseded by Listing_live_categoryId_sellerId_idx: node scripts/listing-index-diet-ddl.mjs --phase=create')
process.exitCode = 1
