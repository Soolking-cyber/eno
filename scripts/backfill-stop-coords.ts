// Backfill lat/lng on itinerary stops that have none, and REPORT THE NUMBERS.
//
// Run (read-only by default — prints what it WOULD do and changes nothing):
//   npx tsx --env-file=.env scripts/backfill-stop-coords.ts
// Then, to write:
//   npx tsx --env-file=.env scripts/backfill-stop-coords.ts --apply
//
// ⚠️ .ts, NOT .mjs, and the repo already learned why: scripts/backfill-listing-rankscore.ts exists
// because its .mjs predecessor duplicated the ranking SQL, drifted from the real formula, and
// "silently re-ranked the whole feed on stale math". A .mjs here would have to reimplement
// resolvePlaceName — the compound splitting AND the `or` refusal — in a second language. This
// imports the one implementation instead, so a backfill can never disagree with what generation
// does.
//
// ⚠️ FILLS ONLY NULLS. The UPDATE carries `lat IS NULL` in its WHERE, so a coordinate anybody or
// anything already set is never overwritten by a gazetteer guess, and re-running is a no-op.

import pg from 'pg'
import { CITY_MAP, type CityId } from '../src/lib/itinerary-data'
import { isInVietnam, isNearCity } from '../src/lib/itinerary-geo'
import { resolvePlaceName } from '../src/lib/itinerary-places'

const APPLY = process.argv.includes('--apply')
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
const NOMINATIM_SPACING_MS = 1100

type StopRow = { id: string; place: string; lat: number | null; area: string; destinationId: string }

/** Same query shape the app uses: a stop has no cityId of its own — the city comes from the
 *  itinerary's destination, and the day's free-text area is only a label. */
const SQL = `
  select s.id, s.place, s.lat, d.area, i."destinationId"
  from "ItineraryStop" s
  join "ItineraryDay" d on d.id = s."dayId"
  join "Itinerary" i on i.id = d."itineraryId"
  order by i."createdAt", d."dayNumber", s.position`

async function geocode(name: string, cityId: CityId): Promise<{ lat: number; lng: number; source: string } | null> {
  const city = CITY_MAP.get(cityId)
  if (!city) return null
  const q = encodeURIComponent(`${name}, ${city.name}, Vietnam`)
  let hit: { lat: number; lng: number; source: string } | null = null

  if (GOOGLE_KEY) {
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${q}&region=vn&key=${GOOGLE_KEY}`, { signal: AbortSignal.timeout(6000) })
      const data = await res.json()
      const loc = data?.results?.[0]?.geometry?.location
      if (data?.status === 'OK' && typeof loc?.lat === 'number') hit = { lat: loc.lat, lng: loc.lng, source: 'google' }
    } catch { /* fall through to the free provider */ }
  }
  if (!hit) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=${q}`, {
        headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' },
        signal: AbortSignal.timeout(6000),
      })
      const data = await res.json()
      const top = Array.isArray(data) ? data[0] : null
      const lat = Number(top?.lat); const lng = Number(top?.lon)
      if (Number.isFinite(lat) && Number.isFinite(lng)) hit = { lat, lng, source: 'nominatim' }
    } catch { /* unmapped is a known state */ }
  }
  if (!hit) return null

  // ⚠️ THE SAME GATES THE APP APPLIES, and applied here too rather than trusted from there. A
  // backfill that skipped them would be the one path that can write an unvalidated coordinate.
  if (!isInVietnam(hit.lat, hit.lng)) { console.log(`      rejected: outside Vietnam (${hit.lat}, ${hit.lng})`); return null }
  if (!isNearCity({ lat: hit.lat, lng: hit.lng }, { lat: city.lat, lng: city.lng }, cityId)) {
    console.log(`      rejected: not near ${city.name} (${hit.lat}, ${hit.lng})`)
    return null
  }
  return hit
}

// Wrapped rather than top-level await: tsx transpiles this to CJS, where top-level await is
// not available. Same reason the other backfill scripts keep their work inside a function.
async function main() {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const { rows } = await client.query<StopRow>(SQL)

  const before = rows.filter((r) => r.lat !== null).length
  const pct = (n: number) => (rows.length ? `${Math.round((n / rows.length) * 100)}%` : 'n/a')
  console.log(`\nMODE: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`provider: ${GOOGLE_KEY ? 'google, nominatim fallback' : 'nominatim (no GOOGLE_MAPS_API_KEY set)'}`)
  console.log(`\nBEFORE: ${before}/${rows.length} stops mapped (${pct(before)})\n`)

  let viaCatalogue = 0
  let viaGeocoder = 0
  let refused = 0

  for (const row of rows) {
    if (row.lat !== null) continue
    const cityId = row.destinationId as CityId
    console.log(`  ${JSON.stringify(row.place)}  [${row.area} → ${cityId}]`)

    // FREE FIRST: the curated catalogue, including compound splitting. Only what it cannot answer
    // costs a network call.
    const catalogued = resolvePlaceName(row.place, cityId)
    let hit: { lat: number; lng: number; source: string } | null =
      catalogued ? { lat: catalogued.lat, lng: catalogued.lng, source: 'catalogue' } : null

    if (hit) {
      viaCatalogue += 1
    } else {
      hit = await geocode(row.place, cityId)
      if (hit) viaGeocoder += 1
      else refused += 1
      if (!GOOGLE_KEY) await new Promise((r) => setTimeout(r, NOMINATIM_SPACING_MS))
    }

    if (!hit) { console.log(`      → UNMAPPED (left alone)`); continue }
    console.log(`      → ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}  via ${hit.source}`)
    if (APPLY) {
      const res = await client.query(
        `update "ItineraryStop" set lat = $1, lng = $2 where id = $3 and lat is null`,
        [hit.lat, hit.lng, row.id],
      )
      if (res.rowCount !== 1) console.log(`      ! not written (row changed under us)`)
    }
  }

  const after = before + viaCatalogue + viaGeocoder
  console.log(`\nAFTER:  ${after}/${rows.length} stops mapped (${pct(after)})${APPLY ? '' : '  ← projected; nothing was written'}`)
  console.log(`  via catalogue: ${viaCatalogue}   via geocoder: ${viaGeocoder}   still unmapped: ${refused}`)
  if (!APPLY) console.log(`\nRe-run with --apply to write.\n`)
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
