/**
 * THE KEYWORD SEARCH PATH'S ORDER — relevance, the way the semantic path already had it.
 *
 * ⛔ IN PRODUCTION THIS IS THE ONLY SEARCH PATH, AND IT USED TO HAVE NO RELEVANCE AT ALL. Vertex
 * (semantic-rank.ts) needs K_SERVICE for its credentials and the box is not Cloud Run, so a text query
 * was ordered by the BROWSE rankScore and then dealt out one row per seller by the default feed's
 * round-robin. That round-robin lifted each seller's best-ranked match into round one — including
 * sellers whose only match was a passing mention in a description. Measured 2026-09-29: q=iphone
 * opened on a Viettel eSIM, then an Under Armour tote bag, then the first iPhone.
 *
 * What this does instead, for the default sort only (an explicit sort is the reader's order):
 *   1. Candidates: the query's best 600 rows by rankScore, plus up to 300 more whose TITLE, model,
 *      brand or aisle holds a query term (pool B — recall for strong rows pool A missed).
 *   2. Score each with text-relevance.ts and keep the STRONG rows — every unit found in the row's own
 *      title, model, brand or category. Order them by the owner's searchScore (0.50 relevance · 0.40
 *      trust · 0.10 recency — unchanged), then rankScore, then id.
 *   3. Exact ties only are dealt out by seller + model, so fourteen variants of one phone alternate
 *      with other models instead of arriving as a block. Relevance itself is never overruled.
 *   4. Page over that ranked list, then the rest of the matches (the weak ones included) in rankScore
 *      order — ranked-page.ts, the same pagination the semantic path uses.
 * The row SET is exactly the feed's `where`; only the order changes, so `total` is unchanged.
 */
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { fold } from '@/lib/fold'
import { searchScore } from '@/lib/ranking-formula'
import { DEFAULT_FEED_SORT, diversifyBySeller } from '@/lib/feed-diversity'
import { parseSearchQuery, scoreRow, subcategoryIntent, type ParsedQuery, type RelevanceRow } from '@/lib/text-relevance'
import { pageRankedThenTail, RANKED_SET_TTL } from './ranked-page'

/** The narrow projection ranking needs — no card fields, no description. */
export const RANK_SELECT = {
  id: true, sellerId: true, title: true, titleVi: true, model: true, brandSlug: true, subcategorySlug: true,
  sellerTrustScore: true, postedAt: true, rankScore: true,
  category: { select: { slug: true, name: true, nameVi: true } },
} as const

type RankRow = Prisma.ListingGetPayload<{ select: typeof RANK_SELECT }>

/** Pool A (by rankScore) and pool B (title hits) — see the header. ≤900 ranked ids per query. */
const POOL_A = 600
const POOL_B = 300
const RANK_ORDER: Prisma.ListingOrderByWithRelationInput[] = [{ rankScore: 'desc' }, { id: 'desc' }]

/**
 * ONE ranked id list per (scoped where, query), reused by every page of that search. The TTL is the
 * semantic path's (RANKED_SET_TTL) and for the same reason: it must outlive the edge's
 * stale-while-revalidate, or a reader's later pages re-rank under them and repeat rows. Concurrent
 * identical requests share one computation (the count cache's shape, feed-query.ts). A failure is not
 * cached. Hidden or sold rows cannot be served from it: each page re-applies `where` (ranked-page.ts).
 */
const RANK_CACHE_MAX = 200
const rankCache = new Map<string, { at: number; ids: string[] }>()
const rankInFlight = new Map<string, Promise<string[]>>()

/** Test seam: forget every cached ranking. */
export function __resetKeywordRankCache() {
  rankCache.clear()
  rankInFlight.clear()
}

/**
 * The title-hit clause for pool B: per unit, ANY of its terms in the title, the Vietnamese title (as
 * folded AND as typed — ILIKE cannot fold accents), the model, the brand slug, or the aisle the term
 * names. ANDed across units, like the text filter it narrows.
 */
export function strongSql(query: ParsedQuery): Prisma.ListingWhereInput {
  return {
    AND: query.units.map((u, i) => {
      const or: Prisma.ListingWhereInput[] = []
      for (const t of u.terms) {
        or.push({ title: { contains: t, mode: 'insensitive' } }, { titleVi: { contains: t, mode: 'insensitive' } })
        or.push({ model: { contains: t, mode: 'insensitive' } }, { brandSlug: { startsWith: t.replace(/\s+/g, '-') } })
        const aisles = subcategoryIntent(t)
        if (aisles.size) or.push({ subcategorySlug: { in: [...aisles] } })
      }
      const typed = query.typed[i]
      if (typed && typed !== u.terms[0]) or.push({ titleVi: { contains: typed, mode: 'insensitive' } })
      return { OR: or }
    }),
  }
}

/**
 * Both candidate pools for an ALREADY-SCOPED `where`, merged by id (pool A's order first). Exported
 * for the typeahead, which ranks its six suggestions the same way.
 */
