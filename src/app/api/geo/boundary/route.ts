/**
 * ONE WARD OR DISTRICT OUTLINE, for the map to draw around the area being browsed.
 *
 * ⛔ THE SHAPE COMES FROM OPENSTREETMAP AND IS CACHED FOREVER, which is the owner's choice after
 * being shown the alternative. Nothing in this repo has ever held a boundary: `vn-units.json` has
 * 3,321 wards as names and codes with NO coordinates, and the only geometry the map has drawn is a
 * rectangle. Sourcing a national dataset would mean maintaining it through Vietnam's 2025
 * province/ward reform; fetching one area at a time and remembering it does not.
 *
 * ⛔ IT NEVER GUESSES. `pickBoundary` takes only an administrative (or, for a district, historic)
 * boundary carrying real polygon geometry — because a plain name search returns a landuse point for
 * Thảo Điền, a customs office for Bến Nghé and a university for Thủ Đức, all measured against the
 * live API. When nothing qualifies this answers `{ boundary: null }` and the map draws nothing. An
 * outline that is a guess is worse than no outline: the reader cannot tell the two apart.
 *
 * ⚠️ MISSES ARE CACHED AS HARD AS HITS. Some areas genuinely have no boundary in OSM (2 of 20
 * sampled wards), and without a negative entry those are exactly the ones that would hit the network
 * on every view and stall for the timeout each time.
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import vnUnits from '@/data/vn-units.json'
import {
  boundaryCacheKey,
  countPoints,
  pickBoundary,
  simplifyGeometry,
  type BoundaryKind,
  type OsmResult,
} from '@/lib/geo-boundary'

export const runtime = 'nodejs'

/** A negative entry is re-checked after this long, so an area OSM gains is not denied forever. */
const MISS_TTL_DAYS = 30

