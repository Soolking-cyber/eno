import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { matchBrand, categoryHasBrand } from '@/lib/brand'
import { fold } from '@/lib/fold'

export const runtime = 'nodejs'

// Search intent resolver: does a typed query NAME a brand or a known model? If so,
// the search bars open the matching category + brand (+ model) facets instead of a
// keyword search (a precise facet beats a text match). Read-only; never mutates.
//   "huawei"     → { brand: 'huawei', category: 'electronics' }
//   "matepad 11" → { brand: 'huawei', model: 'MatePad 11', category: 'electronics' }
//   anything else→ { brand: null }  (caller falls back to a plain text search)
const empty = NextResponse.json(
  { brand: null },
  { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } },
)

/** The category where this brand has the most live listings — the one to open. */
async function dominantCategory(brandSlug: string): Promise<string | null> {
  const grouped = await db.listing.groupBy({
    by: ['categoryId'],
    where: { verified: true, status: 'active', brandSlug },
    _count: { _all: true },
    orderBy: { _count: { categoryId: 'desc' } },
    take: 1,
  })
  const top = grouped[0]
  if (!top) return null
  const cat = await db.category.findUnique({ where: { id: top.categoryId }, select: { slug: true } })
  return cat?.slug ?? null
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  // A brand/model is a few words; skip sentences (those want a keyword search).
  if (q.length < 2 || q.length > 40 || q.split(/\s+/).length > 4) return empty

  const foldedQ = fold(q)

  // 1) Exact model hit (most specific) — a listing's `model` that folds to the query
  //    (e.g. "matepad 11" === fold("MatePad 11")). Carries its brand + category.
  const modelRows = await db.listing.findMany({
    where: {
      verified: true,
      status: 'active',
      brandSlug: { not: null },
      model: { contains: q, mode: 'insensitive' },
    },
    select: { model: true, brandSlug: true, category: { select: { slug: true } } },
    take: 80,
  })
  const tally = new Map<string, { brand: string; model: string; cats: Map<string, number>; n: number }>()
  for (const r of modelRows) {
    if (!r.brandSlug || !r.model || fold(r.model) !== foldedQ) continue
    const key = `${r.brandSlug}|${r.model}`
    const cur = tally.get(key) || { brand: r.brandSlug, model: r.model, cats: new Map(), n: 0 }
    cur.n++
    const cs = r.category?.slug
    if (cs) cur.cats.set(cs, (cur.cats.get(cs) || 0) + 1)
    tally.set(key, cur)
  }
  const bestModel = [...tally.values()].sort((a, b) => b.n - a.n)[0]
  if (bestModel) {
    const category = [...bestModel.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    return NextResponse.json(
      { brand: bestModel.brand, model: bestModel.model, category },
      { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } },
    )
  }

  // 2) Brand name (exact / alias / 1-edit typo). Tight fuzzy so generic words don't
  //    snap onto a near-spelled brand.
  const brand = await matchBrand(q, 1)
  if (brand) {
    const category = await dominantCategory(brand)
    // Only worth opening if the brand actually has a (brand-capable) home category.
    if (category && categoryHasBrand(category)) {
      return NextResponse.json(
        { brand, model: null, category },
        { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } },
      )
    }
  }

  return empty
}
