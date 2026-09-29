import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { safeParse, serializeListing } from '@/lib/serialize'
import { diversifyRail } from '@/lib/feed-diversity'
import { Prisma } from '@/generated/prisma/client'

const LIMIT = 16
/**
 * The rail CHOOSES its LIMIT from this many (diversifyRail, feed-diversity.ts): a plain top-16 by
 * rankScore could be nine eSIM storefronts and one seller's variants. Seller round-robin with the
 * feed's shared seats (one for the eSIM carriers, one for the job boards), one card per (seller,
 * model), never the same cover twice, at most two per seat. rankScore is untouched.
 * ⚠️ LIMIT STAYS 16. The home page could also drop the cards its own first feed page already shows
 * (Trending[0] opening on the feed's first card) — that needs (home)/page.tsx, which this change does
 * not touch; raise LIMIT to leave it headroom when it does.
 */
const POOL = 96
const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }
const TRENDING_ORDER: Prisma.ListingOrderByWithRelationInput[] = [RANK, { views: 'desc' }, { id: 'desc' }]

/** Only what choosing needs — the seat, the cover hash (in the image URL) and the model. */
const RAIL_PICK_SELECT = { id: true, sellerId: true, subcategorySlug: true, images: true, brandSlug: true, model: true } as const

/**
 * A rail's rows: the top `pool` by `orderBy` (narrow rows), `take` of them chosen by diversifyRail,
 * and only those fetched whole and serialized, in the chosen order. ⚠️ TWO READS, NOT ONE WIDE ONE:
 * a full row carries the description and the searchText blob, and /api/recommendations serves this
 * uncached at the edge (`private`), so choosing 16 out of 96 must not mean reading 96 whole rows.
 * ⚠️ SCOPED HERE even though both callers pass a scoped `where`: a rail is exactly the read the
 * edition boundary exists for, and applying the scope twice is a no-op (edition-scope.ts).
 */
export async function diverseRailListings(
  where: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  { pool, take }: { pool: number; take: number },
) {
  const scoped = await scopedListingWhere(where)
  const narrow = await db.listing.findMany({ where: scoped, orderBy, take: pool, select: RAIL_PICK_SELECT })
  const picked = diversifyRail(narrow.map((r) => ({ ...r, images: safeParse<string[]>(r.images, []) })), { take })
  if (!picked.length) return []
  const rows = await db.listing.findMany({
    where: { AND: [scoped, { id: { in: picked.map((r) => r.id) } }] },
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })
  const byId = new Map(rows.map((r) => [r.id, r] as const))
  return picked.flatMap((p) => {
    const r = byId.get(p.id)
    return r ? [serializeListing(r)] : []
  })
}

/** The non-personalized "Trending now" rail — the exact fallback GET
 *  /api/recommendations serves with no signals, extracted so the HOME PAGE can seed
 *  the ForYouRail server-side (perf Phase 1). Server-known availability means the
 *  rail's geometry is final at first paint: the SSR'd skeletons collapsing on the
 *  thin-catalog empty answer was the homepage's dominant CLS. Keeps the thin-catalog
 *  guard: under ~2 feed pages the rail would mirror the grid card-for-card, so it
 *  hides (returns []) until supply grows. Public-safe (verified + active only). */
export async function trendingRailListings() {
  // ⚠️ SCOPED ONCE AND REUSED, so the pool count and the rows can never disagree. The `pool < 24`
  // thin-catalog guard below is computed from this same count — removing the desk's rows can push a
  // small live catalogue under the threshold and make the rail disappear from the home page. That is
  // correct behaviour, not a regression: check the live active count before assuming otherwise.
  const base: Prisma.ListingWhereInput = await scopedListingWhere({ verified: true, status: 'active' })
  const pool = await db.listing.count({ where: base })
  if (pool < 24) return []
  return diverseRailListings(base, TRENDING_ORDER, { pool: POOL, take: LIMIT })
}
