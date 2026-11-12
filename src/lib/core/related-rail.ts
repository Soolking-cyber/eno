import { db } from '@/lib/db'
import { logError } from '@/lib/log'
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
 * "Motorbike", "Gear" — that need their category beside them: "More in Rentals · Motorbike") — or, in a category on
 * WIDEN_TO_CATEGORY whose subcategory is too thin, the whole category, with the three sub* fields null ("More in Electronics").
 */
export type RelatedRail = {
  slug: string
  name: string
  nameVi: string
  subcategory: string | null
  subName: string | null
  subNameVi: string | null
  listings: SerializedListingCard[]
}

/**
 * ⛔ THE CATEGORIES WHOSE WHOLE AISLE IS "MORE OF THE SAME" — an explicit allow-list (UI climb 2026-11-12; plan review, codex +
 * opus: a test on the category's listing `types` measures intent, not topic, and a later taxonomy change would silently move
 * it). Measured live 2026-11-12: Electronics held 10 rows over 8 subcategories, none with more than 2, so "iphone", "samsung",
 * "airpods", "ps5" and "sony" never reached RELATED_MIN in their subcategory and ended on marketplace-wide Trending (a
 * keyboard, then rentals). The whole of Electronics is the next-best answer to any of them. Add a category here only after
 * measuring that its whole aisle reads as one kind; the mixed aisles of the 2026-11-09 note below never belong here.
 */
export const WIDEN_TO_CATEGORY: ReadonlySet<string> = new Set(['electronics'])

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
 * ⛔ SUBCATEGORY ONLY IN A MIXED AISLE (measured on the local build, 2026-11-09): such a category is too coarse — "vespa"
 * found one motorbike rental and "More in Rentals" was apartments; "dress" and "son môi" fell back to "More in Services"
 * and showed house moving. Under the subcategory's floor the explorer keeps Trending, which at least says what it is. The
 * one exception is a category on WIDEN_TO_CATEGORY (above, 2026-11-12), and never past a subcategory the reader asked for.
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
 * "Other" says nothing). Null without one or under RELATED_MIN, so the explorer keeps Trending — EXCEPT in a category on
 * WIDEN_TO_CATEGORY, where a subcategory that is missing, a catch-all or too thin gives way to the whole category, unless
 * the reader asked for that subcategory (a filter is never widened past).
 * ⚠️ THE AISLE IS READ ONLY WHEN THE SUBCATEGORY CANNOT ANSWER — one read after the other, never both on speculation
 * (commit review round 2, codex + opus). Reading both at once spent an aisle read that kept running after every
 * subcategory that had enough, and still left a stalled subcategory holding up a ready aisle; reading the aisle only for a
 * thin, missing or failed subcategory costs nothing when the subcategory answers, and the two small reads in series sit
 * well inside RELATED_DEADLINE_MS on the box, where the database is local. Everywhere else it is the one subcategory read
 * it always was, failing exactly as before. A failed subcategory read in a widening aisle is LOGGED, then falls back.
 * The category pick keeps Trending's order and seller spread (pickRailIds) untouched — nothing reorders after it.
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
  const widens = WIDEN_TO_CATEGORY.has(slug) && !subcategory
  if (!sub && !widens) return null
  const exclude = rows.map((r) => r.id)
  if (sub) {
    let subCards: SerializedListingCard[] = []
    try {
      subCards = await cardsFor({ AND: [base, { subcategorySlug: sub.slug }] }, exclude)
    } catch (e) {
      if (!widens) throw e // a mixed aisle fails exactly as it always did (the caller logs it)
      logError(e, { op: 'feed.related-rail.subcategory' }) // a widening aisle says so, then falls back to the aisle
    }
    if (subCards.length >= RELATED_MIN) {
      const { name, nameVi } = subCards[0].category
      return { slug, name, nameVi, subcategory: sub.slug, subName: sub.name, subNameVi: sub.nameVi, listings: subCards }
    }
  }
  if (!widens) return null
  const wholeCards = await cardsFor(base, exclude)
  if (wholeCards.length < RELATED_MIN) return null
  const { name, nameVi } = wholeCards[0].category
  return { slug, name, nameVi, subcategory: null, subName: null, subNameVi: null, listings: wholeCards }
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
