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
 * working and it being nonsense: with that filter, 18 of 20 sampled HCMC wards and 18 of the curated
 * districts return a usable outline.
 * ⚠️ THE DISTRICT COUNT MOVES — it was 22 when this was measured and is 24 since `d2`/`d9` were
 * curated (2026-09-24). Treat the numbers here as a dated measurement, not as an invariant; the
 * code derives every count from the list itself.
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
  /**
   * ⛔ A WARD IS NEVER A DISTRICT, AND AFTER THE 2025 REFORM IT WILL HAPPILY ANSWER TO THE SAME NAME.
   * The reform abolished HCMC's districts and reused their names for new wards, so OSM now returns
   * `Phường Bình Thạnh` (3.3 km²) for "Bình Thạnh" and `Ấp Củ Chi` — a HAMLET, 0.7 km² — for "Củ
   * Chi", where the districts are 20.8 and 434.7. Both are genuine `administrative` boundaries with
   * real geometry and the right name, so every other check here passes them: nine of twenty-two
   * curated districts were outlining a ward or a hamlet before this guard existed.
   * ⚠️ IT KEYS ON THE VIETNAMESE UNIT PREFIX, which is the only thing in the answer that says what
   * KIND of place it is — `admin_level` does not separate them any more (a post-reform ward is
   * level 6, the same level the districts used to be). Asking for a district therefore refuses
   * anything that announces itself as a ward, hamlet, commune or block.
   * ⛔ `thị trấn` IS IN THE LIST AND IS THE ONE THAT NEARLY GOT AWAY — all three reviewers caught
   * its absence independently. A townlet is commune-level, and EVERY rural district has one sharing
   * its exact name: Thị trấn Củ Chi, Thị trấn Hóc Môn, Thị trấn Nhà Bè. Without it the bare-name
   * fallback candidate would clear this guard and then clear the name check (`got.endsWith(' ' +
   * want)`), outlining a ~10 km² town as a 434.7 km² huyện — the very bug this guard was written
   * for, still reachable one candidate later.
   * ⚠️ `thị\s*trấn` IS ANCHORED SEPARATELY FROM `xã` ON PURPOSE: `Thị xã` is DISTRICT-level (a town,
   * not a commune) and must keep passing, while `Thị trấn` must not. Anchoring `xã` at the start is
   * what keeps "Thị xã Bến Cát" out of this list.
   * ⚠️ The abbreviated OSM forms (`P.`, `TT.`, `KP.`) are here too, for the same reason.
   */
  const WARD_LEVEL = /^(phường|p\.|xã|thị\s*trấn|tt\.|ấp|thôn|khu\s*phố|kp\.|tổ\s*dân\s*phố|làng|bản)\s*/i
  const districtOnly = kind === 'district'
    ? usable.filter((r) => !WARD_LEVEL.test((r.display_name ?? '').split(',')[0].trim()))
    : usable
  if (!districtOnly.length) return null

  const named = expectedName
    ? districtOnly.filter((r) => {
        const want = fold(expectedName)
        const got = fold(r.display_name?.split(',')[0] ?? '')
        return got === want || got.endsWith(` ${want}`) || want.endsWith(` ${got}`)
      })
    : districtOnly
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
 * ⛔ FOUR DISTRICTS CAME BACK EMPTY AND TWO OF THOSE WERE OUR OWN STRING, NOT OSM's DATA. Measured against the live API on 2026-09-24, from the production box:
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

  /**
   * ⛔ BOTH PREFIXES, AND THEY GO FIRST — this is the fix for the worst boundary bug this file has
   * had. Measured 2026-09-24 across all 22 curated districts: NINE were outlining the wrong thing,
   * because Vietnam's 2025 reform ABOLISHED the districts and REUSED THEIR NAMES FOR NEW WARDS. So a
   * bare-name query now resolves to a current unit of the same name and OSM ranks it first:
   *   · "Củ Chi"      → `Ấp Củ Chi`, a HAMLET — 0.7 km² where the district is 434.7
   *   · "Bình Thạnh"  → `Phường Bình Thạnh`, a WARD — 3.3 km² where the district is 20.8
   *   · and the same for Tân Bình, Tân Phú, Gò Vấp, Phú Nhuận, Bình Tân, Hóc Môn, Bình Chánh.
   * The abolished district does not even appear in the bare-name results. Asking for "Quận Bình
   * Thạnh" or "Huyện Củ Chi" returns it as `historic` with the exact right area, every time.
   *
   * ⚠️ WHICH PREFIX A DISTRICT TAKES IS NOT DERIVABLE — urban ones are `Quận`, rural ones `Huyện`,
   * and the curated list stores neither. So both are tried, prefixed forms FIRST because the bare
   * name is the one that now resolves to the wrong place.
   */
  /**
   * ⛔ `(?:\s|$)`, NOT `\b` — JavaScript's word boundary is ASCII-only, so it matches after the "n"
   * of "Huyện" and NOT after the "ã" of "Thị xã". With `\b` this test silently failed for exactly
   * the prefixes that end in a diacritic, and "Thị xã Bến Cát" came back out as "Quận Thị xã Bến
   * Cát". Its own test caught it.
   */
  if (!/^(Quận|Huyện|Thành phố|TP|Thị xã|TX)(?:\s|$)/i.test(bare)) {
    /**
     * ⚠️ REBUILT, NOT APPENDED TO — the bare name is the LEAST trustworthy form since the reform, so
     * it goes last rather than first. ⚠️ `Thành phố` is offered too (reviewer): a district-level
     * city stored WITHOUT its prefix — "Thủ Đức" rather than "TP Thủ Đức" — would otherwise never
     * be asked for in the only form that resolves it. ⚠️ And `Thị xã`/`TX` count as already
     * prefixed, so a town name does not get "Quận Thị xã …" built on top of it.
     */
    const withGloss = name !== bare ? [name] : []
    out.length = 0
    push(`Quận ${bare}`)
    push(`Huyện ${bare}`)
    push(`Thành phố ${bare}`)
    push(bare)
    for (const g of withGloss) push(g)
  }

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
   * ⛔ THE "EXACT NAME STAYS FIRST" RULE THAT USED TO BE DOCUMENTED HERE IS DEAD, and leaving it
   * would be the third stale comment this file has shipped (reviewer). It was right while a bare
   * name resolved to the district; since the 2025 reform the bare name resolves to a WARD of the
   * same name, so for a bare input the prefixed forms lead and the plain one is the fallback. A
   * name that carries its own prefix is still asked for exactly as given.
   */
  /**
   * ⛔ THE FIRST TWO, BECAUSE THE PREFIXED FORMS NOW LEAD. This used to take [first, last] on the
   * theory that the exact name was best and the last was the most transformed — true when the bare
   * name came first. Since the 2025-reform fix it does not: for a bare rural name the list is
   * [Quận X, Huyện X, X], and first-and-last picked "Quận X" and the BARE name while dropping
   * "Huyện X" — the only form that resolves a huyện. Its own test caught it.
   * ⚠️ THREE, NOT TWO, AND THREE IS THE MEASURED CEILING rather than a round number. The two shapes
   * a real district takes both need exactly three: a bare name wants [Quận X, Huyện X, X], and a
   * prefixed name carrying a gloss wants [TP X (Y), TP X, Thành phố X]. At two, each of those lost
   * its last entry — which is the one that resolves. Both losses were caught by tests rather than
   * by reading, which is why the cap is now derived from the alias shapes instead of guessed.
   */
  const aliases = districtQueryAliases(name).slice(0, 3)
  const out: { q: string; expect: string }[] = []
  for (const scope of [province, country]) {
    if (!scope) continue
    for (const a of aliases) {
      const q = `${a}, ${scope}`
      if (!out.some((c) => c.q === q)) out.push({ q, expect: a })
    }
  }
  /**
   * ⚠️ SIX = three aliases × two scopes, raised from four when the 2025-reform fix made three aliases
   * necessary (see above). The cost is paid ONLY on a genuine miss — a cold district that resolves
   * on its first candidate still makes one call — and a miss then caches for thirty days. The warm
   * script keeps this off the request path entirely for the curated list.
   */
  return out.slice(0, 6)
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
