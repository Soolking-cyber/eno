import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { safeParse, serializeListing } from '@/lib/serialize'
import { diversifyRail } from '@/lib/feed-diversity'
import { Prisma } from '@/generated/prisma/client'

const LIMIT = 16
/**
 * The rail CHOOSES its LIMIT from this many (diversifyRail, feed-diversity.ts): a plain top-16 by
 * rankScore could be nine eSIM storefronts and one seller's variants. Seller round-robin with the
 * feed's shared seats (one for the eSIM carriers, one for the job boards, one for the vehicle
 * storefronts), one card per (seller, model), never the same cover twice, at most two per seat.
 * rankScore is untouched.
 * ⚠️ LIMIT STAYS 16, AND THE HOME PAGE'S FIRST FEED PAGE IS NOT IN IT (home-07). Trending used to open
 * on the feed's first card, two rows above it. With `excludeIds` those rows leave the POOL before the
 * rail chooses — not after: dropping them from a chosen 16 (or a chosen 24, the first plan) leaves the
 * rail short whenever the feed and the rail share their best rows, which on the home page they do.
 * The pool is 96, so 16 still remain after a 12-card page.
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
  { pool, take, excludeIds }: {
    pool: number
    take: number
    /**
     * Ids the caller already shows elsewhere on the page; they leave the pool before the rail chooses.
     * A promise is accepted so the narrow read below runs alongside whatever produces them (the home
     * page's feed window).
     */
    excludeIds?: readonly string[] | Promise<readonly string[]>
  },
) {
  // ⚠️ OBSERVED AT ONCE: if the narrow read throws before the await below, a rejected `excludeIds`
  // would otherwise be an unhandled rejection. The await still sees the original rejection.
  // ⚠️ NOT A SWALLOW, so the silent-catch rule's premise does not hold: this handler only marks the
  // promise observed; `await excludeIds` below re-throws the same error to the caller.
  // eslint-disable-next-line no-restricted-syntax
  if (excludeIds instanceof Promise) excludeIds.catch(() => {})
  const scoped = await scopedListingWhere(where)
  const narrow = await db.listing.findMany({ where: scoped, orderBy, take: pool, select: RAIL_PICK_SELECT })
  const exclude = new Set(excludeIds ? await excludeIds : [])
  const candidates = narrow.filter((r) => !exclude.has(r.id)).map((r) => ({ ...r, images: safeParse<string[]>(r.images, []) }))
  const picked = diversifyRail(candidates, { take })
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
export async function trendingRailListings({ excludeIds }: { excludeIds?: readonly string[] | Promise<readonly string[]> } = {}) {
  // Observed before the first await: the thin-catalogue return never awaits it. Not a swallow: every
  // other path re-throws it (diverseRailListings awaits it), and on the thin path the error is the
  // caller's own — the home page joins the feed window these ids come from in the same Promise.all.
  // eslint-disable-next-line no-restricted-syntax
  if (excludeIds instanceof Promise) excludeIds.catch(() => {})
  // ⚠️ SCOPED ONCE AND REUSED, so the pool count and the rows can never disagree. The `pool < 24`
  // thin-catalog guard below is computed from this same count — removing the desk's rows can push a
  // small live catalogue under the threshold and make the rail disappear from the home page. That is
  // correct behaviour, not a regression: check the live active count before assuming otherwise.
  const base: Prisma.ListingWhereInput = await scopedListingWhere({ verified: true, status: 'active' })
  const pool = await db.listing.count({ where: base })
  if (pool < 24) return []
  // ⚠️ /api/recommendations calls this with no ids and gets exactly the rail it always served.
  return diverseRailListings(base, TRENDING_ORDER, { pool: POOL, take: LIMIT, excludeIds })
}
