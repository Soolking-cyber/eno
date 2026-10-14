/**
 * ONE PAGE OF A RANKED SEARCH: slice the page out of a ranked id list, then continue past the end of
 * that list with the rest of the result set in the feed's own order. Shared by BOTH ranking paths —
 * Vertex (semantic-rank.ts) and the lexical keyword ranker (keyword-rank.ts) — so the two cannot
 * disagree about pagination. Extracted from semantic-rank.ts, whose behaviour it keeps.
 *
 * ⚠️ TWO INDEX SPACES, AND ONLY ONE CARRIES THE OFFSET (feedPagePlan, feed-window.ts). The ranked
 * list is indexed by `offset`; the tail EXCLUDES every ranked id, so it is indexed from the end of the
 * ranked list (`offset - R`). Every page of a query therefore slices one sequence: ranked ids, then
 * everything else, no row twice and none skipped — provided every page sees the same ranked list,
 * which is why both callers cache it (RANKED_SET_TTL).
 */
import { scopedListingWhere } from '@/lib/edition-scope'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { LISTING_CARD_SELECT } from '@/lib/serialize'
import { feedPagePlan } from '@/lib/feed-window'

/**
 * How long one query's ranked id list is reused across its pages. ⛔ IT MUST OUTLIVE THE EDGE'S
 * STALENESS, NOT MATCH THE ROUTE'S s-maxage: Cloudflare may serve page 1 for s-maxage=60 plus
 * stale-while-revalidate=300, so a reader's page 2 can reach the origin six minutes after page 1 was
 * ranked. A shorter TTL re-ranks between the two and the reader sees rows twice and never sees
 * others. 15 minutes — Vertex's paid-call cache had already settled on it, and one number serves both.
 */
export const RANKED_SET_TTL = 15 * 60_000

type CardRow = Prisma.ListingGetPayload<{ select: typeof LISTING_CARD_SELECT }>

export async function pageRankedThenTail(args: {
  rankedIds: readonly string[]
  /**
   * Re-applied to the page's ranked rows. The keyword path passes its `where`: its ranked list is
   * cached, so a listing hidden or sold since then must drop out rather than be served from memory.
   * The semantic path passes its STRUCTURAL filters — the feed's without the keyword text filter,
   * which would wrongly remove Vertex's matches — so its page read keeps the category and liveness
   * scope even where `teachers` lifts the default exclusion (gate 2026-10-14).
   */
  pageWhere?: Prisma.ListingWhereInput
  /** Everything the query matches; the tail is this minus the ranked ids. */
  tailWhere: Prisma.ListingWhereInput
  orderBy: Prisma.ListingOrderByWithRelationInput[]
  offset: number
  limit: number
  /**
   * The feed's teacher decision (buildFeedFilters' `teachersIn`), for both re-scopes below. True only on a teachers
   * search, whose filters already admit teacher rows; false re-adds the default exclusion as a backstop everywhere
   * else — the semantic path's page read has no `pageWhere` and leans on it.
   */
  teachers: boolean
}): Promise<CardRow[]> {
  const { rankedIds, pageWhere, tailWhere, orderBy, offset, limit, teachers } = args
  const plan = feedPagePlan(rankedIds.length, offset, limit)
  const pageIds = plan.fromHead ? rankedIds.slice(plan.fromHead.start, plan.fromHead.end) : []
  const idIn: Prisma.ListingWhereInput = { id: { in: [...pageIds] } }
  const pageRows = pageIds.length
    ? await db.listing.findMany({ where: await scopedListingWhere(pageWhere ? { AND: [pageWhere, idIn] } : idIn, { teachers }), select: LISTING_CARD_SELECT })
    : []
  // Restore the ranked order — `id IN (…)` returns rows in whatever order Postgres likes.
  const byId = new Map(pageRows.map((r) => [r.id, r] as const))
  const ranked = pageIds.map((id) => byId.get(id)).filter((r): r is CardRow => !!r)
  if (plan.tailTake <= 0) return ranked
  // Past the ranked set: the rest of the matches in the feed's own order, never a ranked row again.
  const tail = await db.listing.findMany({
    where: await scopedListingWhere({ AND: [tailWhere, { id: { notIn: [...rankedIds] } }] }, { teachers }),
    orderBy,
    skip: plan.tailSkip,
    take: plan.tailTake,
    select: LISTING_CARD_SELECT,
  })
  return [...ranked, ...tail]
}
