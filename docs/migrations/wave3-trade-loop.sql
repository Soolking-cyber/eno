-- ============================================================================
-- Wave 3 · THE TRADE LOOP — two-sided sale confirmation on "Listing"
-- Generated 2026-08-11. Mirrors prisma/schema.prisma (model Listing).
-- Rules that consume these columns: src/lib/trade-loop.ts
--
-- HOW THIS WAS PRODUCED, AND WHY NOT THE OBVIOUS WAY.
--   `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
--   CANNOT be used against this database. Two independent reasons, both measured:
--     1. It errors out before emitting anything — "Cross schema references are only
--        allowed when the target schema is listed in the schemas property of your
--        datasource. `public.Profile` points to `auth.users` in constraint
--        `profile_auth_fk`."
--     2. Even if it ran, it would be actively dangerous: the database holds 67 tables
--        against 52 Prisma models, so a DB→schema diff reconciles the DB *to* the
--        datamodel and emits DROP TABLE for everything living outside Prisma
--        (visa_applications and its PII, next_cache, the rl_* limiter, zalo_oauth_token…).
--   So this was generated schema→schema instead — `--from-schema <git HEAD's
--   schema.prisma> --to-schema <the edited one>` — which sees only the edit and can
--   physically not emit a drop. The statements below are that output, with
--   IF NOT EXISTS added so re-running after a DB reset is a no-op (the convention
--   scripts/sold-attribution-cols.mjs already follows).
--
-- SAFETY REVIEW OF EVERY STATEMENT IN THIS FILE
--   · 5 × ADD COLUMN, 3 × CREATE INDEX. Nothing else.
--   · Prisma emitted ONE multi-clause ALTER TABLE. Every clause was read through to the
--     semicolon and each is an ADD COLUMN — there is no trailing ALTER COLUMN / SET /
--     DROP DEFAULT riding behind them, which is the exact shape that slipped through once
--     before. It is split into five single-clause statements HERE so each column can carry
--     its own explanation; that is a presentation change, semantically identical.
--   · No EXECUTABLE line contains DROP. Verify it yourself rather than trusting this
--     comment — the word appears in the prose above, so a naive grep of the whole file
--     hits and proves nothing. Strip the comments first:
--       grep -v '^--' docs/migrations/wave3-trade-loop.sql | grep -ci drop   # → 0
--   · Every new column is NULLABLE with no default and no backfill, so the currently
--     deployed revision keeps serving correctly against the migrated database — it
--     never writes them and never reads them. Migrate FIRST, deploy after.
--
-- LOCKING: "Listing" held 51 rows when this was written (measured via
-- SELECT count(*)). CREATE INDEX takes a SHARE lock that blocks writes to the table
-- for its duration; at this size that is milliseconds, so plain CREATE INDEX is used
-- rather than CONCURRENTLY (which cannot run inside a transaction block and would
-- force this file to be executed statement-by-statement). Revisit above ~1e6 rows.
--
-- ⛔ DEPLOY ORDER — RUN THIS **BEFORE** THE CODE SHIPS, AND NOTHING ENFORCES IT.
-- prisma/schema.prisma rides in the deploy; docs/** is in the deploy trigger's ignore list,
-- so this file never ships anywhere. Deploy a Prisma client generated from the new schema
-- against an un-migrated database and every unscoped "Listing" SELECT names five columns that
-- do not exist → Postgres 42703 on the browse feed, the PDP and the dashboard alike. The
-- columns are all nullable precisely so the reverse order is safe: migrate first, and the
-- CURRENTLY deployed revision keeps serving correctly because it neither reads nor writes them.
--
-- Run:  psql -v ON_ERROR_STOP=1 --single-transaction "$DIRECT_URL" -f docs/migrations/wave3-trade-loop.sql
--       ⚠️ BOTH FLAGS MATTER. Plain `psql -f` keeps going after a failed statement and still
--       exits 0, so a failure at statement 6 of 8 leaves a half-migrated table and a green
--       terminal. --single-transaction makes the file all-or-nothing; every statement here is
--       transactional (no CREATE INDEX CONCURRENTLY), so it is safe to wrap.
-- Verify: \d "Listing"   → the five sale* columns and three trade-loop indexes are present.
-- ============================================================================

-- ── Columns ────────────────────────────────────────────────────────────────────
-- The agreed sale price in VND, as the seller entered it on the mark-sold sheet.
-- NOT a copy of "price": a haggled item sells below its ask, and price guidance built
-- from ASKING prices is exactly what this column exists to replace.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "salePrice" DOUBLE PRECISION;

-- The buyer answered "Yes, I bought it". Only a sale with this stamp counts toward
-- trust, and only once it is set does the review prompt appear to either side.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "saleConfirmedAt" TIMESTAMP(3);

-- The buyer answered "No". Stops every re-prompt permanently. The seller may still
-- re-attribute the sale to a DIFFERENT buyer (wrong person picked), which clears this
-- stamp.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "saleDeclinedAt" TIMESTAMP(3);

-- THE DURABLE PER-BUYER MEMORY. Compact JSON owned end-to-end by src/lib/trade-loop.ts, one
-- entry per buyer ever asked about this listing:
--     [{"i":"<profile uuid>","a":<confirm-window anchor ms>,"p":<price asked>,
--       "n":<asks sent by the mark-sold path>,"d":<declined ms>}]
--   ⚠️ ALL FOUR OPTIONAL KEYS MATTER. A hand-repaired row that drops "n" resets the ask budget
--   to zero and re-opens the bounded-ask vector; dropping "d" forgets a refusal.
--
-- ⚠️ EVERY OTHER sale* COLUMN DESCRIBES THE **CURRENT** ATTRIBUTION AND IS WIPED WHEN THE
-- SELLER RE-ATTRIBUTES, which is correct for them and fatal for any rule that must survive a
-- re-attribution. Three drafts were defeated here and each break was MEASURED before it was
-- fixed, so please do not "simplify" this back into scalars:
--   · a single "who declined" column → buyer A declines, seller attributes to B, B declines and
--     OVERWRITES A, so A is nameable again with a fresh window;
--   · a prompt clock keyed to "soldChannel" → mark external, then mark the same buyer again:
--     a probe toggling once a day sent a silent buyer 300 NOTIFICATIONS OVER 300 DAYS;
--   · a window keyed to "soldAt" → the intermediate external mark restamped it, so the window
--     crept forward a day per round and never closed (soldAt reached 2027-05-28 from an
--     2026-08-01 sale);
--   · a re-ask that skipped the cooldown → alternating the price hourly sent 336 notifications
--     in 14 days, against a documented maximum of three;
--   · a plain slice() cap → naming 50 further buyers evicted the first decliner, who became
--     nameable again with a fresh window.
-- Anchoring both the window and the decline to a per-BUYER record closes all five. "a" is the
-- IMMOVABLE window anchor and is deliberately NOT "soldAt", which must stay free to mean "when
-- it sold" for the sold-date copy, recency and the sweep.
--
-- Cleared ONLY by a reactivation (a relisted item is genuinely a new sale). A scalar text blob,
-- like "attributes" beside it — no FK, additive, safe outside the push flow.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "saleBuyerHistory" TEXT;

-- Last time the buyer was ASKED. The re-prompt is bounded by a cooldown from here AND
-- a deadline from "soldAt", which is why no attempt counter is needed — an unanswered
-- prompt lapses on its own instead of nagging forever.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "saleConfirmPromptedAt" TIMESTAMP(3);

-- ── Indexes ────────────────────────────────────────────────────────────────────
-- Each one is written for ONE named query, and the COLUMN ORDER is the point: a
-- B-tree serves leading equality predicates then ONE trailing range. `IS NULL` is an
-- equality-class predicate and is indexable, so the "not answered yet" columns belong
-- in the equality prefix, never after the range column.
--
-- ⚠️ AN INDEX IS THE ACCESS PATH, NOT THE PREDICATE LIST. External review caught the first
-- draft writing each query as ONLY its indexed columns — a weaker filter than the module
-- enforces, in the comment a query author would copy from. Every WHERE below is therefore
-- written in FULL; the index covers the selective prefix and Postgres applies the rest as
-- residual filters. The AUTHORITY on "does this sale count" is src/lib/trade-loop.ts
-- (countsTowardTrust / canRespondToSale), never a predicate rebuilt from memory. The
-- complianceStatus clause was missed on the first pass and is exactly that failure: the module
-- refuses a taken-down sale while the query beside it happily counted one, which would leave an
-- authority-removed listing crediting a public trust score.
--
-- ⛔ AND THEY ARE **NOT** COPY-PASTEABLE AS THEY STAND — THEY CARRY NO EDITION SCOPE.
-- eno.vn and eno.forum are ONE codebase over ONE database, and visa/itinerary products are
-- ORDINARY "Listing" rows (the shared-desk design). A sweep or badge built from the WHERE
-- clauses below alone crosses that boundary: an eno.vn user gets "confirm you bought <visa
-- service> for X đ", and confirmed visa sales are summed into a public marketplace trust score.
-- External review caught this file inviting exactly that, because the note above says the
-- predicates are written in full — they are complete for the TRADE LOOP and for nothing else.
-- Every consumer must AND in the edition scope from src/lib/edition-scope.ts. This file cannot
-- express it (it is application state, not a column), which is why it is called out here.

-- (1) The buyer's own pending prompt — "what am I being asked to confirm?", run on
--     every notification read for a signed-in buyer:
--       SELECT … FROM "Listing"
--       WHERE "soldToProfileId" = $me AND status = 'sold' AND "soldChannel" = 'eno'
--         AND "saleConfirmedAt" IS NULL AND "saleDeclinedAt" IS NULL
--         AND "soldAt" >= now() - interval '14 days'    -- TRADE_LOOP.CONFIRM_WINDOW_DAYS
--         AND "complianceStatus" <> 'taken_down';
--     Measured before this change: pg_indexes on "Listing" matched nothing containing
--     'sold', i.e. "soldToProfileId" had no index at all and this was a seq scan.
CREATE INDEX IF NOT EXISTS "Listing_soldToProfileId_saleConfirmedAt_saleDeclinedAt_idx"
  ON "Listing" ("soldToProfileId", "saleConfirmedAt", "saleDeclinedAt");

-- (2) The re-prompt sweep (cron nudging buyers who have not answered yet):
--       SELECT … FROM "Listing"
--       WHERE "soldChannel" = 'eno' AND status = 'sold' AND "soldToProfileId" IS NOT NULL
--         AND "saleConfirmedAt" IS NULL AND "saleDeclinedAt" IS NULL
--         AND "soldAt" >= $windowCutoff AND "complianceStatus" <> 'taken_down';
--     Three equality/IS NULL columns, then the single range column last.
CREATE INDEX IF NOT EXISTS "Listing_soldChannel_saleConfirmedAt_saleDeclinedAt_soldAt_idx"
  ON "Listing" ("soldChannel", "saleConfirmedAt", "saleDeclinedAt", "soldAt");

-- (3) Trust's transaction count, which after this wave reads CONFIRMED sales instead
--     of approximating sale time from "Listing"."updatedAt" (src/lib/trust.ts):
--       SELECT … FROM "Listing"
--       WHERE "sellerId" = $seller AND status = 'sold' AND "soldChannel" = 'eno'
--         AND "soldToProfileId" IS NOT NULL AND "saleDeclinedAt" IS NULL
--         AND "saleConfirmedAt" >= $txSince AND "complianceStatus" <> 'taken_down';
--     Equality on "sellerId", range on "saleConfirmedAt".
CREATE INDEX IF NOT EXISTS "Listing_sellerId_saleConfirmedAt_idx"
  ON "Listing" ("sellerId", "saleConfirmedAt");

-- Deliberately NO index for sold-price guidance: its only consumer is the nightly
-- /api/cron/price-stats aggregate, which reads the whole table by brand+model in one
-- pass. A row-level index does not serve a full aggregate and would only cost writes.
