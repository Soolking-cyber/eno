// THE LISTING INDEX DIET (speed plan item 9, 2026-10-17). IDEMPOTENT — every phase is safe to re-run.
//
// MEASURED on production 2026-10-16 (pg_stat_user_indexes / pg_stat_statements since 2026-09-20):
//   · "Listing" holds 141,032 rows and only 2,122 are live (verified AND status = 'active') — 1.5%. The rest are hidden
//     (82,830), expired (32,319), stale (21,113), sold (2,640). Heap 395 MB; 32 indexes = 500 MB, nearly all of it rows
//     no public query can return.
//   · Only 3.5% of its 2.2 M updates were HOT: every index on a column an UPDATE sets turns it into a new row version
//     plus one new entry in EVERY index. `views` (4 index scans in 26 days) blocked HOT for every counted view;
//     `sellerTrustScore` (two composites nobody filters or sorts by) for every trust change.
//   · The trigram GIN on searchText alone was 148 MB, for 1.5% of rows any PUBLIC search can match — but admin search
//     reads every status, and measured 150–800 ms per query without it (1–20 ms with): it stays (KEEP), and public search
//     gets a live copy.
// What changes:
//   1. Every index whose queries ALWAYS ask for live rows gets a PARTIAL copy `WHERE verified AND status = 'active'` — the
//      same columns, leading ones included (see CREATES), ~1.5% of the entries; a new row version of a non-live row (imports, hides, the 98.5%) gets no entry
//      in it. ⚠️ That does NOT make those updates HOT: Postgres blocks HOT for any column in any index's key, INCLUDE list
//      or predicate, live row or not — so rankScore, status and verified changes stay non-HOT. HOT comes back only where
//      the index on the changed column is DROPPED: `views` (every counted view) and `sellerTrustScore`.
//   2. Indexes with no consumer are dropped (views, complianceStatus, soldChannel…, city, condition, featured, the two
//      sellerTrustScore composites, verified+postedAt; ListingDailyStat(listingId) is a prefix of its own unique key;
//      Translation(target) — every lookup carries hash).
//   3. One new live index, (sellerId, rankScore DESC, id DESC), for the feed's per-seller "diversity window" reads.
// Every claim about who uses which index: ~/eno-perf-2026-10/item9/map.json (all 529 `.listing.*` call sites read).
//
// ⚠️ WHY PARTIAL INDEXES ARE USABLE FROM PRISMA: adapter-pg sends unnamed extended-protocol statements, which Postgres
// plans with the bound VALUES — `verified = $1 AND status = $2` with (true, 'active') proves the index predicate. The
// `verify` phase checks it on production rather than trusting it. The predicate is spelled exactly
// `verified AND status = 'active'` everywhere; another spelling may not be proven equal.
//
// PHASES (run in this order; each prints what it did):
//   --phase=create   build every index in CREATES (CONCURRENTLY: no write lock; an INVALID leftover from a failed build is
//                    dropped and rebuilt), then ANALYZE. Additive — nothing is removed. Each index is labelled (COMMENT)
//                    with a hash of the definition that built it, and a re-run REFUSES a label that differs: a definition
//                    is immutable once built — a changed one is a NEW name in CREATES, the old name going to DROPS.
//   --phase=verify   EXPLAIN the hot query shapes as PREPAREd statements with bound parameters (the way Prisma's
//                    statements are planned) — planned, not executed; exits 1 if any reads "Listing" sequentially.
//                    Read-only. --analyze executes them for timings (and so marks every index they use as used).
//                    ⚠️ Planning alone can mark one too: for a range beyond the column's histogram, the planner reads the
//                    actual min/max from a B-tree LED by that column (get_actual_variable_range) — the app's own map
//                    queries do the same to Listing_lat_lng_idx. Fail-safe (an index is kept, never dropped, by it); such
//                    an index is a --force=<name> decision once verify shows its shapes planned on the partial copy.
//   --phase=drop     runs verify first and stops on any sequential scan; then DROP INDEX CONCURRENTLY every index in DROPS
//                    that NO STATEMENT HAS SCANNED FOR UNUSED_DAYS (7) — Postgres's own record of each index's last scan,
//                    pg_stat_user_indexes.last_idx_scan (PG 16+; an older server fails the phase) — and, for a REPLACED one, only while all its
//                    replacements exist and are valid. So a replaced index goes a week after --phase=create moved its
//                    queries to the partial one, and an index anything still uses (a nightly job, admin search) stays.
//                    Prints each dropped index's definition first (pg_get_indexdef) — the restore; keep the output (tee it
//                    to a log). --force=<index>[,<index>…] drops the NAMED indexes despite a recent scan — one decision
//                    per index, never all at once; nothing overrides the replacement check, the sequential-scan stop, or
//                    a verify shape still planned on the index.
//   add --dry-run to print the SQL a phase would run and change nothing.
//   ⚠️ 2026-10-17 on production: the 16 REPLACED full indexes were retired early, on the owner's word, because the
//   planner TIES half the hot shapes between a full index and its identical copy and keeps the older one — so the
//   week-long evidence could never accrue. Instead: every copy checked valid and labelled; all 16 dropped inside one
//   transaction, every VERIFY shape planned, rolled back (54 ms of table lock; no shape read "Listing" sequentially);
//   then DROP INDEX CONCURRENTLY each, restore definitions logged (~/eno-perf-2026-10/item9/retire-apply.txt). 218.5 MB;
//   "Listing" indexes 493 → 274 MB. This phase now reports them "already gone".
//
// RUN — on the box, inside the app container, with the app's own DATABASE_URL (no secret is read or printed here):
//   ssh … root@162.4.176.233 'cat > /tmp/eno-index-diet.mjs' < scripts/listing-index-diet-ddl.mjs
//   ssh … root@162.4.176.233 'docker exec -i -w /app eno-vn-app node --input-type=module - --phase=create < /tmp/eno-index-diet.mjs \
//     | tee -a /var/log/eno-index-diet.log'
// …or from a checkout with DIRECT_URL (the other DDL scripts' way): node scripts/listing-index-diet-ddl.mjs --phase=create
// ⛔ Never through a transaction pooler (port 6543 / pgbouncer=true — refused): SET, PREPARE … EXECUTE and a concurrent
// build all need ONE session. The app container's DATABASE_URL is a direct connection.
// ⚠️ Keep clear of the 02:00 UTC daily-reminders cron (rank sweep + stat rollup) and the 03:00 UTC price-stats job.
//
// ⛔ THESE INDEXES ARE NOT IN prisma/schema.prisma — Prisma cannot declare a partial index — so `prisma migrate diff`
// will list them as DROP INDEX: the documented safe flow refuses every DROP (CLAUDE.md), so it never applies one. The
// indexes this script DROPS were removed from schema.prisma in the same commit, so a diff never re-proposes them.
import { createHash } from 'node:crypto'
import pg from 'pg'

