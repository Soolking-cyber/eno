/**
 * "SEARCH THIS AREA", ANSWERED BY THE DATABASE AS A RECTANGLE.
 *
 * ⛔ IT REPLACES A FILTER THAT SILENTLY LOST ALMOST EVERYTHING. `/api/listings` accepted no
 * coordinates at all, so area search ran in the browser: the explorer raised its page size to 100,
 * DISABLED pagination, and haversine-filtered those hundred rows. Against 19,359 live listings that
 * is not an area search — it is an area search of whatever page one happened to hold, and nothing
 * told the reader the other 19,259 were never considered.
 *
 * ⛔ A RECTANGLE AND NOT A CIRCLE, AND THE NUMBERS ARE WHY. The first implementation resolved an
 * exact circle in SQL and handed the feed an `id IN (…)` set, which is correct and does not scale:
 * measured on production from Thảo Điền, a circle holds 172 listings at 1 km, 6,379 at 5 km, 28,224
 * at 10 km and 33,140 at 20 km — essentially every geocoded row in the table. An id list of tens of
 * thousands is not a sane query to hand Postgres, and the 20,000-row cap that bounded it would have
 * quietly truncated any search past ~8 km. A lat/lng range pair costs four parameters at any size,
 * uses the index, and paginates.
 *
 * ⛔ SO THE MAP DRAWS THE RECTANGLE IT ACTUALLY SEARCHES. A box is ~27% larger than the circle it
 * contains and reaches √2·r into the corners, so drawing a circle over a box filter would put
 * results visibly outside the ring the reader was promised. Showing the true shape is the honest
 * option and is what "search this area" means everywhere else.
 *
 * ⛔ AND NOTHING PRUNES AFTERWARDS. The server filter IS the final filter — this repo has already
 * paid for the alternative once: a server cap plus a client that prunes is data loss, because the
 * rows the browser drops are ones the cap already chose to return.
 */

/**
 * ⚠️ NO PRISMA AND NO `@/lib/db`, AND THAT IS THE POINT. This is the arithmetic the area search
 * rests on, so it must be unit-testable without a generated client or a database — the first draft
 * imported both and its test could not even load. `haversineKm` already lives in `geo.ts` and is
 * NOT redefined here; the map still uses it to order results by distance.
 */

export type RadiusQuery = { lat: number; lng: number; radiusKm: number }

/**
 * The smallest lat/lng rectangle containing a circle of `radiusKm` about the point — and since the
 * rectangle IS the filter (see the module note), this is the search area itself, not a prefilter for
 * something stricter. Two range predicates, which is what the (lat, lng) index serves.
 *
 * ⚠️ LONGITUDE DEGREES MUST BE SCALED BY cos(lat), AND BOTH REVIEWERS RAISED IT INDEPENDENTLY. A
 * degree of latitude is ~110.6 km everywhere, but a degree of longitude is ~111.3 km only at the
 * equator and shrinks with the cosine. Using the latitude figure for both makes the box too NARROW
 * in longitude — at HCMC's 10.8°N that is about 1.8%, which clips real listings on the east and west
 * edges before the haversine ever sees them, and the bug would look like "the radius is slightly
 * wrong" rather than anything obviously broken.
 *
 * ⚠️ THE ANTIMERIDIAN IS A NON-RISK HERE AND IS DELIBERATELY NOT HANDLED. Vietnam sits near 106°E;
 * a box would have to span ~74° of longitude to wrap, which a radius slider capped in kilometres
 * cannot produce. Latitude is clamped to the poles because that is free; splitting the box at ±180°
 * would be untested code guarding a case this product cannot reach.
 */
export function radiusBoundingBox({ lat, lng, radiusKm }: RadiusQuery) {
  const KM_PER_DEG_LAT = 110.574
  const KM_PER_DEG_LNG = 111.320
  const dLat = radiusKm / KM_PER_DEG_LAT
  // At a pole the cosine collapses and the longitude span explodes; clamp so it stays finite.
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const dLng = radiusKm / (KM_PER_DEG_LNG * cos)
  return {
    minLat: Math.max(lat - dLat, -90),
    maxLat: Math.min(lat + dLat, 90),
    /**
     * ⚠️ CLAMPED LIKE LATITUDE, for symmetry rather than for Vietnam. A box cannot wrap the
     * antimeridian at a 25 km cap (it would need ~74° of span), but `lng=180` is an accepted input
     * and unclamped bounds render off-world in Leaflet. Clamping costs nothing; the asymmetry
     * invited the question.
     */
    minLng: Math.max(lng - dLng, -180),
    maxLng: Math.min(lng + dLng, 180),
  }
}

/**
 * Parse `lat`/`lng`/`radiusKm` off a query string, or `null` when the caller did not ask for one.
 *
 * ⛔ AN ALLOW-LIST ON THE NUMBERS, because these reach raw SQL. They are bound as parameters rather
 * than interpolated, so this is not the injection boundary — but `NaN`, `Infinity` or a 40,000 km
 * radius would still produce a query that scans the table and returns everything, which is a denial
 * of service dressed as a search. Anything outside real coordinates and a 0–100 km radius is treated
 * as "no radius asked for" rather than clamped, so a malformed URL narrows nothing instead of
 * quietly searching somewhere else.
 */
export function parseRadiusParams(sp: URLSearchParams): RadiusQuery | null {
  /**
   * ⛔ `Number('')` IS 0, AND 0 IS A VALID LATITUDE — a test caught this reading `?lat=&lng=` as a
   * deliberate search at the Gulf of Guinea rather than as the absent parameter it is. Presence is
   * checked before the value, so a blank param can never become a coordinate.
   */
  const raw = (k: string) => {
    const v = sp.get(k)
    return v === null || v.trim() === '' ? null : Number(v)
  }
  const lat = raw('lat'), lng = raw('lng'), radiusKm = raw('radiusKm')
  if (lat === null || lng === null || radiusKm === null) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  /**
   * ⚠️ 25 km, NOT 100. The control offers 1–20 km, so this is headroom rather than a limit anyone
   * reaches by using the product — and it bounds what an unauthenticated caller can ask for. A
   * 100 km radius is a ~200 km box that covers essentially every geocoded row, evaluated four
   * times per request (feed, total, histogram, facet counts): a denial of service dressed as a
   * search, which a reviewer was right to flag.
   */
  if (radiusKm <= 0 || radiusKm > 25) return null
  return { lat, lng, radiusKm }
}

/**
 * The Prisma `where` fragment for an area search — four range bounds, nothing more.
 *
 * ⚠️ `not: null` ON BOTH COLUMNS IS EXPLICIT, not left to the range test. A row with no coordinate
 * cannot be in the box, and 69% of this table has none (33,621 of 108,810 rows carry one), so
 * saying it out loud keeps it a decision rather than a side effect of three-valued logic — and it
 * matches the partial index in scripts/geo-index-ddl.mjs, which is built on exactly that predicate.
 */
export function radiusWhere(q: RadiusQuery) {
  const b = radiusBoundingBox(q)
  return {
    lat: { not: null, gte: b.minLat, lte: b.maxLat },
    lng: { not: null, gte: b.minLng, lte: b.maxLng },
  }
}
