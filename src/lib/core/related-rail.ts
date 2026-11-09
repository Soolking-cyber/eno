import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { scopedListingWhere } from '@/lib/edition-scope'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { subcategoriesFor } from '@/lib/taxonomy'
import type { SerializedListingCard } from '@/lib/types'
import { pickRailIds, TRENDING_ORDER } from './trending-rail'

/**
 * A SEARCH THAT FOUND ONE TO SEVEN THINGS ENDS ON MORE OF ITS OWN KIND (UI climb 2026-11-09, phone UX hunt #9). Under a
 * sparse answer the explorer showed "Trending now" — marketplace-wide, so a search for "iphone" with two answers ended on
 * a keyboard and a hair tool. The answer now carries `related`: the rest of its category, chosen the way Trending is.
 *
 * ⛔ IT ARRIVES WITH THE ANSWER, NEVER AFTER IT. The first attempt fetched these cards on the client once the rail had
 * mounted and swapped them in; five review rounds kept finding races with the server seed (a stall left skeletons, a
 * direct visit swapped twice, a consent reload flashed). Built inside /api/listings' own body (feed-payload.ts), the
 * cards reach the explorer in the same response as the rows, and the explorer decides the rail once per answer
 * (use-recovery-rail.ts).
 * ⚠️ A PURE FUNCTION OF THE URL AND THE DATABASE: the response is edge-cached by URL ('public, s-maxage=60'), so nothing
 * here reads a cookie or the viewer. The viewer's blocked shops come in the URL (`xs`) and are honoured like the grid's.
 * ⚠️ "MORE OF THIS KIND", NOT "MORE OF THIS SEARCH": the answer's other filters (area, price, condition) are not carried. A
 * sparse answer is exactly where they bit; carrying them would mostly empty the rail too.
 * ⛔ LINKED LISTINGS INCLUDED (owner, 2026-11-09, asked "may More in… show partner-linked listings?": "yes"). The rail was
 * built in-app only, the home rails' rule (in-app-listing.ts), and that left the aisles that are mostly linked on Trending:
 * Electronics was 9 of 9 linked, Jobs 60 of the first 100, so "iphone" never got its rail. It sits under search results,
 * which show linked listings too (/legal/ranking #home names the surfaces that leave them out; this rail is not one).
 */

/** The explorer's recovery window: its rail follows an answer of 1-7 (listings-explorer.tsx, `totalCount < 8`). */
export const RELATED_MAX_TOTAL = 7
/** The rails' floor (shelf.tsx MIN_RAIL_ITEMS — a client module, so restated here): under it a rail is two cards and a void. */
export const RELATED_MIN = 3
/**
 * The most the rail may add to a sparse answer. Past it the answer goes without one (the explorer keeps Trending) — a
 * `.catch` covers a failure, not a slow read (commit review). The read it bounds keeps running; only the answer stops waiting.
 */
export const RELATED_DEADLINE_MS = 300

/** `p`, or `fallback` once `ms` have passed — whichever comes first. A rejection after the deadline is the caller's to observe. */
export function withinDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e: unknown) => { clearTimeout(timer); reject(e) })
  })
}

/** As many as Trending shows from its pool (16 of 96), at the same ratio. */
const POOL = 48
const TAKE = 12

/**
 * What the rail holds: one subcategory of one category, both named (the taxonomy's subcategory names are short labels —
 * "Motorbike", "Gear" — that need their category beside them: "More in Rentals · Motorbike").
 */
export type RelatedRail = {
  slug: string
  name: string
  nameVi: string
  subcategory: string
  subName: string
  subNameVi: string
  listings: SerializedListingCard[]
}

/** Answers 1-7, page 1 only, and only for words: a filter-only sparse page keeps Trending, as it is a browse, not a query. */
export function wantsRelatedRail({ offset, q, total }: { offset: number; q: string | null | undefined; total: number }): boolean {
  return offset === 0 && !!q?.trim() && total >= 1 && total <= RELATED_MAX_TOTAL
}

/**
 * The category the answer belongs to: the one the reader asked for, else the one most of its rows are in (the first seen
 * wins a tie, so the best-ranked row decides). ⛔ Never teachers, asked for or inferred: a rail of people is not "more of
 * the same", and the home rails never show teachers.
 */
