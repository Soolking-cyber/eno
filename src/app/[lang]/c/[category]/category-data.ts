import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { subcategoriesFor } from '@/lib/taxonomy'
import { topSubcategories, type TopSubcategory } from './category-copy'
import { scopedListingWhere } from '@/lib/edition-scope'
// `{ teachers: true }` on every read here: each one is pinned to ONE categoryId, so the default
// teacher exclusion (scopedListingWhere) can only ever empty /c/teachers — it hides nothing elsewhere.
import { provinceWhere } from '@/lib/province-match'
import { mergeDistrictGroups, type DistrictChip } from '@/lib/district-canonical'
import { DISTRICTS_PROVINCE_CODE } from '@/components/marketplace/listings-explorer.constants'
import vnUnits from '@/data/vn-units.json'
import { homeFacts, linkedTier, rentalKinds, rentalsHeadline, type RentalsFacts, type RentalsHeadline } from './category-copy'
import { RENTAL_PLACES } from '@/lib/rental-places'
import { isIndexableCount } from '@/lib/index-floor'
import { jobCityChips, type JobCity } from './job-cities'

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
 *
 * ⛔ ONLY PLACES AT THE INDEXING FLOOR (SEO wave B, I1; src/lib/index-floor.ts). A district page under
 * 10 listings can answer `noindex, follow` (I1b), and a chip is a followed link: /c/rentals linked
 * `/c/rentals/can-gio` (one rental) from its "By area" row. Both readers — the category page's chips
 * and /c/rentals' busiest districts (`loadRentalsFacts().top`) — get the floor here, once. The count
 * is merged across spellings first (6 + 4 is a page of 10), and it is the stored-name tally, which
 * the linked page's scope contains (see the sibling chips in `[district]/page.tsx` for the one gap).
 */
export const loadDistrictChips = cache(async (categoryId: string, placesOnly = false): Promise<DistrictChip[]> => {
  const groups = await db.listing.groupBy({
    by: ['district'],
    // `placesOnly` for rentals: the chips lead to /c/rentals/<district>, which counts places (rental-places.ts).
    where: await scopedListingWhere({ AND: [{ ...live(categoryId), district: { not: null } }, placesOnly ? RENTAL_PLACES : {}] }, { teachers: true }),
    _count: { _all: true },
  })
  return mergeDistrictGroups(groups.map((g) => ({ district: g.district, count: g._count._all }))).filter((c) => isIndexableCount(c.count))
})

/**
 * /c/jobs "By city" (rentals-11): live jobs per `city`, merged into one chip per province (job-cities.ts
 * owns the merge, the order and the cap). Jobs carry no district, so this is their "By area".
 */
