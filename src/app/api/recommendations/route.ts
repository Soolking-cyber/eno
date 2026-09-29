import { scopedListingWhere } from '@/lib/edition-scope'
import { NextRequest, NextResponse } from 'next/server'
import { localizeListingTitles } from '@/lib/translate'
import { Prisma } from '@/generated/prisma/client'
import { fold } from '@/lib/fold'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { diverseRailListings, trendingRailListings } from '@/lib/core/trending-rail'

export const dynamic = 'force-dynamic'

const LIMIT = 16
/** The personalized rail chooses its LIMIT from this many (diversifyRail, via diverseRailListings). */
const PERSONAL_POOL = 48
const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }
const split = (v: string | null, n: number) =>
  (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []).slice(0, n)

// "For You" recommendations. Personalizes from the caller's OWN on-site signals
// (recent search terms + viewed categories/brands, passed as query params from
// localStorage); falls back to Trending (most-viewed) when there's no signal. Always
// trust-ranked. Public-safe (verified + active only), so it can't leak anything the
// feed wouldn't.
//
// ⚠️ WS6 — NOT MIGRATED: the throttled answer carries a DOMAIN payload, not an error envelope. It is
// `{"listings":[],"personalized":false}` at 429, and `apiFail()` can only emit `{"error":"<code>"}`,
// so hoisting the limiter into `rateLimit:` would change those bytes. Public, and a GET with no JSON
// body, so with the limiter pinned in the handler all four options are empty — churn, not a wrapper.
//
// ⚠️ THAT IS THE WHOLE REASON, AND IT IS DELIBERATELY NOT AN ARGUMENT ABOUT THE CLIENT. The first
// draft justified the skip by saying a throttled caller "decodes a normal empty payload and
// self-hides"; the review checked and it does not — `for-you-rail.tsx:53` is
// `.then((r) => (r.ok ? r.json() : null))`, so a 429 is `!r.ok` and the body is discarded unread.
// The skip stands on the bytes alone. A wire fact survives a client refactor; a client fact does not.
export async function GET(req: NextRequest) {
  // Public + runs user-controlled substring scans against the DB — cap per IP so it can't
  // be turned into a cheap scraping/DB-load tool. Generous for real page loads.
  const rl = await rateLimit('recommendations', clientIp(req), 60, '1 m')
  if (!rl.success) return NextResponse.json({ listings: [], personalized: false }, { status: 429 })

  const sp = req.nextUrl.searchParams
  const cats = split(sp.get('cats'), 6)
  const brands = split(sp.get('brands'), 6)
  const terms = split(sp.get('terms'), 6)
  // ⚠️ SAFE TO SCOPE `base` HERE, unlike the AI concierge. Both consumers compose it as an AND
  // OPERAND (`{ AND: [base, …] }`) rather than spreading it, so the wrapper survives. The concierge
  // builds `{ ...base, ...cat, AND: and(n) }` and would overwrite it — do not copy this pattern
  // there without checking how the predicate is consumed.
  const base: Prisma.ListingWhereInput = await scopedListingWhere({ verified: true, status: 'active' })

  // Relevance = listings in a category/brand the user has engaged with, OR matching a
  // recent search term (against the folded searchText blob). Broad OR — this is
  // discovery, not a strict filter.
  const or: Prisma.ListingWhereInput[] = []
  if (cats.length) or.push({ category: { slug: { in: cats } } })
  if (brands.length) or.push({ brandSlug: { in: brands } })
  for (const t of terms) {
    const f = fold(t)
    if (f.length >= 2) or.push({ searchText: { contains: f } })
  }

  const personalized = or.length > 0

  /**
   * ⛔ NO SIGNALS → THE SAME TRENDING RAIL THE HOME PAGE SEEDS (trendingRailListings), not a second
   * copy of it. The two used to be separate queries that merely looked alike; now the seed and this
   * fetch cannot disagree, and both are chosen by diversifyRail (one card per seller/model, no
   * repeated cover). Its thin-catalog guard is the one this branch had: under ~2 feed pages the rail
   * would mirror the grid card-for-card, so it answers [] (rails self-hide on empty) until supply grows.
   */
  const rows = personalized
    // Balanced rankScore blend — same hierarchy as the rest of the app: trusted-and-fresh sellers
    // lead, then popularity (views). Personalization only changes the WHERE, not the ranking — a
    // low-trust listing never tops the rail. Chosen from the top PERSONAL_POOL like the trending rail.
    ? await diverseRailListings({ AND: [base, { OR: or }] }, [RANK, { views: 'desc' }, { id: 'desc' }], { pool: PERSONAL_POOL, take: LIMIT })
    : await trendingRailListings()

  return NextResponse.json(
    { listings: await localizeListingTitles(rows, req.cookies.get('lang')?.value), personalized },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  )
}
