-- Trip assistance: the two tables src/lib/trips/status.ts writes.
--
-- APPLIED BY HAND, DELIBERATELY. `prisma db push` was NOT run against any database from this
-- task: push diffs the WHOLE schema against the target, so on a shared project it can quietly
-- drop or alter something another lane just added. This file is the exact, reviewable subset.
--
-- Mirrors prisma/schema.prisma models TripAssistanceRequest / TripAssistanceEvent. If you change
-- one, change both — Prisma will not tell you they diverged, it will just fail at runtime on the
-- first query that names a missing column.
--
--   psql "$DIRECT_URL" -f scripts/trip-assistance-ddl.sql
--
-- SAFE TO RE-RUN, but be precise about what that means (codex): every statement is guarded, so a
-- partial application can be finished by running this again. It is NOT a migration — CREATE TABLE
-- IF NOT EXISTS will not add a missing column or repair a definition that has drifted. If these
-- tables already exist in a different shape, diff them by hand; do not assume this converges.

BEGIN;

-- ── The case ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TripAssistanceRequest" (
  "id"               TEXT         NOT NULL,
  "itineraryId"      TEXT         NOT NULL,
  -- The traveller. UUID to match Profile.id (and Prisma's @db.Uuid on this column).
  "profileId"        UUID         NOT NULL,
  -- Workflow state. Every write goes through applyTripTransition, which compare-and-sets on the
  -- prior value: UPDATE … WHERE id = $1 AND status = $2. The legal EDGES are not expressed here
  -- (see the status CHECK below for what is, and why the distinction matters).
  "status"           TEXT         NOT NULL DEFAULT 'requested',
  -- The marketplace thread. A plain id, not an FK: the binding only means anything once ownership
  -- has been proven (buyer == traveller), which the application layer does.
  "conversationId"   TEXT,
  -- ⚠️ MONEY IS OPERATOR-TYPED. Nullable until quoted, never written from a request body, never
  -- charged — the traveller pays suppliers directly.
  --
  -- ⚠️ INTEGER caps these at 2,147,483,647 VND (~USD 84k at 25,500/USD). Kept as INTEGER to match
  -- the rest of the itinerary domain (Itinerary.estimatedBudget, ItineraryStay.estimatedCostVnd),
  -- because diverging in one table is worse than a documented shared ceiling — but it IS a real
  -- ceiling for a large group booking, and it belongs to the whole domain rather than to this
  -- table. Raised with Alex rather than changed unilaterally (codex spotted it).
  "supplierTotalVnd" INTEGER,
  "feeVnd"           INTEGER,
  "quotedAt"         TIMESTAMP(3),
  "assignedAdmin"    TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripAssistanceRequest_pkey" PRIMARY KEY ("id"),
  -- Membership in the finite status SET — deliberately NOT the transition graph.
  --
  -- The edges live in exactly one place (TRIP_TRANSITIONS) and duplicating them here is how two
  -- copies drift, which the visa transition map has already demonstrated. But the NODE list is a
  -- different invariant, and leaving it unenforced is worse than the duplication (codex): the
  -- machine fails CLOSED, so a status it does not recognise has NO legal exits — one stray manual
  -- UPDATE or a bad migration would strand a case permanently, unrecoverable through the app.
  -- Adding a status therefore means editing TWO places, and that is the intended cost.
  CONSTRAINT "TripAssistanceRequest_status_check" CHECK (
    "status" IN ('requested','reviewing','quoted','accepted','arranging','completed','declined','cancelled')
  ),
  -- A quote is BOTH numbers or neither. Independent nullable columns let a half-written quote
  -- exist — a fee with no supplier total, which reads as a charge with no basis (codex).
  CONSTRAINT "TripAssistanceRequest_quote_complete_check" CHECK (
    ("supplierTotalVnd" IS NULL) = ("feeVnd" IS NULL)
  )
);

-- ── The audit trail ─────────────────────────────────────────────────────────────────────
-- Append-only, written best-effort AFTER a committed transition.
CREATE TABLE IF NOT EXISTS "TripAssistanceEvent" (
  "id"        TEXT         NOT NULL,
  "requestId" TEXT         NOT NULL,
  -- 'traveller' | 'admin' | 'system'; actorRef is a profile id or an admin email, free-text so a
  -- system actor needs no fake profile row.
  "actorType" TEXT         NOT NULL,
  "actorRef"  TEXT         NOT NULL,
  "event"     TEXT         NOT NULL,
  -- ⚠️ NEVER TRAVELLER PII. Ids, a step, a status pair, field NAMES. This table has no owner
  -- column and outlives the case it describes.
  "metaJson"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripAssistanceEvent_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────────────
-- The pair Itinerary already carries: one for the traveller's own list, one for the operator
-- queue. Plus the FK covering index, which Supabase's performance advisor flags when missing.
CREATE INDEX IF NOT EXISTS "TripAssistanceRequest_profileId_updatedAt_idx"
  ON "TripAssistanceRequest" ("profileId", "updatedAt");
CREATE INDEX IF NOT EXISTS "TripAssistanceRequest_status_updatedAt_idx"
  ON "TripAssistanceRequest" ("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "TripAssistanceRequest_itineraryId_idx"
  ON "TripAssistanceRequest" ("itineraryId");
CREATE INDEX IF NOT EXISTS "TripAssistanceEvent_requestId_createdAt_idx"
  ON "TripAssistanceEvent" ("requestId", "createdAt");

-- ── Foreign keys ────────────────────────────────────────────────────────────────────────
-- CASCADE on both: an itinerary or account deletion must not leave a case addressed to nobody,
-- and events must not outlive their case. Added separately and guarded, because ADD CONSTRAINT
-- has no IF NOT EXISTS in Postgres and a bare re-run would abort the transaction.
DO $$
BEGIN
  -- Scoped by conrelid: a bare conname match would be satisfied by a same-named constraint on
  -- ANOTHER table and silently skip creating this one (codex).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'TripAssistanceRequest_itineraryId_fkey'
                   AND conrelid = '"TripAssistanceRequest"'::regclass) THEN
    ALTER TABLE "TripAssistanceRequest"
      ADD CONSTRAINT "TripAssistanceRequest_itineraryId_fkey"
      FOREIGN KEY ("itineraryId") REFERENCES "Itinerary" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'TripAssistanceRequest_profileId_fkey'
                   AND conrelid = '"TripAssistanceRequest"'::regclass) THEN
    ALTER TABLE "TripAssistanceRequest"
      ADD CONSTRAINT "TripAssistanceRequest_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'TripAssistanceEvent_requestId_fkey'
                   AND conrelid = '"TripAssistanceEvent"'::regclass) THEN
    ALTER TABLE "TripAssistanceEvent"
      ADD CONSTRAINT "TripAssistanceEvent_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "TripAssistanceRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
