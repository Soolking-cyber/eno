import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Distinct MODELS of a brand that are present in the live catalogue — powers the
// brand rail's tap-to-expand (e.g. Kia → Carens, Cerato, Sorento…). Optionally
// scoped to a category (the rail's current context). Ranked by listing count.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — the brand rail expands for guests. No rate limit, no body.
//
// ⚠️ THE DYNAMIC SEGMENT COMES FROM `ctx.params`, ALREADY AWAITED by the wrapper — the
// `{ params }: { params: Promise<…> }` second argument and its `await` are gone, not forgotten.
// `params.slug` is a plain string here; the value reaching the query is byte-for-byte what
// `await params` produced before.
//
// ⚠️ ACCEPTED WIRE CHANGE, FAILURE PATH ONLY: the groupBy and `scopedListingWhere()` were unguarded,
// so a throw was Next's default 500 and is now `{"error":"internal_error"}` 500. An unknown brand
// slug is NOT a failure and never was — it groups to nothing and still answers 200 `{"models":[]}`
// with the cache header, which is what the rail expects.
export const GET = route({ auth: 'public' }, async ({ req, params }) => {
  const slug = params.slug
  const sp = new URL(req.url).searchParams
  const category = sp.get('category')?.trim()
  const subcategory = sp.get('subcategory')?.trim()

  const grouped = await db.listing.groupBy({
    by: ['model'],
    // ⚠️ A LATENT LEAK, not a live one — held shut today only by the seeded desk rows having a null
    // brandSlug. createListingCore sets brandSlug from the resolver, so one desk product with a
    // brand opens it. Closed rather than left to luck. Same fix as the sibling /api/brands.
    where: await scopedListingWhere({
      verified: true,
      status: 'active',
      brandSlug: slug,
      model: { not: null },
      ...(category && category !== 'all' ? { category: { slug: category } } : {}),
      ...(subcategory && subcategory !== 'all' ? { subcategorySlug: subcategory } : {}),
    }),
    _count: { _all: true },
    _sum: { views: true, contactCount: true },
    orderBy: { _count: { model: 'desc' } },
    take: 200,
  })

  // Rank models by live demand (views + weighted contacts), then count — so the
  // most-wanted models surface first; falls back to count before any traffic.
  const models = grouped
    .filter((g) => g.model)
    .map((g) => ({ model: g.model as string, count: g._count._all, demand: (g._sum.views ?? 0) + 5 * (g._sum.contactCount ?? 0) }))
    .sort((a, b) => b.demand - a.demand || b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 60)
    .map(({ demand: _d, ...m }) => m)

  return NextResponse.json(
    { models },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
})
