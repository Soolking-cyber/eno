/**
 * EVERY CURATED DISTRICT OUTLINE AT ONCE, so the map can be browsed by district instead of only
 * outlining the one already chosen.
 *
 * ⛔ CACHE-ONLY, AND THAT IS THE WHOLE DESIGN. The single-area route (`/api/geo/boundary`) may go
 * to Nominatim on a miss; this one must never, because it answers for two dozen areas and OSM's usage
 * policy is ONE request per second — a cold call would hold the connection open for the better part
 * of half a minute and, done twice concurrently, is exactly the behaviour that gets a production IP
 * banned. So this reads `GeoBoundary` and nothing else: an area that is not cached is simply absent
 * from the response, the map offers no shape for it, and `scripts/geo-warm-districts.mjs` is what
 * fills the table (out of band, at 1 req/s, once — administrative boundaries do not move).
 *
 * ⚠️ A PARTIAL ANSWER IS A VALID ANSWER — the caller draws what it gets. ⛔ AN EARLIER VERSION OF
 * THIS NOTE SAID TWO DISTRICTS ARE PERMANENTLY UNREACHABLE, WHICH IS NO LONGER TRUE and made the
 * long-TTL branch below look like dead code (reviewers read it that way, correctly, from the
 * comment). Since the country-scoped fallback in `districtQueryCandidates`, all of the curated
 * districts resolve — including Thủ Đức and Cần Giờ, which the 2025 reform had moved out from under
 * the province — so a fully warmed table DOES make `complete` true and earn the 24h TTL.
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import vnUnits from '@/data/vn-units.json'
import { boundaryCacheKey } from '@/lib/geo-boundary'

export const runtime = 'nodejs'

type Row = { key: string; geojson: unknown; found: boolean }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const province = (sp.get('province') ?? '').trim()

  /**
   * ⚠️ THE PROVINCE IS STILL ALLOW-LISTED even though nothing here can reach a third party. It is a
   * SQL parameter, not a URL, so this is not an injection guard — it keeps the endpoint from being
   * a cheap way to probe the cache table with arbitrary keys, and it costs one Set lookup.
   */
  const canonical = canonicalProvince(province)
  if (!province || province.length > 80 || !canonical) {
    return NextResponse.json({ boundaries: [] }, { status: 400 })
  }

  // The curated districts are the only ones this endpoint will ever answer for; build the exact key
  // set rather than pattern-matching the table, so a stray row can never widen the response.
  const wanted = DISTRICTS.filter((d) => d.slug !== 'all').map((d) => ({
    slug: d.slug,
    name: d.name,
    nameEn: d.nameEn,
    key: boundaryCacheKey('district', d.name, canonical),
  }))

  let rows: Row[] = []
  try {
    /**
     * ⚠️ READ THE MISSES TOO, because "complete" means SETTLED, not "has a shape" — see the TTL
     * note below. `found` comes back so the caller can still be handed only the drawable ones.
     */
    rows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT "key", "geojson", "found" FROM "GeoBoundary"
      WHERE "key" IN (${Prisma.join(wanted.map((w) => w.key))})
    `)
  } catch {
    // A cache that cannot be read means no shapes to hover, not a broken page.
    return NextResponse.json({ boundaries: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const byKey = new Map(rows.filter((r) => r.found).map((r) => [r.key, r.geojson]))
  const settled = new Set(rows.map((r) => r.key)) // looked up at all, hit or definitive miss
  const boundaries = wanted
    .filter((w) => byKey.has(w.key))
    .map((w) => ({ slug: w.slug, name: w.name, nameEn: w.nameEn, geojson: byKey.get(w.key) }))

  /**
   * ⛔ AN INCOMPLETE LIST IS CACHED FOR MINUTES, A COMPLETE ONE FOR A DAY — and conflating the two
   * is the trap a reviewer caught. The first request after a deploy can arrive BEFORE the warm run
   * has populated anything; with one TTL for both answers, that empty array would sit in the edge
   * cache for a day (and be servable stale for a week) while the table behind it was full. The
   * feature would look broken for a day with nothing wrong in the database.
   * ⛔ "COMPLETE" MEANS SETTLED, NOT "HAS A SHAPE" — and getting that wrong makes the long TTL dead
   * code. Some curated districts have NO boundary in OSM and never will: measured 2026-09-24,
   * "Quận 2" returns a neighbourhood in Hội An and "Quận 9" returns Quân khu 9, a Mekong Delta
   * military region, both correctly refused by `pickBoundary`'s name and type checks. Defining
   * complete as `boundaries.length === wanted.length` would therefore be permanently false the
   * moment such a district is curated, pinning every reader to the 5-minute TTL forever. A district
   * the route has looked up and definitively recorded as a miss is FINISHED, not pending — so what
   * this asks is "is anything still unknown?".
   */
  const complete = wanted.every((w) => settled.has(w.key))
  return NextResponse.json(
    { boundaries, complete },
    {
      headers: {
        'Cache-Control': complete
          ? 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800'
          : 'public, max-age=60, s-maxage=300',
        'X-Boundary-Count': String(boundaries.length),
        'X-Boundary-Complete': complete ? '1' : '0',
      },
    },
  )
}

/**
 * The province's VIETNAMESE name, whichever spelling was asked for — or null if it is not a real
 * province.
 *
 * ⛔ ACCEPTING `nameEn` AND THEN KEYING ON IT IS A SILENT PERMANENT MISS (reviewer). Cache keys are
 * built from the Vietnamese name, because that is what the single-area route stores; a request for
 * `?province=Ho Chi Minh City` passed the old allow-list, built keys off the English string,
 * matched zero rows and returned an empty list forever — with a 400 nowhere in sight, so it read as
 * "this province has no districts" rather than as the spelling mismatch it was. Resolving to the
 * canonical name makes both spellings answer identically.
 */
let provinceByAnyName: Map<string, string> | undefined
function canonicalProvince(province: string): string | null {
  const fold = (v: string) => v.normalize('NFC').trim().toLowerCase()
  if (!provinceByAnyName) {
    provinceByAnyName = new Map<string, string>()
    for (const p of vnUnits as { name: string; nameEn?: string }[]) {
      provinceByAnyName.set(fold(p.name), p.name)
      if (p.nameEn) provinceByAnyName.set(fold(p.nameEn), p.name)
    }
  }
  return provinceByAnyName.get(fold(province)) ?? null
}
