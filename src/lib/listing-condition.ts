/**
 * ONE DEFINITION OF "USED", BECAUSE TWO WOULD SILENTLY DISAGREE.
 *
 * `Listing.condition` is a free-text `String?`, not an enum, and the stored values are
 * inconsistently cased and bilingual — new / New / Like new / used / Used / Good / mới. So
 * "used" cannot be an equality check; it is "has a condition, and that condition is not
 * new-ish", which is a predicate with three moving parts and exactly the kind of thing that
 * gets re-derived slightly differently the second time somebody needs it.
 *
 * It already had two callers before this file existed in spirit: the browse feed
 * (src/app/api/listings/feed-query.ts, which owns the `?condition=` query param) and now the
 * SEO landing rail. seo-landing-href.ts documents the invariant those two have to keep —
 * "the CTA shows exactly what the page showed". A landing page whose rail used one definition
 * of used and whose CTA linked to a feed using another would break that invariant while BOTH
 * destinations still looked full of plausible listings, which is the failure mode that file's
 * comments already warn about for subcategory and attribute narrowing.
 *
 * ⚠️ `condition: { not: null }` IS LOad-BEARING, NOT DEFENSIVE. Without it every row that never
 * set a condition — a service, a job, a non-physical listing — counts as used, because it is
 * trivially "not new". Measured on the live feed: dropping the null guard is what turns a
 * 3,201-listing used-furniture rail into a much larger and much wronger one.
 */

/** A Prisma `where` fragment. Kept structural so both callers can spread or push it. */
export type ConditionWhere =
  | { OR: Array<{ condition: { contains: string; mode: 'insensitive' } }> }
  | { AND: Array<{ condition: { not: null } } | { NOT: ConditionWhere }> }

/** The two narrowings a caller may ask for. `all`/undefined means "do not filter". */
export type ListingCondition = 'new' | 'used'

/**
 * Anything the marketplace considers new-ish, in both languages. `contains` rather than equality,
 * because the predicate this was extracted from was written for free-typed values.
 *
 * ⚠️ MEASURED 2026-09-23, BECAUSE THIS PREDICATE LOOKS RISKIER THAN IT IS. A reviewer flagged that
 * `contains 'mới'` would misfile the standard Vietnamese way of describing a USED item — "Còn mới
 * 95%", "90% mới" — as new, and so delete the best secondhand stock from /moving-sales-vietnam.
 * Sound reasoning; it just is not what the column holds. Sampled 200 rows site-wide and 60 rows in
 * each of seven categories via /api/listings: the ONLY distinct values are 'new', 'used' and null.
 * Nothing free-typed, no percentages, no "còn".
 *
 * So the `contains` matching is currently harmless breadth rather than a live hazard — and it stays,
 * because the day the post wizard allows a free-typed condition it is the tolerant form that keeps
 * working. Re-measure before concluding otherwise; do not reason about it from the strings above.
 */
const NEWISH = {
  OR: [
    { condition: { contains: 'new', mode: 'insensitive' as const } },
    { condition: { contains: 'mới', mode: 'insensitive' as const } },
  ],
}

/**
 * The Prisma predicate for a condition narrowing, or `undefined` when there is none.
 *
 * Returning `undefined` rather than `{}` matters: the landing rail spreads this into a `where`
 * object, and an empty object spread is a no-op while `undefined` spread is also a no-op — but
 * an explicit `undefined` return is what lets a caller write `if (!w) return` and mean it.
 */
export function conditionWhere(condition?: string | null): ConditionWhere | undefined {
  if (condition === 'new') return NEWISH
  if (condition === 'used') return { AND: [{ condition: { not: null } }, { NOT: NEWISH }] }
  /**
   * ⛔ ANYTHING ELSE IS NO FILTER — AN ALLOW-LIST, NOT A FALL-THROUGH, and this is the whole
   * reason the parameter is typed `string` rather than the union. The value reaching this from
   * `/api/listings?condition=` is raw user input, and the code this replaced ended in
   * `else if (condition === 'used')`, so an unrecognised value applied NO narrowing and returned
   * the category. An `else return used` — which is what a union-typed signature quietly invites,
   * because it looks total — turns `?condition=refurbished` (a stale link, a typo, a crawler
   * mutating params) into a used-only feed that still renders a plausible page-1 count. Both
   * reviewers caught it on the first draft of this file.
   */
  return undefined
}
