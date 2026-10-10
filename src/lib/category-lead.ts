/**
 * THE ORDER EVERY LIST OF CATEGORIES LEADS WITH — the home rail, the footer, the category pages' "Other
 * categories", the search panel's shortcuts and the "Browse by category" shelves all read it.
 *
 * ⛔ AN OWNER DECISION, NOT A MEASUREMENT. 2026-09-21: "1 rentals 2 jobs 3 services 4 electronics", then
 * "swap electronics to moving sales". 2026-10-10: "put find a teacher to number 4 everywhere so rentals jobs
 * services and then electronics". So: rentals, jobs, services, teachers (its tile and links read "Find a
 * teacher" — category-entry-label.ts), electronics.
 * ⚠️ `moving-sale` STAYS PINNED, SIXTH. It was the 09-21 fourth and the 10-10 instruction names five without
 * revoking it, so it keeps its place ahead of everything ranked. It has no live listings, and every surface
 * drops an empty category (offeredCategories, the shelves' floor, UNLINKED_CATEGORIES), so today nobody sees
 * it anywhere — the pin only matters once moving sales are posted.
 *
 * ⚠️ "EVERYWHERE" WAS NOT TRUE BEFORE THIS FILE, and that is why it exists. The 09-21 pin lived inside the
 * home rail's sort (src/lib/categories.ts), so every other list kept its own order: the footer TAXONOMY's,
 * the /c chips the alphabet's, the shelves pure demand. One list here, read by each of them, is what keeps a
 * future reorder from landing on one surface and not the others.
 *
 * ⛔ TAXONOMY (taxonomy.ts) IS DELIBERATELY NOT REORDERED. Its order is also the order of the categories in
 * the AI photo-classifier and visual-search prompts, where `vehicles` sits ahead of `rentals` (whose
 * subcategories include motorbike and car hire) — moving rentals first there risks filing a scooter photo as
 * a rental. Lists sort by this file instead; TAXONOMY and NAV_CATEGORIES keep their order.
 *
 * Import-free and tiny on purpose, like category-entry-label.ts: the footer (a client component rendered by
 * ~30 routes) imports it, and must not pull taxonomy.ts in (taxonomy-nav.ts says why).
 */
export const CATEGORY_LEAD = ['rentals', 'jobs', 'services', 'teachers', 'electronics', 'moving-sale'] as const

/** Where `slug` sits in the lead: its index, or `CATEGORY_LEAD.length` (after every lead slug) when it has none. */
export function categoryLeadRank(slug: string): number {
  const i = (CATEGORY_LEAD as readonly string[]).indexOf(slug)
  return i === -1 ? CATEGORY_LEAD.length : i
}

/**
 * `cats` with the lead slugs first, in the lead's order, and everything else after them in the order it came
 * in — so each surface keeps its own ranking (demand, the alphabet, TAXONOMY) for the rest. A new array; the
 * input is not touched. A lead slug the list does not contain simply does not appear: nothing is invented.
 */
export function leadFirst<T extends { slug: string }>(cats: readonly T[]): T[] {
  // Index as the tie-break, not a reliance on the engine's sort stability: the rest must keep their order.
  return cats
    .map((cat, at) => ({ cat, at, rank: categoryLeadRank(cat.slug) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ cat }) => cat)
}