export async function rankCandidates<S extends Prisma.ListingSelect>(
  scopedWhere: Prisma.ListingWhereInput,
  query: ParsedQuery,
  opts: { takeA: number; takeB: number; select: S },
): Promise<Prisma.ListingGetPayload<{ select: S }>[]> {
  // edition-lint-allow: both reads use `scopedWhere`, which every caller builds with scopedListingWhere.
  // No units, no title hits to look for (a query that was only a district) — pool A alone.
  const [a, b] = await Promise.all([
    db.listing.findMany({ where: scopedWhere, orderBy: RANK_ORDER, take: opts.takeA, select: opts.select }),
    query.units.length
      ? db.listing.findMany({ where: { AND: [scopedWhere, strongSql(query)] }, orderBy: RANK_ORDER, take: opts.takeB, select: opts.select })
      : [],
  ])
  const byId = new Map<string, Prisma.ListingGetPayload<{ select: S }>>()
  for (const r of [...a, ...b]) {
    const id = (r as { id: string }).id
    if (!byId.has(id)) byId.set(id, r)
  }
  return [...byId.values()]
}

type Rankable = RelevanceRow & { id: string; sellerId: string; sellerTrustScore: number; postedAt: Date; rankScore: number }

const byRankDesc = (a: Rankable, b: Rankable) => b.rankScore - a.rankScore || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/**
 * Candidates → the STRONG rows in relevance order, and the weak rows in rankScore order. Pure given
 * `now`, so the same candidates always rank the same way.
 */
export function relevanceOrder<R extends Rankable>(rows: readonly R[], query: ParsedQuery, now: number): { strong: R[]; weak: R[] } {
  const strong: { r: R; s: number }[] = []
  const weak: R[] = []
  for (const r of rows) {
    const { relevance, strong: isStrong } = scoreRow(r, query)
    if (isStrong) strong.push({ r, s: searchScore({ relevance, sellerTrustScore: r.sellerTrustScore, postedAt: r.postedAt }, now) })
    else weak.push(r)
  }
  strong.sort((a, b) => b.s - a.s || byRankDesc(a.r, b.r))
  /**
   * ⚠️ EXACT TIES ONLY. Rows whose scores round to the same thousandth are indistinguishable to the
   * formula — typically one importer's variants of one product, posted together by one trusted
   * seller. Inside such a run they are dealt out by seller + model (the model, else the title's first
   * three words), so the run alternates products instead of repeating one. Nothing crosses a run
   * boundary, so no row ever moves above a better-scoring one.
   */
  const out: R[] = []
  for (let i = 0; i < strong.length; ) {
    const key = Math.round(strong[i].s * 1000)
    let j = i + 1
    while (j < strong.length && Math.round(strong[j].s * 1000) === key) j++
    const run = strong.slice(i, j).map((x) => x.r)
    if (run.length < 3) out.push(...run)
    else {
      const proxies = run.map((r) => ({ id: r.id, sellerId: `${r.sellerId}|${fold(r.model || '') || fold(r.title).split(/\s+/).slice(0, 3).join(' ')}`, r }))
      out.push(...diversifyBySeller(proxies).map((p) => p.r))
    }
    i = j
  }
  return { strong: out, weak: [...weak].sort(byRankDesc) }
}

async function rankedIdsFor(scopedWhere: Prisma.ListingWhereInput, q: string, query: ParsedQuery): Promise<string[]> {
  const key = JSON.stringify({ where: scopedWhere, q })
  const hit = rankCache.get(key)
  if (hit && Date.now() - hit.at < RANKED_SET_TTL) {
    rankCache.delete(key)
    rankCache.set(key, hit)
    return hit.ids
  }
  const running = rankInFlight.get(key)
  if (running) return running
  const work = rankCandidates(scopedWhere, query, { takeA: POOL_A, takeB: POOL_B, select: RANK_SELECT })
    .then((rows: RankRow[]) => {
      const ids = relevanceOrder(rows, query, Date.now()).strong.map((r) => r.id)
      rankCache.delete(key)
      if (rankCache.size >= RANK_CACHE_MAX) rankCache.delete(rankCache.keys().next().value!) // evict oldest
      rankCache.set(key, { at: Date.now(), ids })
      return ids
    })
    .finally(() => rankInFlight.delete(key))
  rankInFlight.set(key, work)
  return work
}

/**
 * The page of a keyword search on the default sort, relevance-ranked — or null when this path does
 * not apply (no query, an explicit sort, `match=any`, featured-only), in which case the route serves
 * the feed exactly as before. ⚠️ FAIL-SOFT: a failed ranking read is logged and answered with null,
 * i.e. the old order, never a 500.
 */
export async function keywordRank(args: {
  q: string | undefined
  looseMatch: boolean
  featuredOnly: boolean
  sort: string
  offset: number
  limit: number
  where: Prisma.ListingWhereInput
  orderBy: Prisma.ListingOrderByWithRelationInput[]
}): Promise<{ keywordListings: Awaited<ReturnType<typeof pageRankedThenTail>> | null }> {
  const { q, looseMatch, featuredOnly, sort, offset, limit, where, orderBy } = args
  if (!q || looseMatch || featuredOnly || sort !== DEFAULT_FEED_SORT) return { keywordListings: null }
  const query = parseSearchQuery(q)
  if (!query.units.length) return { keywordListings: null }
  try {
    const rankedIds = await rankedIdsFor(await scopedListingWhere(where), q, query)
    return { keywordListings: await pageRankedThenTail({ rankedIds, pageWhere: where, tailWhere: where, orderBy, offset, limit }) }
  } catch (e) {
    console.error('[keyword-rank] ranking failed — serving the unranked feed order', e)
    return { keywordListings: null }
  }
}