export const loadJobCities = cache(async (categoryId: string): Promise<JobCity[]> => {
  const groups = await db.listing.groupBy({
    by: ['city'],
    where: await scopedListingWhere(live(categoryId), { teachers: true }),
    _count: { _all: true },
  })
  return jobCityChips(groups.map((g) => ({ city: g.city, count: g._count._all })))
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
 * close on the report sentence or say where the listings open (category-copy.ts linkedTier).
 */
export const loadLinkedCount = cache(async (categoryId: string): Promise<number> =>
  db.listing.count({ where: await scopedListingWhere({ ...live(categoryId), affiliateUrl: { not: null } }, { teachers: true }) }),
)

/**
 * ⛔ EVERY RENTALS FACT HERE IS TAKEN OVER PLACES, NOT VEHICLE HIRE (src/lib/rental-places.ts): the
 * lede counts "places for rent" and says how many are "linked from partner property portals", and a
 * car-hire site is neither. Vehicle hire is named in its own sentence (`vehicles`). The chips (`top`)
 * are places-only too. Null when no place is live: the page then keeps the generic category copy
 * rather than printing "0 places for rent".
 * @param _total the page's headline count, which includes vehicle hire. Kept in the signature so the
 *   call sites keep sharing one `cache()` entry; the lede's own total is the places count below.
 */
export const loadRentalsFacts = cache(async (categoryId: string, _total: number): Promise<RentalsFacts | null> => {
  const [chips, total, inHcmc, linked, kinds] = await Promise.all([
    loadDistrictChips(categoryId, true),
    db.listing.count({ where: await scopedListingWhere({ AND: [live(categoryId), RENTAL_PLACES] }, { teachers: true }) }),
    db.listing.count({ where: await scopedListingWhere({ AND: [live(categoryId), RENTAL_PLACES, provinceWhere(HCMC_PROVINCE)] }, { teachers: true }) }),
    // By subcategory, so the homes' own linked tier comes from the same read (D1b, review): the homes
    // description and lede must not borrow a tier the offices set.
    db.listing.groupBy({ by: ['subcategorySlug'], where: await scopedListingWhere({ AND: [live(categoryId), RENTAL_PLACES, { affiliateUrl: { not: null } }] }, { teachers: true }), _count: { _all: true } }),
    db.listing.groupBy({ by: ['subcategorySlug'], where: await scopedListingWhere(live(categoryId), { teachers: true }), _count: { _all: true } }),
  ])
  if (total === 0) return null
  const bySub = Object.fromEntries(kinds.map((k) => [k.subcategorySlug ?? '', k._count._all]))
  const homes = homeFacts(bySub)
  const linkedBySub = Object.fromEntries(linked.map((k) => [k.subcategorySlug ?? '', k._count._all]))
  const linkedAll = linked.reduce((n, k) => n + k._count._all, 0)
  return {
    total,
    allHcmc: inHcmc >= total,
    linked: linkedTier(linkedAll, total),
    homesLinked: linkedTier(homeFacts(linkedBySub).total, homes.total),
    kinds: rentalKinds(bySub),
    top: chips.slice(0, 5),
    vehicles: { cars: bySub['car-rental'] ?? 0, motorbikes: bySub['motorbike-rental'] ?? 0 },
    // SEO wave B, D1b: the homes the description, the lede and the preview all count. From the same
    // group-by as `kinds` (over the whole category; the three home kinds are places either way).
    homes,
  }
})

/**
 * How long the /c/rentals headline variant is cached, in seconds.
 *
 * ⛔ NOT BELOW THE PAGE'S OWN `revalidate` (21,600 in `(index)/page.tsx`), AND THE PLAN'S HOUR WAS.
 * An `unstable_cache` read during an ISR render lowers that render's revalidate to its own when its
 * own is lower (`workUnitStore.revalidate = revalidate` in
 * next/dist/server/web/spec-extension/unstable-cache.js, for the 'prerender-legacy' store every ISR
 * render here uses, app-render.js), so an hourly entry would have made /c/rentals regenerate, and
 * advertise `s-maxage`, hourly instead of every six hours. At this value the H1b build still sends
 * `s-maxage=21600` on /c/rentals (measured). An ISR regeneration that meets a STALE entry waits for a
 * fresh one (`isStaticGeneration`, the same file); one that meets a fresh entry keeps it (the lag,
 * below).
 * A contract test (crawler-visible-html-contract.test.ts) keeps this at or above the page's value.
 */
export const RENTALS_HEADLINE_TTL = 21600

/**
 * Which headline /c/rentals prints (`rentalsHeadline`), or null while the category holds no live
 * rental — then the page keeps the generic "<name> in Vietnam" H1 and title.
 *
 * ⛔ CACHED ACROSS RENDERS BECAUSE `(index)/layout.tsx` AWAITS IT ABOVE THE LOADING BOUNDARY. The
 * variant depends on the stock mix — every rental in HCMC? any apartments? any houses? — which
 * `loadRentalsFacts` answers with three queries over the whole category; a layout that awaited those
 * would hold the Header, the H1 and the skeleton on them (round-2 plan review, A4). The title
 * (`rentalsMetadata`) takes the SAME value as a parameter, so the H1 and the `<title>` can never name
 * different variants; the description and the lede keep their per-request counts.
 * ⚠️ THE PRICE IS A LAG, AND IT IS UP TO TWO PERIODS, NOT ONE. A page regenerated just before this
 * entry expires keeps the entry's variant for its own six hours, so the H1 and title can trail the
 * stock mix by up to ~12 hours (null included: a category that refills keeps "Rentals in Vietnam" that
 * long), while the lede and the description already say what the counts say. Accepted: the variant
 * changes only when the mix crosses one of three lines (all in HCMC; any apartments; any houses), and
 * the page's own revalidate cannot be shortened by this entry (RENTALS_HEADLINE_TTL, above). Of the
 * three, only "all in HCMC" is near: 14,043 apartments and 5,331 houses (2026-09-28) will not run out,
 * but ONE live rental placed outside HCMC, or with no place, flips it, and then the H1 and title say
 * "Ho Chi Minh City" for up to that long.
 * Nothing purges /c/* on demand today, so nothing else refreshes the entry.
 *
 * ⚠️ THE TOTAL IS THE SUM OF THE GROUP BY — every live row falls in exactly one `subcategorySlug`
 * group, the null one included — over the same predicate as `loadCategory`'s COUNT, so it is that
 * count without a third query. "All in HCMC" is the same two-count comparison as `loadRentalsFacts`.
 *
 * ⚠️ `toString` IS PINNED, as in hcmc-rent-index/load-rent-index.ts: `unstable_cache` keys an entry on
 * `cb.toString()` plus the key parts, and the minifier spells this function differently in each bundle
 * that compiles it. The key parts carry the name; the build id (cache-handler.cjs) keeps a new deploy
 * from reading an old build's entry, so the cache is cold after each deploy and H4 warms /c/rentals.
 * A failed read throws and is never cached: the ISR regeneration fails and the last good page stays.
 */
const computeRentalsHeadline = async (categoryId: string): Promise<RentalsHeadline | null> => {
  // ⛔ PLACES ONLY, like loadRentalsFacts: the H1 and title must name the same set the lede counts.
  // With no place live this is null and the page keeps the generic H1, as loadRentalsFacts does.
  const [inHcmc, kinds] = await Promise.all([
    db.listing.count({ where: await scopedListingWhere({ AND: [live(categoryId), RENTAL_PLACES, provinceWhere(HCMC_PROVINCE)] }, { teachers: true }) }),
    db.listing.groupBy({ by: ['subcategorySlug'], where: await scopedListingWhere({ AND: [live(categoryId), RENTAL_PLACES] }, { teachers: true }), _count: { _all: true } }),
  ])
  const total = kinds.reduce((n, k) => n + k._count._all, 0)
  if (total === 0) return null
  return rentalsHeadline({
    allHcmc: inHcmc >= total,
    kinds: rentalKinds(Object.fromEntries(kinds.map((k) => [k.subcategorySlug ?? '', k._count._all]))),
  })
}
computeRentalsHeadline.toString = () => 'rentals-headline-variant'

/** `cache()` on top, so the layout and generateMetadata share one read inside a render even on a miss. */
export const loadRentalsHeadline = cache(
  unstable_cache(computeRentalsHeadline, ['rentals-headline'], { revalidate: RENTALS_HEADLINE_TTL }),
)

/**
 * The category's biggest subcategories, busiest first, for the lede's opening sentence (C1-LEDE):
 * "63,730 listings in Electronics, including Phones (41,002), Laptops (9,114) and Audio (3,508)."
 *
 * ⚠️ THE SAME PREDICATE AS EVERY COUNT ON THIS PAGE (`live`, scoped), so the parts never add up to
 * more than the total printed beside them. Which groups may be NAMED — taxonomy-known, not the whole
 * category, not a catch-all "Other" — is `topSubcategories` (category-copy.ts), pure and tested.
 * `[]` without a query for /c/rentals (RentalsLede counts its own kinds) and /c/jobs (its lede is
 * the safety sentence), and for an empty category. Not caught, like every read here.
 */
export const loadTopSubcategories = cache(
  async (categoryId: string, slug: string, total: number): Promise<TopSubcategory[]> => {
    if (total <= 0 || slug === 'rentals' || slug === 'jobs') return []
    const groups = await db.listing.groupBy({
      by: ['subcategorySlug'],
      where: await scopedListingWhere({ ...live(categoryId), subcategorySlug: { not: null } }, { teachers: true }),
      _count: { _all: true },
    })
    return topSubcategories(groups.map((g) => ({ slug: g.subcategorySlug, count: g._count._all })), subcategoriesFor(slug), total)
  },
)
