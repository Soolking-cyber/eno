-- PlaceGeocode: the geocode-once-and-remember table for itinerary stops.
--
-- APPLIED BY HAND, DELIBERATELY, and NOT by `prisma db push` — push diffs the WHOLE schema against
-- the target, so on a shared project it can quietly drop or alter something another lane just
-- added. This file is the exact, reviewable subset.
--
--   psql "$DIRECT_URL" -f scripts/place-geocode-ddl.sql
--
-- ⚠️ THERE IS NO PRISMA MODEL FOR THIS, and that is a scope constraint rather than a design
-- choice: prisma/schema.prisma is not in T314's owned paths. src/lib/itinerary-geocode.ts reads it
-- through $queryRaw, the same way the rate limiter reads rl_check, and half a dozen tables in this
-- database (BannedIdentity, Notification, PriceChange, EnforcementAction …) were added exactly this
-- way. Flagged for Alex: fold it into the Prisma schema when somebody owns that file.
--
-- ⚠️ NOTHING BREAKS BEFORE THIS IS APPLIED. Both cache paths are wrapped so a missing table makes
-- geocoding un-remembered rather than broken — the feature loses its saving, not its correctness.
-- That is what makes it safe for the code to ship ahead of the DDL.

BEGIN;

CREATE TABLE IF NOT EXISTS public."PlaceGeocode" (
  -- The catalogue's OWN folded form of the place name (src/lib/fold.ts), so "Bến Thành" and
  -- "ben thanh" are one row and one lookup rather than two.
  "placeKey"  TEXT             NOT NULL,
  -- Scoped by city on purpose. "Central Market" is a different place in Hoi An and in Da Lat, and
  -- a nationwide key would hand the second traveller the first one's pin ~800km away.
  "cityId"    TEXT             NOT NULL,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  -- 'google' | 'nominatim'. Kept so a provider found to be systematically wrong can have its rows
  -- deleted without discarding the whole table.
  "source"    TEXT             NOT NULL,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The identity of a remembered answer, and what makes the insert idempotent: two generations
  -- racing the same new place both look it up and the loser keeps the winner's row.
  CONSTRAINT "PlaceGeocode_pkey" PRIMARY KEY ("placeKey", "cityId"),
  -- Vietnam's bounding box, matching VN_BBOX in src/lib/itinerary-geo.ts. The application already
  -- refuses an out-of-country coordinate before caching; this is the backstop for anything that
  -- reaches the table another way (a hand-inserted row, a future script), because a poisoned cache
  -- row is PERMANENT by design — it is never re-fetched.
  CONSTRAINT "PlaceGeocode_in_vietnam_check" CHECK (
    "lat" BETWEEN 8.0 AND 23.6 AND "lng" BETWEEN 102.0 AND 110.0
  )
);

-- The operational question this table gets asked outside the hot path: "what did we learn, and
-- from where?" The hot path is served by the primary key.
CREATE INDEX IF NOT EXISTS "PlaceGeocode_cityId_createdAt_idx"
  ON public."PlaceGeocode" ("cityId", "createdAt");

COMMIT;
