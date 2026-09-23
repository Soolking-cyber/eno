/**
 * WARD AND DISTRICT OUTLINES: choosing the right OSM result, and making it small enough to send.
 *
 * ⛔ NOTHING IN THIS REPO HAS EVER HELD A BOUNDARY. `src/data/vn-units.json` carries all 34 provinces
 * and 3,321 wards as `{code, name, nameEn}` with NO coordinates; `geo.ts` has a few dozen hand-typed
 * city and district CENTROIDS; the only geometry the map has ever drawn is a rectangle. So outlines
 * come from OpenStreetMap, one area at a time, cached — the owner's call after being shown that the
 * alternative is sourcing and maintaining a national dataset through Vietnam's 2025 admin reform.
 *
 * ⛔ AND A NAME LOOKUP GENUINELY COLLIDES, WHICH IS WHY `pickBoundary` EXISTS. Measured against the
 * live Nominatim API before any of this was written: searching "Phường Thảo Điền, Ho Chi Minh"
 * returns a LANDUSE point, "Phường Bến Nghé" returns a customs OFFICE, and "Thành phố Thủ Đức"
 * returns a university campus. Taking `results[0]` would have drawn a car park and called it a ward.
 * Filtering to an administrative boundary WITH polygon geometry is the whole difference between this
 * working and it being nonsense: with that filter, 18 of 20 sampled HCMC wards and 19 of 22 curated
 * districts return a usable outline.
 *
 * ⚠️ THE 2025 REFORM SHOWS UP IN THE DATA, AND NOT AS A BLOCKER. Both plan reviewers predicted
 * districts would be unmatchable because the reform abolished them. They are still there — as
 * `boundary=historic` relations, which is exactly the vocabulary this marketplace's listings still
 * use ("Quận 1", "Bình Thạnh"). So `historic` is ACCEPTED for districts rather than filtered out;
 * refusing it would have thrown away 10 of the 19 that work.
 */

/** What the caller asked to outline. Wards are current admin units; districts are mostly historic. */
export type BoundaryKind = 'ward' | 'district'

/** One OSM search result, narrowed to the fields the choice actually turns on. */
export type OsmResult = {
  category?: string
  type?: string
  display_name?: string
  geojson?: { type?: string; coordinates?: unknown } | null
}

/** A ring is a closed list of [lng, lat] pairs — GeoJSON order, which is NOT lat/lng. */
type Ring = [number, number][]

/**
 * Pick the result that is actually an administrative area, or `null` when none is.
 *
 * ⛔ `null` IS A FIRST-CLASS ANSWER AND MUST STAY ONE. Two of twenty sampled wards have no boundary
 * in OSM at all. The map draws nothing in that case — an outline that is a guess is worse than no
 * outline, because the reader cannot tell the difference and will believe it.
 */
export function pickBoundary(results: OsmResult[], kind: BoundaryKind, expectedName?: string): OsmResult | null {
  const usable = results.filter(
    (r) =>
      r.category === 'boundary' &&
      (r.geojson?.type === 'Polygon' || r.geojson?.type === 'MultiPolygon'),
  )
  if (!usable.length) return null
  /**
   * ⛔ THE ANSWER MUST BE THE AREA THAT WAS ASKED FOR. Both reviewers pointed out that the type and
   * geometry checks say an area is administrative, not that it is THIS one — a free-form query with
   * `limit=10` could return the enclosing province, or a same-named ward elsewhere, and a correctly
   * typed outline of the WRONG place is exactly the "outline that is a guess" this module refuses.
   * Probing the live API, the queries this actually sends each return a single boundary and it is
   * the right one, so this is insurance rather than a fix — but it is what makes the claim true.
   *
   * ⚠️ COMPARED WITHOUT DIACRITICS, because OSM and `vn-units.json` disagree about them more often
   * than they disagree about the place, and a comparison that fails on "Quận" vs "Quan" would throw
   * away correct answers to guard against rare wrong ones.
   */
  const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
  const named = expectedName
    ? usable.filter((r) => {
        const want = fold(expectedName)
        const got = fold(r.display_name?.split(',')[0] ?? '')
        return got === want || got.endsWith(` ${want}`) || want.endsWith(` ${got}`)
      })
    : usable
  if (!named.length) return null
  // A current administrative boundary always wins; `historic` is the fallback that makes districts
  // work at all. Anything else under `boundary` (postal codes, protected areas) is not an admin area.
  return (
    named.find((r) => r.type === 'administrative') ??
    (kind === 'district' ? named.find((r) => r.type === 'historic') : undefined) ??
    null
  )
}

