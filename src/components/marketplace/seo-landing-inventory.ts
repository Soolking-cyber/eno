// Does an SEO landing page have anything to send a visitor to?
//
// PURE and in its own module because seo-landing.tsx imports the Prisma client and therefore
// cannot be imported from a unit test (same reason seo-landing-href.ts exists separately).
//
// ⚠️ THE WHOLE POINT IS THAT "EMPTY" AND "COULDN'T LOOK" ARE DIFFERENT. SeoLanding wraps its
// query in a try/catch so a database outage at build time still renders the content shell — which
// means `listings.length === 0` is ALSO true when the query never ran. Collapsing the two would
// put "Nothing is listed here yet — be the first to list one" on a page with a hundred listings,
// and because these pages are ISR'd at `revalidate = 604800` it would stay there for a WEEK.
//
// So the caller must pass whether the query actually returned. An outage falls back to the
// optimistic CTA, which is exactly the behaviour these pages had before the empty state existed.

/**
 * True only when we looked and there was genuinely nothing.
 *
 * @param queryReturned whether the listings query completed (false = DB outage, not an empty shelf)
 * @param count         how many listings came back
 */
export function hasNoInventory(queryReturned: boolean, count: number): boolean {
  return queryReturned && count === 0
}

/**
 * The rail's rows for a page — or none, WITHOUT a query, when the page has switched its rail off
 * (`SeoContent.rail === false`).
 *
 * ⚠️ OFF IS NOT EMPTY, SO `known` IS FALSE. A rail is switched off by a page that has already said why
 * nothing can be listed — a phone not yet on sale in Vietnam (the iPhone Duo before 23 October, see
 * iphone-18-vietnam/model-landing.tsx). Reading that as "we looked and found nothing" would take
 * `hasNoInventory`'s branch: "Be the first to list one", an invitation to list a second-hand unit of a
 * phone nobody can own yet — the mislabelled pre-order the rail is switched off to keep out. So the
 * page keeps its ordinary CTA and shows no rail.
 */
export function railFor<L>(content: { rail?: false }, load: () => Promise<{ listings: L[]; known: boolean }>): Promise<{ listings: L[]; known: boolean }> {
  return content.rail === false ? Promise.resolve({ listings: [], known: false }) : load()
}
