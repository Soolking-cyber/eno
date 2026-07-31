// GET /api/listings semantic-search machinery: the Vertex ranked-ID cache, the global
// daily budget, and the semantic ranking + pagination path. Extracted verbatim from
// route.ts — the rankCache singleton lives here (exactly one module instance).
import { scopedListingWhere } from '@/lib/edition-scope'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { LISTING_CARD_SELECT } from '@/lib/serialize'
import { rateLimit } from '@/lib/ratelimit'
import { vertexSearchListingIds, vertexConfigured } from '@/lib/vertex-search'
import { searchScore, relevanceFromPosition } from '@/lib/ranking'

// Vertex ranked-ID cache (keyed by the exact Vertex args: q + category + price band).
// Pagination MUST use one ranked set across pages — re-querying Vertex per page can
// return a slightly different order (rows duplicated on one page, skipped on the next)
// AND spends the credit on every page. 15 min TTL: search result order for a given query
// doesn't need sub-minute freshness, and every cache miss is REAL MONEY once the Vertex
// credit exhausts (~$1.50/1k queries) — this is a paid-API cache, not a UX cache.
const RANK_TTL = 15 * 60_000
const RANK_CACHE_MAX = 200
const rankCache = new Map<string, { at: number; ids: string[] }>()
// Global daily ceiling on ACTUAL Vertex calls (cache hits are free and don't count).
// This is the public, anonymous browse path — without a hard ceiling, post-credit spend
// is unbounded (bots/scrapers included). When the budget is spent (or Redis is down —
// strict, fail-closed), search falls back to the keyword path: degraded ranking, $0.
const VERTEX_DAILY_BUDGET = 5000

