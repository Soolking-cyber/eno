/**
 * Where an SEO landing page's CTA sends people to see EVERY matching listing, not just the eight
 * rendered on the page.
 *
 * ⚠️ ITS OWN LEAF MODULE, and for the reason `seo-landing-slugs.test.ts` writes at the top of
 * itself: `seo-landing.tsx` imports the Prisma client, so a rule defined there cannot be reached by
 * a unit test without dragging a database into it. This function decides where a visitor lands
 * after reading a page that has just described a narrowed set of products — the one place a silent
 * mismatch costs a click — so it is worth being able to assert on directly. Zero imports on
 * purpose: the type below is structural, not the full `SeoContent`, so the leaf stays a leaf.
 *
 * ⚠️ TWO DIFFERENT DESTINATIONS ON PURPOSE. A page that narrows nothing funnels to `/c/<slug>`, a
 * real server-rendered route. There is no `/c/<cat>/<subcat>` route — subcategory and facet
 * browsing live on the home explorer's query string (`listings-explorer.tsx` reads `category`,
 * `subcategory` and `attr_*` on mount), which is also where `src/lib/itinerary-resources.ts`
 * points, for the same reason. Sending a narrowed page at `/c/services` instead would show the
 * visitor the whole category — a wider set than the page just described.
 */
export type SeoBrowseTarget = {
  categorySlug: string
  subcategorySlug?: string
  attributes?: Record<string, string>
}

export function seoBrowseHref(content: SeoBrowseTarget): string {
  const attrs = Object.entries(content.attributes ?? {})
  // ⚠️ THE CONDITION IS "NARROWED AT ALL", NOT "HAS A SUBCATEGORY" — agy refuted the first cut,
  // which keyed on `subcategorySlug` alone. A page setting `attributes` WITHOUT a subcategory still
  // filtered its own rail, but its CTA fell through to `/c/<category>` and sent the visitor to the
  // whole category — a wider set than the page had just described, and silent, because BOTH
  // destinations are valid pages full of listings. No page does that today; the point is that
  // adding one would not have been a mistake anybody could see.
  if (!content.subcategorySlug && attrs.length === 0) return `/c/${content.categorySlug}`
  const params = new URLSearchParams({ category: content.categorySlug })
  if (content.subcategorySlug) params.set('subcategory', content.subcategorySlug)
  // `attr_<key>=<value>` is the feed's own convention, not a new one — see
  // src/app/api/listings/feed-query.ts, which turns each into a `contains` on the attributes JSON.
  // The landing page's Prisma query builds the same predicate from the same object, which is what
  // makes "the CTA shows exactly what the page showed" true rather than merely intended.
  for (const [key, value] of attrs) params.set(`attr_${key}`, value)
  return `/?${params.toString()}`
}
