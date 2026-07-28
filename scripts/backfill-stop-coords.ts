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
import { isAlternativesName, resolvePlaceName } from '../src/lib/itinerary-places'
import { isInVietnam, isNearCity } from '../src/lib/itinerary-geo'
import { placeSearchName } from '../src/lib/itinerary-place-query'
import { cityForDay } from '../src/lib/itinerary-day-city'
import { fold } from '../src/lib/fold'

const APPLY = process.argv.includes('--apply')
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

// Read only to LABEL the run. The provider choice, the throttle and the ceiling all belong to
// src/lib/itinerary-geocode.ts now; this must never grow back into a second implementation.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
/** Mirrors src/lib/itinerary-geocode.ts. Same bucket, same window, so the two share one budget. */
const GEOCODE_DAILY_LIMIT = Number(process.env.GEOCODE_DAILY_LIMIT) > 0 ? Number(process.env.GEOCODE_DAILY_LIMIT) : 500

type StopRow = { id: string; place: string; lat: number | null; area: string; destinationId: string }

/**
 * ⚠️ THE DAY'S `area` DECIDES THE CITY — the previous comment here said the opposite ("the day's
 * free-text area is only a label") and that was the bug. An Itinerary stores ONE destinationId; a
 * multi-city trip's days each carry their own area. Scoping every stop to the itinerary's single
 * destination asked for a Hoi An restaurant near Hanoi, and `isNearCity` correctly refused the
 * right coordinate. Before this fix the dry run printed `[Hoi An → hanoi]`, `[Phu Quoc → hanoi]`
 * and `[Ho Chi Minh City → hanoi]` for every stop. `cityForDay` is imported, not restated — the
 * app's own pass has always resolved per day.
 */
const SQL = `
  select s.id, s.place, s.lat, d.area, i."destinationId"
  from "ItineraryStop" s
  join "ItineraryDay" d on d.id = s."dayId"
  join "Itinerary" i on i.id = d."itineraryId"
  order by i."createdAt", d."dayNumber", s.position`

/**
 * ⚠️ WHY THIS STILL HAS ITS OWN fetch, AND WHAT IT MUST NOT DUPLICATE.
 *
 * The obvious fix — import geocodePlace from src/lib/itinerary-geocode.ts — is impossible: that
 * module is `server-only`, as is ratelimit.ts and db.ts beneath it, and `server-only` cannot be
 * resolved outside Next's bundler (no top-level install; outside the `react-server` condition its
 * entry point throws by design). Splitting the guard off was tried and abandoned — the chain goes
 * all the way down, and stripping guards from three modules to suit a maintenance script is the
 * tail wagging the dog.
 *
 * So the HTTP call is local. Everything that could DISAGREE with the app is not:
 *   · the `or`-name refusal and compound splitting — imported (isAlternativesName, resolvePlaceName)
 *   · the gazetteer query narrowing — imported (placeSearchName)
 *   · the coordinate gates — imported (isInVietnam, isNearCity)
 *   · the daily spend ceiling — the SAME rl_check SQL function the app's rateLimit calls
 *   · the remembered answers — the SAME PlaceGeocode table, read before and written after
 *
 * Measured why this matters: before the refusal was shared, this script resolved
 * "The Deck Saigon or Binh An Village" to The Deck Saigon and would have plotted a pin for a venue
 * the traveller never chose.
 */


/** fold(), imported, so a cache key written here matches one the app writes. */
const placeKey = (name: string) => fold(name ?? '')

/**
 * Cache-first, budget-gated lookup. The pieces that must agree with the app are all shared:
 * rl_check for the ceiling, PlaceGeocode for memory, isInVietnam/isNearCity for validity.
 */
