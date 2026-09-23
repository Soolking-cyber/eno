// ONE ADDITIVE TABLE caching ward/district outlines fetched from OpenStreetMap. IDEMPOTENT.
//
// Run:  node scripts/geo-boundary-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// WHY A CACHE AT ALL. Nominatim's usage policy is one request per second and asks that results be
// cached rather than re-fetched; an outline also costs 3–95 KB over the wire and takes ~0.7 s. There
// are 3,321 wards in the country and a few dozen districts anyone actually browses, so after the
// first visit to an area this table answers instead of the network, forever.
//
// ⛔ MISSES ARE CACHED TOO, AND THAT IS THE POINT OF `found`. Measured against the live API: 2 of 20
// sampled HCMC wards and 3 of 22 curated districts have NO administrative boundary in OSM. Without a
// negative entry those areas would hit the network on every single page view and stall for the
// timeout each time — the worst case would be the one that happens most.
//
// ⚠️ NOT A PRISMA MODEL, deliberately. It is a memo of somebody else's data, written and read by one
// route, and `PlaceGeocode` (the itinerary's lat/lng memo) already sets that precedent — raw SQL,
// outside the schema, so `prisma migrate diff` neither manages it nor proposes dropping it.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('Set DIRECT_URL (or DATABASE_URL) — read from .env')
  process.exit(1)
}
const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  await c.query(`
    CREATE TABLE IF NOT EXISTS "GeoBoundary" (
      "key"       text PRIMARY KEY,
      "geojson"   jsonb,
      "found"     boolean     NOT NULL,
      "fetchedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  // Lets the route expire negative entries without a scan when OSM gains an area it used to lack.
  await c.query(`CREATE INDEX IF NOT EXISTS "GeoBoundary_found_fetchedAt_idx" ON "GeoBoundary" ("found", "fetchedAt")`)
  const n = await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT "found")::int AS misses FROM "GeoBoundary"`)
  console.log(`GeoBoundary ready (${n.rows[0].n} cached, ${n.rows[0].misses} negative)`)
} finally {
  await c.end()
}
