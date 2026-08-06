import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { normalizeBrand } from '@/lib/brand-normalize'
import { rateLimit } from '@/lib/ratelimit'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Instant-match suggestions for the search bars (debounced typeahead, mobile +
// desktop). Queries the folded, accent-insensitive `searchText` (pg_trgm GIN
// index) for live listings + a few matching categories. Public → verified+active
// only, same gate as the browse feed. Intentionally lightweight (minimal select,
// small take) so it's fast enough to hit on every keystroke.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — the typeahead runs for logged-out visitors on every page.
//
// ⛔ THE RATE LIMIT IS **NOT** HANDED TO THE WRAPPER, AND THAT IS THE WHOLE CARE POINT HERE.
// `route()`'s `rateLimit:` option answers 429 `{"error":"rate_limited"}`. This route does the
// opposite on purpose: when the IP limit trips it returns **200** with an empty suggestion set, so a
// throttled keystroke silently shows no dropdown instead of erroring the search bar. Moving it into
// the option would turn a 200 into a 429 on a path the client does not handle — a wire change on
// every fast typist. The `rateLimit('search-suggest', ip, 120, '1 m')` call therefore stays inline,
// verbatim, including `clientIp(req)` (same helper the wrapper would have used for the key).
//
// ⚠️ `NextRequest` → `Request`: `req.nextUrl.searchParams` became `new URL(req.url).searchParams`.
// Same string in, same `q` out — `nextUrl` is a NextURL over the identical url, and nothing here
// touched a Next-only field.
//
// Branches, all unchanged: q < 2 chars → 200 `{q,listings:[],categories:[],brands:[]}` and NO cache
// header (as before); rate-limited → the same uncached 200 empty payload; hit → 200 with the
// max-age=10 header. Accepted wire change on the failure path only: the Promise.all of three
// unguarded DB reads (and `scopedListingWhere()`) used to throw into Next's default 500 and now
// answers `{"error":"internal_error"}` 500.
export const GET = route({ auth: 'public' }, async ({ req }) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ q, listings: [], categories: [], brands: [] })

  // Public + unindexed-ILIKE per keystroke → IP throttle to bound DB amplification.
  const ip = clientIp(req)
  const rl = await rateLimit('search-suggest', ip, 120, '1 m')
  if (!rl.success) return NextResponse.json({ q, listings: [], categories: [], brands: [] })

  const folded = fold(q)
  // AND each ≥2-char token (matches /api/listings) so multi-word typeahead narrows.
  const tokens = folded.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
  const searchAnd = tokens.length ? tokens.map((t) => ({ searchText: { contains: t } })) : [{ searchText: { contains: folded } }]
  // Brand matching key ("Louis V" → "louisv") so a spaced prefix still hits "louisvuitton".
  const brandKey = normalizeBrand(q)

  // Hoisted above the Promise.all: an await inside an array element would serialise the three
  // queries that this Promise.all exists to overlap.
  const suggestWhere = await scopedListingWhere({ verified: true, status: 'active', AND: searchAnd })
  const [listings, allCategories, brands] = await Promise.all([
    db.listing.findMany({
      where: suggestWhere,
      // Same balanced rankScore blend as the browse feed — the typeahead is a placement
      // surface too, so a trusted-and-fresh seller's match surfaces above a weaker one,
      // and the quick suggestions agree with the full results (no jarring re-sort on submit).
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
      take: 6,
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true,
        priceUnit: true, location: true, images: true,
        category: { select: { slug: true } },
      },
    }),
    // Categories are a tiny fixed set — fetch once and match on FOLDED text in JS
    // so accent-free input ("can ho") matches "Căn hộ", consistent with the
    // accent-insensitive listing search (and one fewer DB round-trip per keystroke).
    db.category.findMany({ select: { slug: true, name: true, nameVi: true } }),
    // Brands with live listings whose matching key contains the typed key ("hon" →
    // Honda) — the typeahead's "Brands" group. Most-listed first, tiny take.
    brandKey.length >= 2
      ? db.brand.findMany({
          where: { status: 'active', listingCount: { gt: 0 }, normalized: { contains: brandKey } },
          orderBy: { listingCount: 'desc' },
          take: 2,
          select: { slug: true, name: true },
        })
      : Promise.resolve([]),
  ])

  const categories = allCategories
    .filter((c) => fold(c.name).includes(folded) || fold(c.nameVi).includes(folded))
    .slice(0, 4)

  return NextResponse.json(
    {
      q,
      listings: listings.map((l) => {
        let image: string | null = null
        try { image = JSON.parse(l.images || '[]')[0] ?? null } catch { /* ignore */ }
        return {
          id: l.id, title: l.title, titleVi: l.titleVi, price: l.price,
          currency: l.currency, priceUnit: l.priceUnit, location: l.location,
          image, categorySlug: l.category.slug,
        }
      }),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, nameVi: c.nameVi })),
      brands: brands.map((b) => ({ slug: b.slug, name: b.name })),
    },
    // Public verified+active data only → safe to let the CDN absorb repeat
    // prefixes (hot terms like "ho"/"xe"), matching the /api/listings policy.
    { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' } },
  )
})