// Semantic ranking: for a text query on the default sort, rank results via Vertex AI
// Search (semantic + multilingual + typo-tolerant) — which draws the credit — instead
// of literal keyword AND-match. We re-apply every STRUCTURAL filter on the DB side as
// a safety net (dropping only the keyword tokens) and restore Vertex's relevance order.
// Falls back to the keyword query already in `where` when Vertex is unconfigured, empty,
// or slow — so this is a pure ranking upgrade with no regression risk.
export async function semanticRank(args: {
  q: string | undefined
  looseMatch: boolean
  featuredOnly: boolean
  sort: string
  category: string | undefined
  priceMin: number
  priceMax: number
  offset: number
  limit: number
  andFilters: Prisma.ListingWhereInput[]
  pgTextFilter: Prisma.ListingWhereInput | null
  orderBy: Prisma.ListingOrderByWithRelationInput[]
}): Promise<{ semanticListings: any[] | null; semanticTotal: number }> {
  const { q, looseMatch, featuredOnly, sort, category, priceMin, priceMax, offset, limit, andFilters, pgTextFilter, orderBy } = args
  let semanticListings: any[] | null = null
  let semanticTotal = 0
  // Vertex only for queries of ≥3 chars (q is already trimmed at parse) — instant search
  // debounces at 150ms, so 1-2 char prefixes ("h", "ho") fire constantly, cost a paid call
  // each, and rank poorly anyway; short VN terms ("xe", "tv") still get the keyword path.
  if (q && q.length >= 3 && !looseMatch && !featuredOnly && sort === 'newest' && vertexConfigured()) {
    const minP = Number.isNaN(priceMin) ? null : priceMin
    const maxP = Number.isNaN(priceMax) ? null : priceMax
    const catArg = category && category !== 'all' ? category : null
    // Reuse one ranked set across pages: key on the exact Vertex args (structural
    // filters like district/condition aren't sent to Vertex — they're applied in the
    // DB below — so two pages differing only in those still share the ranked order).
    const rankKey = JSON.stringify({ q, catArg, minP, maxP })
    let ids: string[] | null = null
    const hit = rankCache.get(rankKey)
    if (hit && Date.now() - hit.at < RANK_TTL) {
      // Reuse the cached DECISION — a ranked id list, OR [] meaning "Vertex missed here".
      // Reusing the miss too is what stops the visible re-sort: once a query falls back to
      // keyword/rankScore order, a refetch within the window won't suddenly flip to a
      // (now-warm) Vertex ranking — and a cached hit likewise stays put. The order for a
      // given query is fixed for RANK_TTL instead of depending on Vertex warmth/timing.
      ids = hit.ids
    } else {
      // Charge the GLOBAL daily budget only for actual Vertex calls (cache hits are free).
      // Budget spent or Redis down (strict) → keyword fallback, uncached, so ranking
      // recovers the moment the window resets — never a user-facing error.
      const budget = await rateLimit('listings-vertex', 'global', VERTEX_DAILY_BUDGET, '1 d', { strict: true })
      if (budget.success) {
        ids = await Promise.race([
          vertexSearchListingIds(q, { categorySlug: catArg, minPriceVnd: minP, maxPriceVnd: maxP, take: 120 }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)), // never hang a search on Vertex
        ])
        // Cache the decision EITHER WAY — a ranking or a miss ([]) — so it's stable for the window.
        if (rankCache.size >= RANK_CACHE_MAX) rankCache.delete(rankCache.keys().next().value!) // evict oldest (insertion order)
        rankCache.set(rankKey, { at: Date.now(), ids: ids && ids.length ? ids : [] })
      }
    }
    if (ids && ids.length) {
      const structural = andFilters.filter((f) => f !== pgTextFilter)
      // Rank over 3 fields only — the old full-include here dragged ≤120 complete
      // rows (searchText, description, Seller) through Postgres to serve 24.
      const rows = await db.listing.findMany({
        where: { AND: [...structural, { id: { in: ids } }] },
        select: { id: true, sellerTrustScore: true, postedAt: true },
      })
      const byId = new Map(rows.map((r) => [r.id, r]))
      const vertexOrder = ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => !!r)
      // Blend Vertex relevance with the bounded trust⊕recency edge (relevance-led 0.6/0.3/
      // 0.1). Vertex's clearly-best matches keep the top (steep position decay), but a
      // trusted, fresher seller outranks an equally-relevant standard one — so trust counts
      // in search too, not just browse. Re-rank the WHOLE ≤120 set, then page over it.
      const nowTs = Date.now()
      const ranked = vertexOrder
        .map((r, i) => ({ r, _s: searchScore({ relevance: relevanceFromPosition(i), sellerTrustScore: r.sellerTrustScore, postedAt: r.postedAt }, nowTs) }))
        .sort((a, b) => b._s - a._s)
        .map((x) => x.r)
      const rankedIds = ranked.map((r) => r.id)
      const R = ranked.length
      // True total: relevance-ranked set (top ≤120) + literal keyword matches NOT already
      // ranked. So deep pages of a popular query (>120 matches) keep loading instead of
      // capping at 120, and the displayed result count is honest. `total` always equals
      // the paginable count, so the client's load-more (listings.length < total) terminates.
      const tailWhere: Prisma.ListingWhereInput = { AND: [...andFilters, { id: { notIn: rankedIds } }] }
      // Fetch card rows for THIS page's ranked slice only, restoring rank order.
      const pageIds = ranked.slice(offset, offset + limit).map((r) => r.id)
      const [tailTotal, pageRows] = await Promise.all([
        db.listing.count({ where: tailWhere }),
        pageIds.length
          ? db.listing.findMany({ where: await scopedListingWhere({ id: { in: pageIds } }), select: LISTING_CARD_SELECT })
          : [],
      ])
      semanticTotal = R + tailTotal
      const pageById = new Map(pageRows.map((r) => [r.id, r] as const))
      const aPart = pageIds.map((id) => pageById.get(id)).filter((r): r is (typeof pageRows)[number] => !!r)
      if (aPart.length < limit && offset + limit > R && tailTotal > 0) {
        // This page reaches past the ranked set — fill the remainder from rankScore-ordered
        // results (the same blend), excluding the ids already shown in the ranked portion.
        const tailRows = await db.listing.findMany({
          where: tailWhere,
          orderBy,
          skip: Math.max(0, offset - R),
          take: limit - aPart.length,
          select: LISTING_CARD_SELECT,
        })
        semanticListings = [...aPart, ...tailRows]
      } else {
        semanticListings = aPart
      }
    }
  }
  return { semanticListings, semanticTotal }
}