export const LIVE = `verified AND status = 'active'`

/**
 * name → definition (after `ON`), and the old indexes it replaces (dropped by --phase=drop only once it is valid).
 * ⛔ A PARTIAL COPY HAS EXACTLY THE COLUMNS OF THE INDEX IT REPLACES — leading `verified, status` included, although the
 * predicate makes them constant. MEASURED 2026-10-17: copies without them were built and the planner kept choosing the
 * FULL indexes for the feed, category, subcategory, brand and range shapes. Postgres estimates an index's heap order from
 * its FIRST column's correlation: `verified` (near-constant) has 1.000, `rankScore` −0.25, `categoryId` 0.61 — so the
 * full index looked like sequential heap reads and the copy like random ones, for the same rows. With the same leading
 * column the smaller copy wins (probe-aligned.txt: feed page and feed total moved to it), the full index goes unscanned,
 * and the drop phase's week-long evidence can retire it. A copy that led with another column would keep its full index
 * scanned — and so kept — forever. src/lib/listing-index-diet.test.ts pins the full column list against each replaced
 * index's name. ⚠️ A DEFINITION CHANGE UNDER AN EXISTING NAME is refused by --phase=create wherever the old one was built
 * (its label differs): drop that copy by hand first — it only ever duplicated a full index that still exists.
 */
