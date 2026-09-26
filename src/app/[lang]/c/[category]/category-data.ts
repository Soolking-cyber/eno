import { cache } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { provinceWhere } from '@/lib/province-match'
import { mergeDistrictGroups, type DistrictChip } from '@/lib/district-canonical'
import { DISTRICTS_PROVINCE_CODE } from '@/components/marketplace/listings-explorer.constants'
import vnUnits from '@/data/vn-units.json'
import { linkedTier, rentalKinds, type RentalsFacts } from './category-copy'

/**
 * The category page's live numbers beyond the headline count — shared by `generateMetadata` and the
 * page body through `cache()`, so each is one query per render however many places print it.
 *
 * ⚠️ EVERY READ IS `scopedListingWhere` OVER THE SAME PREDICATE AS load-category.ts (verified,
 * active, this category). A narrower or wider base here would let the page print a breakdown that
 * does not add up to the total above it.
 */
const live = (categoryId: string) => ({ categoryId, verified: true, status: 'active' as const })

/**
 * One chip per canonical place in this category, busiest first (district-canonical.ts).
 *
 * ⛔ IT WAS `findMany({ distinct: ['district'], take: 80 })`, which linked each STORED spelling:
 * /c/rentals carried both `huyen-cu-chi` and `quan-cu-chi`, and every numbered district as `quan-N`
 * beside the curated `dN` the explorer uses — two indexable URLs per place. A GROUP BY with counts
 * also orders the chips by stock instead of by whatever `distinct` returned first.
 */
export const loadDistrictChips = cache(async (categoryId: string): Promise<DistrictChip[]> => {
  const groups = await db.listing.groupBy({
    by: ['district'],
    where: await scopedListingWhere({ ...live(categoryId), district: { not: null } }),
    _count: { _all: true },
  })
  return mergeDistrictGroups(groups.map((g) => ({ district: g.district, count: g._count._all })))
})

/**
 * HCMC's `?province=` name ('Ho Chi Minh'), read from vn-units by the code DISTRICTS is keyed to —
 * never typed, so it is the exact string /api/listings' province filter and facet use.
 */
const HCMC_PROVINCE = (vnUnits as { code: string; nameEn: string }[]).find((u) => u.code === DISTRICTS_PROVINCE_CODE)?.nameEn ?? 'Ho Chi Minh'

/**
 * What /c/rentals may say about its stock (category-copy.ts decides the words).
 *
 * ⚠️ "ALL IN HCMC" IS A COMPARISON OF TWO COUNTS, NOT `NOT province`. A row with no city and no
 * location is neither inside nor outside a LIKE — SQL's NOT over NULL is NULL — so counting the
 * outside would silently pass unplaced rows as HCMC. Counting the inside and comparing it with the
 * total fails the other way: an unplaced row withdraws the claim, which is the safe direction.
 *
 * ⚠️ NOT CAUGHT, ON PURPOSE — the same as every other read on this page. An ISR regeneration that
 * throws keeps serving the last good render; one that swallowed the error would cache a page with
 * its claims silently stripped for the whole revalidate window.
 *
 * ⚠️ KEYED ON PRIMITIVES (`cache()` compares arguments by identity), so generateMetadata and the
 * page body share one set of queries; the chips come from their own cached loader.
 */
/**
 * How many of the category's live listings link out to the portal or shop they came from
 * (`affiliateUrl` set — the card's `isPartnerBooking` test). Rentals reads it through
 * loadRentalsFacts; every other category reads it to decide whether its lede and meta description
 * may keep the "every seller has a public trust score" sentence (category-copy.ts).
 */
export const loadLinkedCount = cache(async (categoryId: string): Promise<number> =>
  db.listing.count({ where: await scopedListingWhere({ ...live(categoryId), affiliateUrl: { not: null } }) }),
)

export const loadRentalsFacts = cache(async (categoryId: string, total: number): Promise<RentalsFacts> => {
  const [chips, inHcmc, linked, kinds] = await Promise.all([
    loadDistrictChips(categoryId),
    db.listing.count({ where: await scopedListingWhere({ AND: [live(categoryId), provinceWhere(HCMC_PROVINCE)] }) }),
    loadLinkedCount(categoryId),
    db.listing.groupBy({ by: ['subcategorySlug'], where: await scopedListingWhere(live(categoryId)), _count: { _all: true } }),
  ])
  return {
    total,
    allHcmc: total > 0 && inHcmc >= total,
    linked: linkedTier(linked, total),
    kinds: rentalKinds(Object.fromEntries(kinds.map((k) => [k.subcategorySlug ?? '', k._count._all]))),
    top: chips.slice(0, 5),
  }
})