async function geocodeVia(
  client: pg.Client, name: string, cityId: CityId,
): Promise<{ lat: number; lng: number; source: string } | null> {
  const city = CITY_MAP.get(cityId)
  if (!city) return null
  const key = placeKey(name)

  // Remembered? Then it is free and no budget is spent — same order the app uses.
  const cached = await client.query<{ lat: number; lng: number }>(
    `select lat, lng from "PlaceGeocode" where "placeKey" = $1 and "cityId" = $2 limit 1`, [key, cityId])
  if (cached.rows[0]) return { ...cached.rows[0], source: 'cache' }

  // THE SAME CEILING THE APP OBEYS — rl_check, the identical SQL function src/lib/ratelimit.ts
  // calls, under the identical bucket name. A backfill must not be a way to outspend the budget.
  // Fails CLOSED: a limiter error stops the run rather than un-capping it.
  try {
    const rl = await client.query<{ success: boolean }>(
      `select success from rl_check($1, $2, $3::int, $4::int)`,
      ['geocode-global', 'global', GEOCODE_DAILY_LIMIT, 86400])
    if (!rl.rows[0]?.success) { console.log('      → daily geocode ceiling reached — stopping'); return null }
  } catch (e) {
    console.log(`      → limiter unavailable, refusing to spend un-capped (${(e as Error).message.slice(0, 60)})`)
    return null
  }

  // ⚠️ THE SAME NARROWING THE APP APPLIES — imported, not restated, for the reason this file's own
  // header gives: a second hand-written copy of the query rule is how the script and the app end up
  // disagreeing about what they asked. It strips bracketed annotations, splits a "both" compound,
  // and returns null for a transit leg ("Hanoi Airport to Da Nang"), which has no coordinate to find.
  const searchName = placeSearchName(name)
  if (!searchName) { console.log('      → not a place (a leg of travel) — refused, no lookup spent'); return null }
  const q = encodeURIComponent(`${searchName}, ${city.name}, Vietnam`)
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
    // Nominatim's 1-req/sec policy. Unconditional here: this loop is the only caller.
    await new Promise((r) => setTimeout(r, 1100))
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

  // The app's gates, imported. A backfill must never be the one path that writes an unvalidated pin.
  if (!isInVietnam(hit.lat, hit.lng)) { console.log(`      rejected: outside Vietnam (${hit.lat}, ${hit.lng})`); return null }
  if (!isNearCity({ lat: hit.lat, lng: hit.lng }, { lat: city.lat, lng: city.lng }, cityId)) {
    console.log(`      rejected: not near ${city.name} (${hit.lat}, ${hit.lng})`)
    return null
  }

  // Remember it, so the app never pays for this answer again.
  if (APPLY) {
    await client.query(
      `insert into "PlaceGeocode" ("placeKey","cityId",lat,lng,source) values ($1,$2,$3,$4,$5)
       on conflict ("placeKey","cityId") do nothing`, [key, cityId, hit.lat, hit.lng, hit.source])
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
    const cityId = cityForDay(String(row.area ?? ''), String(row.destinationId ?? ''))
    console.log(`  ${JSON.stringify(row.place)}  [${row.area} → ${cityId}]`)

    // FREE FIRST: the curated catalogue, including compound splitting. Only what it cannot answer
    // costs a network call.
    // A name offering a CHOICE is refused outright — the app's rule, imported, not restated.
    if (isAlternativesName(row.place)) {
      console.log(`      → UNMAPPED (offers a choice — refused, not guessed)`)
      refused += 1
      continue
    }

    // ⚠️ NO CITY MEANS NO LOOKUP, and it must fail closed. A day whose area matches nothing in the
    // catalogue (and whose itinerary destination is unusable) has no anchor to check a coordinate
    // against — and an unanchored gazetteer answer is exactly the ~1000km pin isNearCity exists to
    // stop. Leaving the stop unmapped is the known, safe state.
    if (!cityId) {
      console.log('      → no catalogue city for this day — refused, no lookup spent')
      refused += 1
      continue
    }

    const catalogued = resolvePlaceName(row.place, cityId)
    let hit: { lat: number; lng: number; source: string } | null =
      catalogued ? { lat: catalogued.lat, lng: catalogued.lng, source: 'catalogue' } : null

    if (hit) {
      viaCatalogue += 1
    } else {
      hit = await geocodeVia(client, row.place, cityId)
      if (hit) viaGeocoder += 1
      else refused += 1
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