export function relatedCategorySlug(
  rows: readonly { category?: { slug: string } | null }[],
  requested: string | null | undefined,
): string | null {
  const slug = requested && requested !== 'all' ? requested : modal(rows.map((r) => r.category?.slug))
  return slug && slug !== TEACHERS_CATEGORY_SLUG ? slug : null
}

/**
 * The subcategory the rail is about: the one the reader asked for, else the one most of the answer's rows IN THIS CATEGORY
 * share (first seen wins a tie).
 * ⛔ SUBCATEGORY ONLY, NEVER THE WHOLE CATEGORY (measured on the local build, 2026-11-09): a category is too coarse — "vespa"
 * found one motorbike rental and "More in Rentals" was apartments; "dress" and "son môi" fell back to "More in Services"
 * and showed house moving. Under the subcategory's floor the explorer keeps Trending, which at least says what it is.
 */
export function relatedSubcategorySlug(
  rows: readonly { category?: { slug: string } | null; subcategorySlug?: string | null }[],
  categorySlug: string,
  requested: string | null | undefined,
): string | null {
  if (requested) return requested
  return modal(rows.map((r) => (r.category?.slug === categorySlug ? r.subcategorySlug : null)))
}

/**
 * The most frequent value; on a tie, the one SEEN FIRST — the best-ranked row's (commit review: "first to reach the top count"
 * is not that — vehicles, electronics, electronics, vehicles is a 2-2 tie, and vehicles came first). A Map keeps first-seen
 * order, so the first strict maximum in it is the answer.
 */
function modal(values: readonly (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n }
  return best
}

/**
 * The rest of the answer's category: Trending's public base (verified, active, the edition scope that keeps eno's visa
 * desk and licence-held rows off eno.vn) WITHOUT the home rails' in-app rule (linked listings included, owner 2026-11-09:
 * header), the answer's rows and the viewer's blocked shops left out of the pool BEFORE choosing, then Trending's order and
 * seller diversity (pickRailIds). Card-shaped rows (LISTING_CARD_SELECT), like the answer's own: this rides on a search response.
 * Only the answer's subcategory (relatedSubcategorySlug), named by the taxonomy; never a "-other" catch-all (a rail of
 * "Other" says nothing). Null without one or under RELATED_MIN, so the explorer keeps Trending.
 */
export async function relatedRail({
  rows,
  category,
  subcategory,
  hiddenSellerIds,
}: {
  rows: readonly { id: string; category?: { slug: string } | null; subcategorySlug?: string | null }[]
  category: string | null | undefined
  subcategory?: string | null
  hiddenSellerIds: readonly string[]
}): Promise<RelatedRail | null> {
  const slug = relatedCategorySlug(rows, category)
  if (!slug) return null
  // The blocked shops are their OWN AND element, as in the feed (feed-query.ts) — never a key beside the caller's own.
  const scoped = await scopedListingWhere({ verified: true, status: 'active', category: { slug } })
  const base = hiddenSellerIds.length ? { AND: [scoped, { sellerId: { notIn: [...hiddenSellerIds] } }] } : scoped
  const subSlug = relatedSubcategorySlug(rows, slug, subcategory)
  const sub = subSlug && !subSlug.endsWith('-other') ? subcategoriesFor(slug).find((s) => s.slug === subSlug) ?? null : null
  if (!sub) return null
  const listings = await cardsFor({ AND: [base, { subcategorySlug: sub.slug }] }, rows.map((r) => r.id))
  if (listings.length < RELATED_MIN) return null
  const { name, nameVi } = listings[0].category
  return { slug, name, nameVi, subcategory: sub.slug, subName: sub.name, subNameVi: sub.nameVi, listings }
}

/** Trending's choice (pickRailIds) over `scoped`, loaded card-shaped in the picker's order. */
async function cardsFor(scoped: Prisma.ListingWhereInput, excludeIds: readonly string[]): Promise<SerializedListingCard[]> {
  const ids = await pickRailIds(scoped, TRENDING_ORDER, { pool: POOL, take: TAKE, excludeIds })
  if (ids.length < RELATED_MIN) return []
  const found = await db.listing.findMany({ where: { AND: [scoped, { id: { in: ids } }] }, select: LISTING_CARD_SELECT })
  const byId = new Map(found.map((r) => [r.id, r] as const))
  return ids.flatMap((id) => {
    const r = byId.get(id)
    return r ? [serializeListingCard(r)] : []
  })
}
