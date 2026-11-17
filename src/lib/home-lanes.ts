/**
 * THE HOME PAGE'S RAILS AS BOTH SIDES READ THEM — no 'use client', no 'server-only': (home)/page.tsx and the explorer run the
 * SAME rules, so the cards the server sends whole are exactly the cards its first paint draws (slimHomeRails below).
 */
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'

/** Sparse-catalogue floor for a curated rail (wow pass, 2026-08-06). Below three items a
 *  horizontal rail is two cards and a void — it manufactures the look of a dead shop.
 *  Rails hide themselves under this floor; the feed grid below still shows every listing,
 *  so nothing becomes unreachable. One constant so every rail agrees on "sensible minimum". */
export const MIN_RAIL_ITEMS = 3

/**
 * The category lanes that go LAST among the home page's phone lanes, after Partners and Outstanding businesses (owner-approved
 * 2026-11-15 (build 8), cook r08 home: "the flyer-heavy lanes ... move below the product lanes"): Services, a lane of sellers'
 * flyers. A taxonomy slug, so the order holds in every language and survives a renamed heading.
 */
export const LATE_LANE_SLUGS: readonly string[] = ['services']

/**
 * A rail card as the home page sends it: whole, or CUT TO ITS ID (slimHomeRails) when the first paint does not draw it. A
 * rail draws its cards only once every one is whole (`allCards`); until then it shows its same-size placeholders.
 */
export type HomeCard = SerializedListingCard | { id: string }
export const isCard = (c: HomeCard): c is SerializedListingCard => 'title' in c
export const allCards = (cs: readonly HomeCard[]): cs is SerializedListingCard[] => cs.every(isCard)

/**
 * `cards` with their title translations widened from an answer's (by id): ONLY `titleI18n` changes — no card comes, goes or
 * moves. For a card fetched by id after the reader switched language: the late ask carried only the asker's language, where
 * the page's own copy carried every one (category-rails.tsx useFreshCategoryLanes, business-rail.tsx).
 */
export function withTitles<T extends HomeCard>(cards: readonly T[], answer: readonly { id: string; titleI18n?: Record<string, string> }[]): T[] {
  const more = new Map<string, Record<string, string>>()
  for (const a of answer) if (a.titleI18n) more.set(a.id, { ...more.get(a.id), ...a.titleI18n }) // several answers: every language
  return cards.map((c) => {
    const t = more.get(c.id)
    return t && isCard(c) ? { ...c, titleI18n: { ...c.titleI18n, ...t } } : c
  })
}

/** One category's rail as the home page hands it to the explorer (src/lib/core/category-rails.ts `CategoryRailRow`, slimmed). */
export type CategoryRailData = { slug: string; listings: HomeCard[] }
/** A rail that will draw: its category, and the cards left after the dedup. `lost`: its ids could not be fetched (category-rails.tsx). */
export type CategoryLaneData = { cat: SerializedCategory; items: HomeCard[]; slug: string; lost?: boolean }

/**
 * Which rails draw, decided ONCE from props (so the server render and hydration agree on every lane and its place):
 * drop the cards the rails ABOVE already showed (`excludeIds`: Trending / Outstanding businesses — on a 13-listing catalogue
 * the same card in three adjacent rails reads as padding, not supply), then hide a rail under the shared sparse floor
 * (MIN_RAIL_ITEMS — a category heading over one or two cards is manufactured density, and every listing still appears in
 * the feed grid). A slug this edition does not list draws nothing.
 */
export function visibleCategoryRails(
  rails: readonly CategoryRailData[],
  categories: readonly SerializedCategory[],
  excludeIds?: readonly string[],
): CategoryLaneData[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c]))
  const exclude = new Set(excludeIds ?? [])
  const out: CategoryLaneData[] = []
  for (const rail of rails) {
    const cat = bySlug.get(rail.slug)
    if (!cat) continue
    const items = rail.listings.filter((l) => !exclude.has(l.id))
    if (items.length < MIN_RAIL_ITEMS) continue
    out.push({ cat, items, slug: rail.slug })
  }
  return out
}

