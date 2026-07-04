import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { matchBrand, categoryHasBrand } from '@/lib/brand'
import { fold } from '@/lib/fold'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

// Search intent resolver — "best match", not exact. Does a typed query name a brand
// and/or a model? Opens the matching category + brand (+ model) facets instead of a
// keyword search. Read-only; never mutates.
//   "huawei watch" → exact brand Huawei + best model "Watch GT 4"
//   "watch gt"     → best model "Watch GT 4" (its brand + category)
//   "matepad"      → best model "MatePad 11"
//   "hawei"        → typo → closest brand "Huawei"
//   anything else  → { brand: null }  (caller falls back to a text search)
const headers = { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' }
const ok = (body: object) => NextResponse.json(body, { headers })
const empty = ok({ brand: null })

/** The category where this brand has the most live listings — the one to open.
 *  Ordered by live listing count, but counting BUY/SELL intent first: a typed brand
 *  is shopping intent, and the all-rent `rentals` category would otherwise outweigh
 *  the brand's sales category (Honda: 36 rentals vs 23 vehicles → must open
 *  vehicles). Rent-only brands still resolve via the all-intents fallback. */
async function dominantCategory(brandSlug: string): Promise<string | null> {
  const topCategoryId = async (excludeRent: boolean): Promise<string | null> => {
    const grouped = await db.listing.groupBy({
      by: ['categoryId'],
      where: { verified: true, status: 'active', brandSlug, ...(excludeRent ? { listingType: { not: 'rent' } } : {}) },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 1,
    })
    return grouped[0]?.categoryId ?? null
  }
  const categoryId = (await topCategoryId(true)) ?? (await topCategoryId(false))
  if (!categoryId) return null
  const cat = await db.category.findUnique({ where: { id: categoryId }, select: { slug: true } })
  return cat?.slug ?? null
}

type ModelHit = { brand: string; model: string; category: string | null }

// Best-match a model from the given query tokens (each must appear in the model,
// order-insensitive), scoped to a brand when we have one. Ranks exact > prefix >
// substring > token-match, tie-broken by length-closeness then live demand.
async function bestModelMatch(tokens: string[], brand: string | null): Promise<ModelHit | null> {
  if (tokens.length === 0) return null
  const rows = await db.listing.findMany({
    where: {
      verified: true,
      status: 'active',
      brandSlug: brand ? brand : { not: null },
      AND: tokens.map((t) => ({ model: { contains: t, mode: 'insensitive' as const } })),
    },
    select: { model: true, brandSlug: true, views: true, contactCount: true, category: { select: { slug: true } } },
    take: 120,
  })

  const fq = tokens.join(' ')
  const groups = new Map<string, { brand: string; model: string; cats: Map<string, number>; n: number; demand: number }>()
  for (const r of rows) {
    if (!r.model || !r.brandSlug) continue
    const key = `${r.brandSlug}|${r.model}`
    const g = groups.get(key) || { brand: r.brandSlug, model: r.model, cats: new Map(), n: 0, demand: 0 }
    g.n++
    g.demand += (r.views ?? 0) + 5 * (r.contactCount ?? 0)
    const cs = r.category?.slug
    if (cs) g.cats.set(cs, (g.cats.get(cs) || 0) + 1)
    groups.set(key, g)
  }

  const scored = [...groups.values()].map((g) => {
    const fm = fold(g.model)
    let s = fm === fq ? 100 : fm.startsWith(fq) ? 60 : fm.includes(fq) ? 40 : 20
    s -= Math.abs(fm.length - fq.length) * 0.5 // prefer the model closest to the query
    s += Math.min(g.demand, 100) * 0.05 + Math.min(g.n, 20) * 0.2 // popularity tiebreak
    return { g, s }
  }).sort((a, b) => b.s - a.s)

  const best = scored[0]?.g
  if (!best) return null
  const category = [...best.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
  return { brand: best.brand, model: best.model, category }
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  // A brand/model is a few words; skip sentences (those want a keyword search).
  if (q.length < 2 || q.length > 40 || q.split(/\s+/).length > 5) return empty

  // Public + runs Levenshtein over the brand catalogue + a 120-row ILIKE scan per
  // call → IP throttle to bound DB amplification.
  const ip = clientIp(req)
  const rl = await rateLimit('search-resolve', ip, 120, '1 m')
  if (!rl.success) return empty

  const tokens = fold(q).split(' ').filter(Boolean)

  // 1) Exact/alias brand from the leading token(s) — safe to strip ("Huawei Watch"
  //    → brand Huawei, rest "watch"). Try a 2-word brand first ("Louis Vuitton").
  let brand: string | null = null
  let used = 0
  for (const take of [2, 1]) {
    if (tokens.length < take) continue
    const m = await matchBrand(tokens.slice(0, take).join(' '), 0) // exact/alias only
    if (m) { brand = m; used = take; break }
  }

  // 2) Best model on the remaining tokens (or the whole query when no brand). Drop
  //    1-char tokens so a stray "4" can't broaden the match.
  const rest = tokens.slice(used).filter((t) => t.length >= 2)
  const modelTokens = rest.length ? rest : brand ? [] : tokens.filter((t) => t.length >= 2)
  const model = await bestModelMatch(modelTokens, brand)
  if (model) return ok({ brand: model.brand, model: model.model, category: model.category })

  // 3) Exact brand with no model → open the brand.
  if (brand) {
    const category = await dominantCategory(brand)
    if (category && categoryHasBrand(category)) return ok({ brand, model: null, category })
  }

  // 4) Typo fallback: the whole query is a misspelled brand ("hawei" → Huawei). Only
  //    now (no exact brand, no model) so a real word can't get yanked onto a brand.
  const fuzzy = await matchBrand(q, 2)
  if (fuzzy) {
    const category = await dominantCategory(fuzzy)
    if (category && categoryHasBrand(category)) return ok({ brand: fuzzy, model: null, category })
  }

  return empty
}