type CacheRow = { geojson: unknown; found: boolean; stale: boolean }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const kindRaw = sp.get('kind')
  const name = (sp.get('name') ?? '').trim()
  const province = (sp.get('province') ?? '').trim()

  /**
   * ⛔ AN ALLOW-LIST ON EVERY PART, NOT A LENGTH BOUND. These strings are sent to a third
   * party and used as a cache key, so an unbounded one is both a cache-poisoning surface (a million
   * distinct keys, each a row and a network call) and a way to make this endpoint issue arbitrary
   * searches on our identified User-Agent — the realistic end of which is OSM banning the
   * production IP and taking the reverse-geocode route down with it. Both reviewers raised it.
   * So `name` must be an area that actually exists: one of the curated districts, or one of the
   * 3,321 wards in vn-units.json. That bounds the key space to real places, which is the same set
   * the UI can ask for anyway. The length bound stays as a cheap first gate.
   */
  const kind: BoundaryKind | null = kindRaw === 'ward' || kindRaw === 'district' ? kindRaw : null
  if (!kind || !name || !province || name.length > 80 || province.length > 80 || !isKnownArea(kind, name, province)) {
    return NextResponse.json({ boundary: null, reason: 'bad-request' }, { status: 400 })
  }

  const key = boundaryCacheKey(kind, name, province)

  try {
    const cached = await db.$queryRaw<CacheRow[]>(Prisma.sql`
      SELECT "geojson", "found", ("found" = false AND "fetchedAt" < now() - ${`${MISS_TTL_DAYS} days`}::interval) AS stale
      FROM "GeoBoundary" WHERE "key" = ${key} LIMIT 1
    `)
    const hit = cached[0]
    if (hit && !hit.stale) return respond(hit.found ? hit.geojson : null, 'cache')
  } catch {
    // A cache that cannot be read must not take the feature down — fall through to the network.
  }

  let geometry: { type: string; coordinates: unknown } | null = null
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: `${name}, ${province}`,
        format: 'jsonv2',
        polygon_geojson: '1',
        limit: '10',
        countrycodes: 'vn',
        extratags: '1',
      })
    const res = await fetch(url, {
      // The same identified agent the reverse-geocode route uses; the policy asks for a real one.
      headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' },
      signal: AbortSignal.timeout(8000),
    })
    /**
     * ⛔ A NON-200 IS NOT A MISS EITHER, AND THIS IS THE SUBTLE ONE. Nominatim answers 429 when the
     * one-request-per-second policy is exceeded; without this early return that 429 would fall
     * through with `geometry === null` and be WRITTEN as `found = false` — denying a perfectly real
     * ward for the full thirty-day negative TTL because we were briefly too quick. Only a completed
     * lookup that actually saw OSM's answer may record a miss.
     */
    if (!res.ok) return failed(`upstream-${res.status}`)
    const picked = pickBoundary((await res.json()) as OsmResult[], kind, name)
    if (picked?.geojson) {
      const before = countPoints(picked.geojson)
      geometry = simplifyGeometry(picked.geojson)
      if (geometry) console.log(`[boundary] ${key} ${before} → ${countPoints(geometry)} points`)
    }
  } catch {
    // A timeout or a DNS failure is not evidence that the area has no boundary — return without
    // writing anything, so the next request tries again instead of meeting a cached lie.
    return failed('upstream-error')
  }

  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "GeoBoundary" ("key", "geojson", "found", "fetchedAt")
      VALUES (${key}, ${geometry ? JSON.stringify(geometry) : null}::jsonb, ${geometry !== null}, now())
      ON CONFLICT ("key") DO UPDATE SET
        "geojson" = EXCLUDED."geojson", "found" = EXCLUDED."found", "fetchedAt" = now()
    `)
  } catch {
    // Failing to remember is survivable; failing to answer is not.
  }
  return respond(geometry, 'origin')
}

/**
 * ⛔ A FAILURE IS NEVER CACHED — NOT IN THE DB, AND NOT AT THE EDGE EITHER, which is the half the
 * first version missed and both reviewers caught. The route was careful not to write `found = false`
 * on a 429 or a timeout, then returned that empty answer with `s-maxage=86400`: Cloudflare and every
 * browser would have remembered "this area has no outline" for a day from one transient blip, with
 * no way back short of purging the whole zone. `no-store` keeps a failure a failure.
 */
function failed(source: string) {
  return NextResponse.json({ boundary: null, transient: true }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'X-Boundary-Source': source },
  })
}

function respond(boundary: unknown, source: string) {
  return NextResponse.json(
    { boundary },
    {
      headers: {
        // An administrative boundary changes on the order of years, and a miss is re-checked by the
        // TTL above rather than by the edge, so this can be cached hard.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'X-Boundary-Source': source,
      },
    },
  )
}


/**
 * Is this a real area we are willing to look up? The UI can only offer a curated district or a ward
 * from `vn-units.json`, so anything else is either a stale link or someone probing — and both should
 * cost one comparison rather than a row and an outbound request.
 */
/** Built from the 3,321 wards on first use, then kept for the life of the process. */
let wardNames: Set<string> | undefined
let provinceNames: Set<string> | undefined
function isKnownArea(kind: BoundaryKind, name: string, province: string): boolean {
  const fold = (v: string) => v.normalize('NFC').trim().toLowerCase()
  /**
   * ⚠️ THE PROVINCE IS CHECKED TOO (reviewer). Bounding only `name` left half the third-party query
   * string attacker-chosen: the same ward name with 80 characters of arbitrary province would mint
   * a fresh cache row and a fresh outbound Nominatim call every time, which is exactly the ban risk
   * the allow-list exists to close.
   */
  if (!provinceNames) {
    provinceNames = new Set<string>()
    for (const p of vnUnits as { name: string; nameEn?: string }[]) {
      provinceNames.add(fold(p.name))
      if (p.nameEn) provinceNames.add(fold(p.nameEn))
    }
  }
  if (!provinceNames.has(fold(province))) return false
  if (kind === 'district') {
    return DISTRICTS.some((d) => d.slug !== 'all' && (fold(d.name) === fold(name) || fold(d.nameEn) === fold(name)))
  }
  if (!wardNames) {
    wardNames = new Set<string>()
    for (const p of vnUnits as { name: string; wards: { name: string; nameEn: string }[] }[]) {
      for (const w of p.wards ?? []) { wardNames.add(fold(w.name)); wardNames.add(fold(w.nameEn)) }
    }
  }
  return wardNames.has(fold(name))
}
