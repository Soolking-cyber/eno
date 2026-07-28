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