/**
 * Sparse-catalogue rail dedup (wow pass, 2026-08-06): with ~13 live listings the three landing rails were showing the SAME
 * cards over and over — density that reads as a dead shop. The Trending seed keeps first claim (it leads), Outstanding
 * businesses is deduped against it, and the per-category rails exclude both. Server seeds only — a client-side
 * personalization upgrade may reintroduce an overlap, which is acceptable: best-effort de-repetition, not a uniqueness
 * invariant. ⛔ ONLY A RAIL THAT RENDERS (over MIN_RAIL_ITEMS) MAY CLAIM ITS CARDS: one hidden by the floor never showed them,
 * and claiming them would starve the rails below of cards nobody saw (external diff-review catch, 2026-08-06).
 * ⛔ ON THE FULL CHOSEN LISTS, ids and whole cards alike: a card cut to its id (slimHomeRails) still claims its place.
 */
export function homeRailClaims<B extends { id: string }>(trending: readonly { id: string }[] | undefined, businesses: B[] | undefined) {
  const trendingShown = trending && trending.length >= MIN_RAIL_ITEMS ? trending : []
  const deduped = businesses?.filter((b) => !trendingShown.some((t) => t.id === b.id))
  const businessesShown = deduped && deduped.length >= MIN_RAIL_ITEMS ? deduped : []
  return { businesses: deduped, excludeIds: [...trendingShown, ...businessesShown].map((l) => l.id) }
}

/**
 * ⛔ THE HOME PAGE SENDS WHOLE ONLY THE RAIL CARDS ITS FIRST PAINT DRAWS (owner, 2026-11-17: "do full version now" — measured on
 * eno.vn that day, 71 listings rode the explorer's props and 36 were drawn; the category rails alone were 120 KB of the
 * 295 KB RSC payload). Every other card goes as its id, in its place, and is drawn later by the rail it belongs to:
 *   · Outstanding businesses — never drawn at first paint (the phone's lane waits behind its gate, the desktop's shelf behind
 *     DeferredShelf): every card an id; the rail asks /api/home/cards for them when it opens (business-rail.tsx).
 *   · the category rails — whole only for the FIRST PRODUCT LANE's cards (the lane drawn in the server HTML, `initialShow`),
 *     as the explorer will draw it: the same dedup, the same floor, the same order, from this same module. The rest fill
 *     from the lanes' one freshness check (category-rails.tsx useFreshCategoryLanes), asked when such a lane opens.
 * Trending, Find a teacher and the feed are drawn whole at first paint and pass through untouched. The server's CHOICE is
 * unchanged: every id stays, so the dedup, the floors and every lane's place are what they were.
 * ⚠️ A CRAWLER THAT RUNS JAVASCRIPT GETS THE CARDS SENT AS IDS ONLY THROUGH THOSE TWO ASKS: robots.txt disallows /api but ALLOWS
 * /api/category-rails and /api/home/cards for exactly this (src/app/robots.txt/route.ts) — keep them allowed, or a renderer
 * such as Googlebot's sees placeholders where it used to see the listings. The raw HTML never carried them (they were behind
 * gates), and the ItemList JSON-LD lists only drawn cards either way.
 */
export function slimHomeRails<B extends { id: string }>({ categories, trending, businesses, rails }: {
  categories: readonly SerializedCategory[]
  trending: readonly { id: string }[]
  businesses: readonly B[]
  rails: readonly { slug: string; listings: readonly SerializedListingCard[] }[]
}): { businesses: HomeCard[]; rails: CategoryRailData[] } {
  const { excludeIds } = homeRailClaims(trending, [...businesses])
  const first = visibleCategoryRails(rails as CategoryRailData[], categories, excludeIds).find((l) => !LATE_LANE_SLUGS.includes(l.slug))
  const drawn = new Set(first?.items.map((l) => l.id))
  return {
    businesses: businesses.map((b) => ({ id: b.id })),
    rails: rails.map((r) => ({ slug: r.slug, listings: r.listings.map((l) => (r.slug === first?.slug && drawn.has(l.id) ? l : { id: l.id })) })),
  }
}