/**
 * Ramer–Douglas–Peucker, on one ring.
 *
 * ⛔ SIMPLIFYING IS NOT OPTIONAL. Measured on the live API: Bắc Tân Uyên comes back as 3,652 points
 * and 95 KB of JSON, and several HCMC wards exceed 50 KB. Shipping that to a phone to draw a line
 * nobody zooms into is indefensible when a few metres of precision buys an order of magnitude.
 *
 * ⚠️ IT WORKS IN DEGREES, NOT METRES, and that is a deliberate simplification rather than an
 * oversight. A perpendicular distance in degrees is anisotropic — at 10.8°N a degree of longitude is
 * ~1.8% shorter than one of latitude — so the tolerance is slightly tighter east-west than
 * north-south. At the tolerance used here that difference is centimetres on screen; correcting it
 * would mean projecting every ring for no visible gain.
 */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 2) return ring
  let maxDist = -1
  let idx = 0
  const [ax, ay] = ring[0]
  const [bx, by] = ring[ring.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const normSq = dx * dx + dy * dy
  for (let i = 1; i < ring.length - 1; i++) {
    const [px, py] = ring[i]
    // Perpendicular distance to the chord; when the chord is degenerate, fall back to the endpoint.
    const d = normSq === 0
      ? Math.hypot(px - ax, py - ay)
      : Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(normSq)
    if (d > maxDist) { maxDist = d; idx = i }
  }
  if (maxDist <= tolerance) return [ring[0], ring[ring.length - 1]]
  const left = simplifyRing(ring.slice(0, idx + 1), tolerance)
  const right = simplifyRing(ring.slice(idx), tolerance)
  return [...left.slice(0, -1), ...right]
}

/**
 * Simplify a whole Polygon or MultiPolygon, keeping every ring a closed, drawable loop.
 *
 * ⚠️ A RING THAT SIMPLIFIES BELOW FOUR POINTS IS KEPT AS-IS, not dropped. Douglas–Peucker on a small
 * island can collapse it to two points, which is a line rather than an area — Leaflet renders that
 * as a hairline artefact across the map. Keeping the original is a few dozen bytes and cannot look
 * wrong.
 */
export function simplifyGeometry(
  geometry: { type?: string; coordinates?: unknown },
  tolerance = 0.0002,
): { type: string; coordinates: unknown } | null {
  const doRings = (rings: unknown): Ring[] =>
    (rings as Ring[]).map((r) => {
      if (!Array.isArray(r) || r.length < 4) return r
      const s = simplifyRing(r, tolerance)
      if (s.length < 4) return r
      // Douglas–Peucker keeps both endpoints, so a closed ring stays closed — asserted, not assumed.
      const [fx, fy] = s[0]
      const [lx, ly] = s[s.length - 1]
      return fx === lx && fy === ly ? s : [...s, [fx, fy] as [number, number]]
    })

  if (geometry?.type === 'Polygon') {
    return { type: 'Polygon', coordinates: doRings(geometry.coordinates) }
  }
  if (geometry?.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: (geometry.coordinates as unknown[]).map((poly) => doRings(poly)),
    }
  }
  return null
}

/** Total vertex count, for logging and for the size assertions in the tests. */
export function countPoints(geometry: { type?: string; coordinates?: unknown } | null): number {
  if (!geometry) return 0
  const s = JSON.stringify(geometry.coordinates ?? [])
  return (s.match(/\[-?\d/g) ?? []).length
}

/**
 * The cache key for one area.
 *
 * ⚠️ KEYED ON WHAT WE ASK OSM, NOT ON OUR OWN WARD CODE. A reviewer proposed keying on the
 * `vn-units.json` code, which is the stable identity in OUR data — but OSM has never heard of it,
 * so the lookup goes out by NAME and the cache has to be able to tell a hit from a miss for the
 * exact string that was sent. The code is not in the key for that reason; it belongs in whatever
 * calls this.
 */
export function boundaryCacheKey(kind: BoundaryKind, name: string, province: string): string {
  const norm = (v: string) => v.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${kind}|${norm(province)}|${norm(name)}`
}
