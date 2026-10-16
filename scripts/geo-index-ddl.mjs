// ⛔ SUPERSEDED 2026-10-17 — this script builds NOTHING and exits 1 (so an old runbook line fails, never reports
// success); the note at the end says where the index went. Everything above that note is history.
// ONE ADDITIVE INDEX for the map's radius search. IDEMPOTENT — safe to re-run.
//
// Run:  node scripts/geo-index-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// WHY. `src/lib/geo-radius.ts` answers "search this area" with a lat/lng BOUNDING BOX — two range
// predicates, which is exactly what a composite B-tree on (lat, lng) serves. Without it the box
// scans the whole 366 MB heap on every area search, FOUR times per request (the feed, the total,
// the price histogram and the sub-category facet counts all share that `where`), which would make
// the new filter slower than the broken client-side one it replaces.
//
// Measured on production with this index in place, from Thảo Điền: an Index Scan using
// Listing_lat_lng_idx, 1,769 rows in 12 ms for a 3 km box.
//
// ⚠️ PARTIAL, ON `lat IS NOT NULL AND lng IS NOT NULL`, AND THE SAVING IS MEASURED. Of 108,810
// rows on production only 33,621 carry a coordinate — 31% — so the partial index covers a third of
// the table. A listing with no coordinate can never be inside a circle and the query says so
// explicitly, so those rows have no business in the index.
//
// ⛔ AND THAT IS WHY IT IS **NOT** DECLARED IN prisma/schema.prisma, unlike the count index next to
// it. Prisma cannot express a partial index, so declaring it would describe a DIFFERENT index and
// `prisma migrate diff` would churn. Left undeclared, that diff instead proposes a `DROP INDEX` for
// it — which the safe flow in CLAUDE.md already refuses on sight ("reject ANY DROP"), so the guard
// is in place. Whoever next runs that flow: this DROP is expected, and dropping it costs the radius
// search its index rather than corrupting anything. Re-run this script afterwards.
//
// ⚠️ LEADING COLUMN IS `lat` AND THAT IS DELIBERATE, not alphabetical. Postgres uses the leading
// column of a composite B-tree for a range scan and treats the second as a filter on the rows it
// finds, so the ordering matters: Vietnam spans ~15 degrees of latitude against ~8 of longitude at
// the populated latitudes, so `lat` is the more selective of the two for a small box.
//
// ⚠️ NOT A DEPLOY PREREQUISITE. Prisma does not read indexes at runtime; the radius filter returns
// the same rows with or without it, only slower. Apply it before the feature carries real traffic.
//
// ⚠️ CONCURRENTLY, SO NO WRITE LOCK — and therefore NOT in a transaction (Postgres refuses). A
// CONCURRENTLY build that fails leaves an INVALID index behind, and `IF NOT EXISTS` would then skip
// the rebuild and report success over an index the planner never uses — so an INVALID leftover is
// dropped first and rebuilt in the same run, and validity is checked again at the end.
//
// ⛔ SUPERSEDED 2026-10-17 (speed plan item 9). Listing_lat_lng_idx was replaced by the partial Listing_live_lat_lng_idx
// (… AND verified AND status = 'active') in scripts/listing-index-diet-ddl.mjs, which also DROPS Listing_lat_lng_idx.
// Running the old body would rebuild a full index over 141k rows to serve 2k live ones — so this file now does nothing
// but say where the index lives. The history above stays because it explains WHY the index exists.
console.error('Listing_lat_lng_idx is superseded by Listing_live_lat_lng_idx: node scripts/listing-index-diet-ddl.mjs --phase=create')
process.exitCode = 1
