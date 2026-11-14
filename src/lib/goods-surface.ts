/**
 * ⛔ THE GOODS SURFACE (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options and deploy";
 * target stills cook/compare/r06/goods__search.jpg and goods__electronics.jpg). On a phone a search with no category, and
 * every category that sells THINGS, reads as one dense grid led by the price: the goods card (listing-card.tsx `look`),
 * rows 32px apart, the search's one title line and one control row (listings-explorer.tsx `oneRow`), the category page's
 * wrapping display H1 with the lede after the grid ((index)/layout.tsx, lede-placement.ts).
 *
 * The judged stills were /?q=iphone and /c/electronics; the template is extended to every goods category — everything but
 * the four surfaces that have their own redesign (rentals: a list of homes; jobs and teachers: rows and people; services:
 * providers). The list lives here — and, for a cold link's first frame (before any script), in one globals.css rule that the
 * test holds equal to it.
 *
 * ⚠️ IMPORTS NOTHING, ON PURPOSE: lede-placement.ts (read by a server layout before any data) and a Playwright spec import
 * it, and neither may pull the database client or React in with it (goods-surface.test.ts holds the module import-free).
 */

/**
 * The categories with a redesign of their own: never the goods look. ⚠️ globals.css names the same four in its goods cold-link
 * rule (a cold link's first frame, before any script — the one place this list cannot be imported); goods-surface.test.ts
 * holds the two equal.
 */
export const NOT_GOODS_CATEGORIES: readonly string[] = ['rentals', 'jobs', 'teachers', 'services']
const NOT_GOODS = NOT_GOODS_CATEGORIES

/** Is this category slug one that sells things (Electronics, Fashion, Vehicles, …)? `undefined`/'' is not. */
export function isGoodsCategory(slug: string | null | undefined): boolean {
  return !!slug && slug !== 'all' && !NOT_GOODS.includes(slug)
}

/**
 * Does a results surface scoped to `category` take the goods look? A search over every category ('all') does — its cards
 * still each decide for themselves (ListingCard `look` applies only to a goods card, so a rental in a mixed search keeps
 * the shell card) — and so does a goods category.
 */
export function goodsScope(category: string): boolean {
  return category === 'all' || isGoodsCategory(category)
}
