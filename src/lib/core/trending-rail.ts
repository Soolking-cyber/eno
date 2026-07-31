import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'

const LIMIT = 16
const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }

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
  const rows = await db.listing.findMany({
    where: base,
    orderBy: [RANK, { views: 'desc' }, { id: 'desc' }],
    take: LIMIT,
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })
  return rows.map(serializeListing)
}