export const CREATES = [
  { name: 'Listing_live_rankScore_idx', def: `public."Listing" (verified, status, "rankScore") WHERE ${LIVE}`, replaces: ['Listing_verified_status_rankScore_idx'] },
  { name: 'Listing_live_categoryId_rankScore_idx', def: `public."Listing" (verified, status, "categoryId", "rankScore") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_rankScore_idx'] },
  { name: 'Listing_live_categoryId_sellerId_idx', def: `public."Listing" (verified, status, "categoryId", "sellerId") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_sellerId_idx'] },
  { name: 'Listing_live_categoryId_subcategorySlug_postedAt_idx', def: `public."Listing" (verified, status, "categoryId", "subcategorySlug", "postedAt") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_subcategorySlug_postedAt_idx'] },
  { name: 'Listing_live_categoryId_listingType_postedAt_idx', def: `public."Listing" (verified, status, "categoryId", "listingType", "postedAt") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_listingType_postedAt_idx'] },
  { name: 'Listing_live_categoryId_postedAt_idx', def: `public."Listing" (verified, "categoryId", "postedAt") WHERE ${LIVE}`, replaces: ['Listing_verified_categoryId_postedAt_idx'] },
  { name: 'Listing_live_brandSlug_model_idx', def: `public."Listing" (verified, status, "brandSlug", model) WHERE ${LIVE}`, replaces: ['Listing_verified_status_brandSlug_model_idx'] },
  { name: 'Listing_live_brandSlug_postedAt_idx', def: `public."Listing" (verified, status, "brandSlug", "postedAt") WHERE ${LIVE}`, replaces: ['Listing_verified_status_brandSlug_postedAt_idx'] },
  { name: 'Listing_live_price_idx', def: `public."Listing" (verified, price) WHERE ${LIVE}`, replaces: ['Listing_verified_price_idx'] },
  { name: 'Listing_live_categoryId_year_idx', def: `public."Listing" (verified, status, "categoryId", year) WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_year_idx'] },
  { name: 'Listing_live_categoryId_salaryM_idx', def: `public."Listing" (verified, status, "categoryId", "salaryM") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_salaryM_idx'] },
  { name: 'Listing_live_categoryId_mileageKm_idx', def: `public."Listing" (verified, status, "categoryId", "mileageKm") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_mileageKm_idx'] },
  { name: 'Listing_live_categoryId_areaM2_idx', def: `public."Listing" (verified, status, "categoryId", "areaM2") WHERE ${LIVE}`, replaces: ['Listing_verified_status_categoryId_areaM2_idx'] },
  // The keystroke search: every public search WHERE carries the live predicate (search-match, concierge, recommendations,
  // saved-search alerts), and this copy holds 1.5% of the rows the full GIN does. It REPLACES NOTHING: admin search reads
  // every status ('all' by default), and MEASURED 2026-10-17 costs 1–20 ms per query on the full GIN, 150–800 ms without
  // it (a sequential read of the 395 MB heap; a search runs a page AND a count) — so Listing_searchText_idx is in KEEP and
  // stays declared in prisma/schema.prisma. ~/eno-perf-2026-10/item9/probe-admin-dup.txt
  { name: 'Listing_live_searchText_trgm_idx', def: `public."Listing" USING gin ("searchText" gin_trgm_ops) WHERE ${LIVE}`, replaces: [] },
  { name: 'Listing_live_lat_lng_idx', def: `public."Listing" (lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL AND ${LIVE}`, replaces: ['Listing_lat_lng_idx'] },
  { name: 'Listing_live_buildingKey_idx', def: `public."Listing" ("buildingKey", status) WHERE "buildingKey" IS NOT NULL AND ${LIVE}`, replaces: ['Listing_buildingKey_status_idx'] },
  // Not a live query (status 'sold'): partial on the only rows it ever reads.
  { name: 'Listing_soldToProfileId_pending_idx', def: `public."Listing" ("soldToProfileId", "saleConfirmedAt", "saleDeclinedAt") WHERE "soldToProfileId" IS NOT NULL`, replaces: ['Listing_soldToProfileId_saleConfirmedAt_saleDeclinedAt_idx'] },
  // New: the feed's per-seller reads (diversity window, storefront own listings) walk ~6 entries instead of the feed.
  // INCLUDE the two columns the diversity window's seller pick also filters on (categoryId <> …, subcategorySlug NOT IN
  // …), so its MAX(rankScore) GROUP BY sellerId can be answered from the index (measured before: 21 ms, 9,717 buffers of
  // scattered heap). ⛔ Never INCLUDE views, contactCount or savedCount anywhere: an indexed column that a counter bumps
  // makes that UPDATE non-HOT again, which is half of what this diet is for.
  { name: 'Listing_live_seller_rank_idx', def: `public."Listing" ("sellerId", "rankScore" DESC, id DESC) INCLUDE ("categoryId", "subcategorySlug") WHERE ${LIVE}`, replaces: [] },
]

/** Dropped outright: no consumer needs them (evidence per index in map.json). */
export const DROP_UNUSED = [
  'Listing_views_idx',
  'Listing_complianceStatus_idx',
  'Listing_soldChannel_saleConfirmedAt_saleDeclinedAt_soldAt_idx',
  'Listing_city_idx',
  'Listing_condition_idx',
  'Listing_featured_idx',
  'Listing_verified_status_sellerTrustScore_postedAt_idx',
  'Listing_verified_status_categoryId_sellerTrustScore_postedA_idx',
  'Listing_verified_postedAt_idx',
  'ListingDailyStat_listingId_idx',
  'Translation_target_idx',
  // The full trigram GIN the old scripts/search-index.mjs created under its own name — not on production (checked
  // 2026-10-17), but a database where that script ran would keep a second full copy of what this diet removed.
  'listing_searchtext_trgm',
]

/** The per-table autovacuum the create phase sets (see there). */
export const AUTOVACUUM = 'autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02'

/** Never touched: FK targets, upsert keys, and the indexes any-status queries still need. */
export const KEEP = [
  'Listing_pkey', 'Listing_id_sellerId_key', 'Listing_sellerId_externalId_key', 'Listing_sellerId_saleConfirmedAt_idx',
  'Listing_categoryId_idx', 'Listing_verified_status_postedAt_idx', 'Listing_searchText_idx',
]

export const DROPS = [...DROP_UNUSED, ...CREATES.flatMap((c) => c.replaces)]

/**
 * How long an index must have gone without a single scan before --phase=drop removes it: a WEEK, so every daily cron (rank
 * sweep, stat rollup, price-stats, licence holds, tombstones) and every weekly job (apartments Mon 06:00, vehicle rentals,
 * digests) has had its chance to use it (gate review: 12 h could miss a nightly job).
 */
export const UNUSED_DAYS = 7

/**
 * Why an index in DROPS must stay (a sentence for the log), or null when no statement has scanned it for UNUSED_DAYS.
 * ⛔ THE EVIDENCE IS POSTGRES'S OWN RECORD — pg_stat_user_indexes.last_idx_scan — not anything this script writes (gate
 * review: "its replacement was used once" proved nothing about the old index; a counter this script stamped could be
 * restarted by a re-run). Whatever a statement's shape — a verified-only read a partial index cannot serve, a nightly job,
 * admin search — if it still uses the old index, the old index stays. "Never scanned" counts only when the statistics
 * themselves are older than the window (`statsReset`: pg_stat_database.stats_reset).
 */
export function keepReason({ chosenByVerify, lastScan, statsReset, now = Date.now() }) {
  const cutoff = now - UNUSED_DAYS * 86_400_000
  if (chosenByVerify) return 'a verify shape is still planned on it'
  if (lastScan) {
    const t = new Date(lastScan).getTime()
    return t > cutoff ? `last used ${new Date(t).toISOString()} — not ${UNUSED_DAYS} days unused yet` : null
  }
  if (statsReset && new Date(statsReset).getTime() <= cutoff) return null
  return `never scanned, but the statistics only go back to ${statsReset ? new Date(statsReset).toISOString() : 'an unknown time'}`
}

/** A transaction pooler (Supavisor / PgBouncer: port 6543, or pgbouncer=true) — refused, see RUN above. */
export const isPoolerUrl = (url) => /:6543(?:[/?]|$)/.test(url) || /[?&]pgbouncer=true(?:&|$)/.test(url)

/** The label a built index carries: which definition built it. */
export const defLabel = (def) => `eno-index-diet def=${createHash('sha256').update(def).digest('hex').slice(0, 16)}`

/**
 * The query shapes the diet must keep fast, run the way Prisma runs them: PREPARE … EXECUTE with `$n` parameters —
 * verified and status BOUND, never literals (gate review: a plan proven with literals proves nothing about Prisma's
 * statements). Postgres plans the first executions of a prepared statement with the bound values, as it plans every
 * unnamed extended-protocol statement adapter-pg sends. Each shape is `[label, sql with $1 = verified, $2 = status, $3 =
 * the desk ids (text[] → NOT IN via <> ALL), …, extra params]`; values are read from the data at run time.
 */
export const VERIFY = [
  ['feed total', `SELECT COUNT(*) FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[])`, []],
  ['category total', `SELECT COUNT(*) FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[]) AND "categoryId" = $4`, ['cat']],
  ['feed page by rank', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[]) ORDER BY "rankScore" DESC, id DESC LIMIT 24`, []],
  ['category page by rank', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 ORDER BY "rankScore" DESC, id DESC LIMIT 24`, ['cat']],
  ['subcategory page by date', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND "subcategorySlug" = $5 ORDER BY "postedAt" DESC LIMIT 24`, ['cat', 'sub']],
  ['listing-type page by date', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND "listingType" = $5 ORDER BY "postedAt" DESC LIMIT 24`, ['cat', 'ltype']],
  ['per-seller top listings', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" = $4 ORDER BY "rankScore" DESC, id DESC LIMIT 6`, ['sel']],
  ['seller max rank (diversity window)', `SELECT MAX("rankScore"), "sellerId" FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[]) AND "categoryId" <> $4 AND ("subcategorySlug" IS NULL OR "subcategorySlug" <> $5) GROUP BY "sellerId" ORDER BY 1 DESC LIMIT 12`, ['cat', 'sub']],
  ['category sums', `SELECT SUM(views), SUM("contactCount"), SUM("savedCount"), "categoryId" FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[]) GROUP BY "categoryId"`, []],
  ['keyword search total', `SELECT COUNT(*) FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "sellerId" <> ALL($3::text[]) AND "searchText" LIKE $4`, ['word']],
  ['brand + model', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "brandSlug" = $4 AND model = $5 LIMIT 24`, ['brand', 'model']],
  ['brand by date', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "brandSlug" = $4 ORDER BY "postedAt" DESC LIMIT 24`, ['brand']],
  ['price sort', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 ORDER BY price ASC LIMIT 24`, []],
  ['year range', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND year >= $5 LIMIT 24`, ['yearCat', 'yearMin']],
  ['area range', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND "areaM2" >= $5 LIMIT 24`, ['areaCat', 'areaMin']],
  ['salary range', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND "salaryM" >= $5 LIMIT 24`, ['salaryCat', 'salaryMin']],
  ['mileage range', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "categoryId" = $4 AND "mileageKm" <= $5 LIMIT 24`, ['mileageCat', 'mileageMax']],
  ['map bounding box', `SELECT id FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7 LIMIT 200`, ['latMin', 'latMax', 'lngMin', 'lngMax']],
  // As /api/listings/buildings sends it: the feed filters (verified, status) and `buildingKey: { not: null }`, grouped.
  ['building units', `SELECT "buildingKey", "subcategorySlug", COUNT(*) FROM "Listing" WHERE "verified" = $1 AND "status" = $2 AND "buildingKey" IS NOT NULL GROUP BY 1, 2`, []],
  ['storefront public probe', `SELECT id FROM "Listing" WHERE "sellerId" = $4 AND "verified" = $1 AND "status" = $2 LIMIT 1`, ['sel']],
  ["buyer's pending sale prompt", `SELECT id FROM "Listing" WHERE "soldToProfileId" = $4 AND "status" = 'sold' AND "saleConfirmedAt" IS NULL AND "saleDeclinedAt" IS NULL LIMIT 5`, ['buyer']],
]

/**
 * Run every VERIFY shape as a prepared statement with bound values; print what each chose; return how many seq-scanned,
 * and which indexes the diet would drop are still chosen.
 * ⛔ PLAIN EXPLAIN BY DEFAULT — PLANNED, NEVER EXECUTED: an executed query marks the indexes it scans as used, and "used"
 * is what the drop phase judges; the drop decision must rest on the APP's statements, never on this script's. `analyze`
 * (verify --analyze, for timings) executes them.
 */
async function verify(c, analyze = false) {
  // The desk ids the app itself excludes (the container carries HIDDEN_DESK_OWNER_EMAILS); support@eno.forum otherwise.
  const emails = (process.env.HIDDEN_DESK_OWNER_EMAILS || 'support@eno.forum,support@eno.vn').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  const desk = (await c.query(`SELECT s.id FROM "Seller" s JOIN "Profile" p ON p.id = s."ownerId" WHERE p.email = ANY($1)`, [emails])).rows.map((r) => r.id)
  // ⚠️ THE SAMPLING READS (finding real values to test with) EXECUTE — so they run with index scans OFF, inside one
  // transaction (SET LOCAL): an executed read on an old index would mark it used, the very fact the drop phase judges by
  // (gate review). A few sequential reads of a cached table, a few seconds, on an occasional ops run.
  await c.query('BEGIN')
  await c.query('SET LOCAL enable_indexscan = off')
  await c.query('SET LOCAL enable_bitmapscan = off')
  await c.query('SET LOCAL enable_indexonlyscan = off')
  const one = async (sql, params = []) => (await c.query(sql, params)).rows[0] ?? {}
  const live = `verified AND status = 'active'`
  const top = await one(`SELECT "categoryId" AS cat, "subcategorySlug" AS sub FROM "Listing" WHERE ${live} AND "subcategorySlug" IS NOT NULL GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 1`)
  const v = {
    cat: top.cat, sub: top.sub,
    sel: (await one(`SELECT "sellerId" AS v FROM "Listing" WHERE ${live} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)).v,
    ltype: (await one(`SELECT "listingType" AS v FROM "Listing" WHERE ${live} AND "categoryId" = $1 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`, [top.cat])).v,
    word: '%nha%',
    ...(await one(`SELECT "brandSlug" AS brand, model FROM "Listing" WHERE ${live} AND "brandSlug" IS NOT NULL AND model IS NOT NULL GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 1`)),
    ...(await one(`SELECT "categoryId" AS "yearCat", MIN(year) AS "yearMin" FROM "Listing" WHERE ${live} AND year IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)),
    ...(await one(`SELECT "categoryId" AS "areaCat", MIN("areaM2") AS "areaMin" FROM "Listing" WHERE ${live} AND "areaM2" IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)),
    ...(await one(`SELECT "categoryId" AS "salaryCat", MIN("salaryM") AS "salaryMin" FROM "Listing" WHERE ${live} AND "salaryM" IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)),
    ...(await one(`SELECT "categoryId" AS "mileageCat", MAX("mileageKm") AS "mileageMax" FROM "Listing" WHERE ${live} AND "mileageKm" IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)),
    ...(await one(`SELECT MIN(lat) - 0.01 AS "latMin", MIN(lat) + 0.03 AS "latMax", MIN(lng) - 0.01 AS "lngMin", MIN(lng) + 0.03 AS "lngMax" FROM "Listing" WHERE ${live} AND lat IS NOT NULL`)),
    buyer: (await one(`SELECT "soldToProfileId" AS v FROM "Listing" WHERE "soldToProfileId" IS NOT NULL LIMIT 1`)).v ?? '00000000-0000-0000-0000-000000000000',
  }
  await c.query('COMMIT') // end the sampling transaction below: the EXPLAINs plan with every access path allowed
  let seq = 0
  let n = 0
  const oldChosen = new Set()
  for (const [label, sql, extra] of VERIFY) {
    const name = `eno_diet_verify_${n++}`
    const params = [true, 'active', desk, ...extra.map((k) => v[k])]
    if (params.some((p) => p === undefined || p === null)) { console.log(`  ·  ${label.padEnd(36)} no data to test with — skipped`); continue }
    // $1..$3 typed explicitly (a shape need not use all three); the rest are inferred from the columns they meet.
    await c.query(`PREPARE ${name}(boolean, text, text[]) AS ${sql}`)
    try {
      // EXPLAIN EXECUTE takes literal arguments (protocol parameters cannot reach an EXPLAIN), so they are rendered as
      // literals here — the PREPAREd statement itself keeps $n, so the planner still sees values bound at execution,
      // exactly as it plans a Prisma statement.
      const lit = params.map((p) => Array.isArray(p) ? (p.length ? `ARRAY[${p.map((x) => quote(x)).join(',')}]::text[]` : `'{}'::text[]`) : typeof p === 'boolean' || typeof p === 'number' ? String(p) : quote(p))
      const plan = (await c.query(`EXPLAIN (${analyze ? 'ANALYZE, BUFFERS, ' : ''}FORMAT JSON) EXECUTE ${name}(${lit.join(', ')})`)).rows[0]['QUERY PLAN'][0]
      const nodes = []
      const walk = (x) => { nodes.push(x); for (const k of x.Plans ?? []) walk(k) }
      walk(plan.Plan)
      const onListing = nodes.filter((x) => x['Relation Name'] === 'Listing')
      const used = onListing.map((x) => `${x['Node Type']}${x['Index Name'] ? ` ${x['Index Name']}` : ''}`).join(' + ') || '(none)'
      const isSeq = onListing.some((x) => x['Node Type'] === 'Seq Scan')
      if (isSeq) seq++
      // Still planned on an index the diet would drop: the partial ones do not (yet) serve this shape — keep that index.
      for (const x of onListing) if (x['Index Name'] && DROPS.includes(x['Index Name'])) oldChosen.add(x['Index Name'])
      const cost = analyze
        ? `${String(plan['Execution Time'].toFixed(2)).padStart(8)} ms  ${String((plan.Plan['Shared Hit Blocks'] ?? 0) + (plan.Plan['Shared Read Blocks'] ?? 0)).padStart(6)} buffers`
        : `cost ${String(Math.round(plan.Plan['Total Cost'])).padStart(7)}`
      const old = onListing.some((x) => x['Index Name'] && DROPS.includes(x['Index Name']))
      console.log(`  ${isSeq ? '⛔' : old ? '⚠️ ' : '✅'} ${label.padEnd(36)} ${cost}  ${used}${old ? '  (an index the diet drops — kept while it is chosen)' : ''}`)
    } finally {
      await c.query(`DEALLOCATE ${name}`)
    }
  }
  return { seq, oldChosen }
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`

async function main(phase, dryRun, force) {
  if (!['create', 'verify', 'drop'].includes(phase)) throw new Error(`--phase must be create, verify or drop (got '${phase}')`)
  try { await import('dotenv/config') } catch { /* the container already has DATABASE_URL; a checkout reads .env */ }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL or DATABASE_URL')
  if (isPoolerUrl(url)) throw new Error('that URL is a transaction pooler (port 6543 / pgbouncer=true) — run with DIRECT_URL, a direct connection')
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  const q = (sql, params) => (dryRun && !/^\s*(SELECT|EXPLAIN|SET)\b/i.test(sql) ? (console.log(`  [dry-run] ${sql}`), { rows: [] }) : c.query(sql, params))
  const info = async (name) => (await c.query(
    `SELECT i.indisvalid AS valid, pg_relation_size(ic.oid) AS bytes, pg_get_indexdef(ic.oid) AS def, obj_description(ic.oid, 'pg_class') AS note
       FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid WHERE ic.relname = $1 AND ic.relnamespace = 'public'::regnamespace`, [name])).rows[0]
  const mb = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`
  try {
    // A server-side statement_timeout would kill a concurrent build half-way (INVALID every run) — and the build WAITS for
    // every open transaction that can see the table, so bound that wait instead: a timeout leaves an INVALID index, which
    // the next run drops and rebuilds.
    await c.query('SET statement_timeout = 0')
    await c.query(`SET lock_timeout = '2min'`)
    if (phase === 'create') {
      for (const ix of CREATES) {
        const label = defLabel(ix.def)
        const before = await info(ix.name)
        if (before && !before.valid) {
          console.warn(`  ${ix.name} is INVALID (a failed earlier build) — dropping and rebuilding`)
          await q(`DROP INDEX CONCURRENTLY IF EXISTS public."${ix.name}"`)
        } else if (before) {
          // ⛔ A DEFINITION IS IMMUTABLE ONCE BUILT (gate review): `IF NOT EXISTS` alone would keep the old shape silently
          // after an edit — and an UNLABELLED one (built by hand, or a run killed between build and label) is not
          // certified either: a person compares its definition and either labels it or drops it.
          if (before.note !== label) {
            console.error(before.note
              ? `  ⛔ ${ix.name} was built from another definition (${before.note}, now ${label}) — give the changed index a NEW name in CREATES and put this one in DROPS`
              : `  ⛔ ${ix.name} exists without this script's label. It is:  ${before.def}\n     It should be:  CREATE INDEX "${ix.name}" ON ${ix.def}\n     If they match: COMMENT ON INDEX public."${ix.name}" IS ${quote(label)};  otherwise drop it and re-run.`)
            process.exitCode = 1
            continue
          }
          console.log(`  ${ix.name} exists (${mb(before.bytes)}) — kept`)
          continue
        }
        const t0 = Date.now()
        // One failed build (a lock_timeout, a missing opclass) must not leave the rest unbuilt (gate review): it is
        // reported, the phase exits 1, and a re-run drops its INVALID leftover and builds it again.
        try {
          await q(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${ix.name}" ON ${ix.def}`)
        } catch (e) {
          console.error(`  ⛔ ${ix.name} failed to build: ${e instanceof Error ? e.message : e} — re-run this phase`)
          process.exitCode = 1
          continue
        }
        const after = dryRun ? null : await info(ix.name)
        if (!dryRun && !after?.valid) { console.error(`  ⛔ ${ix.name} is not valid after the build — re-run this phase`); process.exitCode = 1; continue }
        await q(`COMMENT ON INDEX public."${ix.name}" IS ${quote(label)}`)
        if (!dryRun) console.log(`  ${ix.name} built: ${mb(after.bytes)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      }
      await q('ANALYZE "Listing"')
      if (!dryRun) console.log('  ANALYZE "Listing" done')
      // Autovacuum at 2% for this table (owner, 2026-10-17). The default 20% waits for ~28k dead rows in a table whose
      // live part is 1.5%: measured before, 23,367 dead rows and 40% of pages not all-visible, so index-only scans of
      // the live copies fell back to the heap (category total 6,235 pages; after one vacuum, 6). Takes SHARE UPDATE
      // EXCLUSIVE — no read or write waits. Undo: ALTER TABLE "Listing" RESET (both keys).
      await q(`ALTER TABLE public."Listing" SET (${AUTOVACUUM})`)
      if (!dryRun) console.log(`  "Listing" autovacuum: ${AUTOVACUUM}`)
    }
    // ⚠️ The drop phase reads the scan record BEFORE verify runs: whatever verify itself reads must never be what the
    // decision judges (gate review).
    const lastScan = phase === 'drop'
      ? new Map((await c.query(`SELECT indexrelname AS name, last_idx_scan FROM pg_stat_user_indexes WHERE schemaname = 'public'`)).rows.map((r) => [r.name, r.last_idx_scan]))
      : null
    const statsReset = phase === 'drop'
      ? (await c.query(`SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`)).rows[0]?.stats_reset ?? null
      : null
    let oldChosen = new Set()
    if (phase === 'verify' || phase === 'drop') {
      const result = await verify(c, phase === 'verify' && process.argv.includes('--analyze'))
      oldChosen = result.oldChosen
      if (result.seq) {
        console.error(`  ⛔ ${result.seq} shape(s) read "Listing" sequentially${phase === 'drop' ? ' — nothing dropped' : ' — do NOT run --phase=drop until that is understood'}`)
        process.exitCode = 1
        return
      }
    }
    if (phase === 'drop') {
      let freed = 0
      for (const name of DROPS) {
        const old = await info(name)
        if (!old) { console.log(`  ${name}: already gone`); continue }
        const by = CREATES.filter((x) => x.replaces.includes(name))
        const missing = []
        // A replacement counts only as the index create built — valid AND labelled with its current definition: a
        // same-name index of another shape must not authorize dropping the old one (gate review).
        for (const x of by) { const r = await info(x.name); if (!r?.valid || r.note !== defLabel(x.def)) missing.push(x.name) }
        if (missing.length) { console.error(`  ⛔ ${name} kept: its replacement ${missing.join(', ')} is missing, INVALID or not built from its current definition — run --phase=create`); process.exitCode = 1; continue }
        // ⛔ --force overrides only the RECENT-SCAN evidence, never verify's own finding that a hot shape is still planned
        // on this index (gate review): dropping it would move that shape to whatever is left, maybe a sequential scan.
        if (oldChosen.has(name)) { console.warn(`  ⏸ ${name} kept: a verify shape is still planned on it — --force does not override this`); continue }
        const why = keepReason({ chosenByVerify: false, lastScan: lastScan.get(name) ?? null, statsReset })
        if (why && !force.has(name)) { console.warn(`  ⏸ ${name} kept: ${why}`); continue }
        if (why) console.warn(`  ⚠️ ${name}: ${why} — dropped anyway (--force names it)`)
        console.log(`  restore: ${old.def};`)
        await q(`DROP INDEX CONCURRENTLY IF EXISTS public."${name}"`)
        if (!dryRun) { freed += Number(old.bytes); console.log(`  dropped ${name} (${mb(old.bytes)})`) }
      }
      if (!dryRun) console.log(`  freed ${mb(freed)}`)
    }
  } finally {
    await c.end()
  }
}

/** `--force=a,b` → Set(['a', 'b']); a bare `--force` is refused — every forced drop is named (gate review). */
export function forcedNames(argv) {
  if (argv.includes('--force')) throw new Error('--force needs the indexes it applies to: --force=<index>[,<index>…]')
  const arg = argv.find((a) => a.startsWith('--force='))
  const names = arg ? arg.slice('--force='.length).split(',').map((n) => n.trim()).filter(Boolean) : []
  const unknown = names.filter((n) => !DROPS.includes(n))
  if (unknown.length) throw new Error(`--force names indexes this diet does not drop: ${unknown.join(', ')}`)
  return new Set(names)
}

const phaseArg = process.argv.find((a) => a.startsWith('--phase='))
if (phaseArg) {
  await Promise.resolve().then(() => main(phaseArg.slice('--phase='.length), process.argv.includes('--dry-run'), forcedNames(process.argv))).catch((e) => {
    console.error(`  ⛔ ${e instanceof Error ? e.message : e}`)
    process.exitCode = 1
  })
}
