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
export function pickBoundary(results: OsmResult[], kind: BoundaryKind, expectedName?: string, province?: string): OsmResult | null {
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
  /**
   * ⚠️ WHEN THE NAME MATCHES MORE THAN ONCE, THE ONE IN THE EXPECTED PROVINCE WINS. The name check
   * above proves the right NAME, not the right PLACE — a reviewer pointed out that the country-wide
   * fallback (see `districtQueryCandidates`) can therefore match a same-named district in another
   * province. This is a preference and deliberately NOT a requirement: Vietnam's 2025 reform moved
   * Cần Giờ under Đồng Nai, so demanding the province would throw away the correct shape for an
   * area this marketplace still files under Hồ Chí Minh. Prefer, then fall back.
   */
  const inProvince = province
    ? named.filter((r) => fold(r.display_name ?? '').includes(fold(province)))
    : []
  const pick = (pool: OsmResult[]) =>
    pool.find((r) => r.type === 'administrative') ??
    (kind === 'district' ? pool.find((r) => r.type === 'historic') : undefined)
  // A current administrative boundary always wins; `historic` is the fallback that makes districts
  // work at all. Anything else under `boundary` (postal codes, protected areas) is not an admin area.
  return pick(inProvince) ?? pick(named) ?? null
}

/**
 * The names to ASK OSM for, in order, for one curated district.
 *
 * ⛔ FOUR OF TWENTY-TWO DISTRICTS CAME BACK EMPTY AND TWO OF THOSE WERE OUR OWN STRING, NOT OSM's
 * DATA. Measured against the live API on 2026-09-24, from the production box:
 *   · we asked for "Quận 7 (Phú Mỹ Hưng)" — the picker's display name, carrying a neighbourhood
 *     gloss OSM has never heard of. Asking for "Quận 7" returns `boundary/historic` with a polygon.
 *   · we asked for "Nhà Bè"; OSM files it as "Huyện Nhà Bè" and returns a polygon for that.
 * The other two are real gaps: "Thủ Đức" returns a university campus and "Cần Giờ" a military base,
 * with no administrative boundary behind either, so no alias rescues them and the miss is correct.
 *
 * ⚠️ ORDERED, AND THE EXACT NAME GOES FIRST. An alias is a fallback for when the curated label is
 * not what OSM calls the place — never a replacement for it, because the unprefixed form is the one
 * that is right for the sixteen districts that already work.
 * ⚠️ THE ALIAS IS ALSO WHAT THE NAME CHECK COMPARES AGAINST, which is what keeps this from becoming
 * a way to smuggle in the wrong area: asking for "Huyện Nhà Bè" still has to come back as Nhà Bè.
 */
export function districtQueryAliases(name: string): string[] {
  const out: string[] = [name]
  const push = (v: string) => { const t = v.trim(); if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t) }

  // "Quận 7 (Phú Mỹ Hưng)" → "Quận 7". A parenthetical here is always our own gloss for the reader.
  const bare = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (bare !== name) push(bare)

  // "TP Thủ Đức" → "Thành phố Thủ Đức" — our abbreviation, spelled out the way OSM spells it.
  push(bare.replace(/^TP\.?\s+/i, 'Thành phố '))

  // A name with no administrative prefix is a rural district in this list; OSM prefixes those.
  if (!/^(Quận|Huyện|Thành phố|TP)\b/i.test(bare)) push(`Huyện ${bare}`)

  return out
}

/**
 * The full ordered list of (query, expected-name) pairs to try for one curated district.
 *
 * ⛔ THE PROVINCE IN THE QUERY IS WHAT HID THE LAST FOUR DISTRICTS, AND IT TOOK MEASURING TO SEE.
 * Appending ", Hồ Chí Minh" is right for the eighteen that work and actively WRONG for the rest,
 * because Vietnam's 2025 reform moved them out from under it in OSM's data (all measured against
 * the live API, 2026-09-24):
 *   · "Thành phố Thủ Đức" is filed as `boundary/historic` with the display name "Thành phố Thủ Đức,
 *     Việt Nam" — no province component at all, so the province-scoped query filtered out the very
 *     relation it was looking for and returned a university instead.
 *   · "Huyện Cần Giờ" now sits under **Đồng Nai**, not Hồ Chí Minh. Asking HCMC for it returns a
 *     military base; asking Vietnam for it returns the real MultiPolygon.
 * So every alias is tried against the province first (correct and cheapest for the common case) and
 * then against the country, which is the wider net that catches a reorganised area.
 *
 * ⚠️ THE NAME CHECK IS NOT RELAXED TO PAY FOR THE WIDER QUERY — `expect` still travels with each
 * candidate, so a country-wide search still has to come back as the district that was asked for.
 * That matters more here, not less: ", Việt Nam" can match a same-named place in another province.
 * ⚠️ BOUNDED. Only a district that resolves on none of these pays for the whole list, it is spaced
 * to respect OSM's one-per-second policy, and the answer — hit or miss — is then cached.
 */
export function districtQueryCandidates(
  name: string,
  province: string,
  country = 'Việt Nam',
): { q: string; expect: string }[] {
  /**
   * ⛔ THE BUDGET IS PER SCOPE, NOT A FLAT SLICE (reviewer). Taking the first four of
   * province×aliases followed by country×aliases means a name with three aliases spends the whole
   * budget on province-scoped queries and never reaches the country scope — deleting the fallback
   * that exists precisely for the reform-era districts, and then caching the miss for thirty days.
   * Today's curated list happens to top out at two aliases; nothing enforced that, and the test
   * only asserted a total. Two per scope guarantees both are always tried.
   */
  /**
   * ⛔ THE FIRST AND THE MOST-TRANSFORMED, NOT THE FIRST TWO — all three reviewers caught this and
   * they were right. `districtQueryAliases` emits [exact, gloss-stripped, prefix-expanded, …], so a
   * flat `slice(0, 2)` keeps the exact name and the gloss-strip while DISCARDING the administrative
   * prefix expansion — which is the only variant OSM recognises for the reform-era districts this
   * whole mechanism exists for. It happens to be harmless for today's curated list (every entry
   * yields at most two aliases), and that is exactly why it would have rotted silently: the first
   * label combining a parenthetical with a `TP`/`Huyện` prefix would have been quietly unfindable
   * and then negatively cached for thirty days.
   * ⚠️ The exact name stays FIRST (it is right for the eighteen that already work); the last alias
   * is the most transformed, so the pair spans the range at the same cost.
   */
  const all = districtQueryAliases(name)
  const aliases = all.length <= 2 ? all : [all[0], all[all.length - 1]]
  const out: { q: string; expect: string }[] = []
  for (const scope of [province, country]) {
    if (!scope) continue
    for (const a of aliases) {
      const q = `${a}, ${scope}`
      if (!out.some((c) => c.q === q)) out.push({ q, expect: a })
    }
  }
  // ⚠️ FOUR, NOT SIX (reviewer): every real district resolves within two aliases × two scopes, and
  // each extra candidate costs another upstream call and another ~7s on the one path a cold
  // anonymous request can take. Measured — Thủ Đức, Cần Giờ, Nhà Bè and Quận 7 all land by #4.
  return out.slice(0, 4)
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
