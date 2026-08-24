/**
 * SELLER DIVERSITY FOR THE DEFAULT BROWSE FEED — so the first screen of a marketplace looks like a
 * marketplace and not like one seller's catalogue.
 *
 * ⚠️ THE PROBLEM, MEASURED ON PRODUCTION 2026-08-13, NOT INFERRED. eno.vn had 35 active listings.
 * Fourteen were one partner's e-visa SKUs — the same product in Single/Multiple × 1 Hour /
 * 2 Hours / 1 Day / 2 Days / 3 Days variants — and they occupied positions 0 THROUGH 13 of the
 * feed. Every card in the first viewport, and the second, was the same product from the same
 * seller, while twenty-one genuinely different listings (a MacBook, an apartment, headphones, a
 * backpack) sat below the fold. An outside audit read the home page as "a partner storefront
 * rather than a broad expat marketplace", which is exactly what a first-time visitor sees.
 *
 * The listings are legitimate and stay: VietKite is a licensed partner and those are real products.
 * What was wrong is the ORDER. `rankScore` is a per-listing quality score with no notion of who is
 * selling, so a seller with fourteen strong listings takes fourteen strong slots.
 *
 * ⚠️ IT IS A ROUND-ROBIN, NOT A CAP, SO NOTHING IS DROPPED OR HIDDEN. Every listing keeps its place
 * in the feed and the total is unchanged — which matters structurally, because the home page's
 * `total` seeds the infinite feed's terminator and a count that disagrees with the rows either
 * stops pagination early or never ends it. Sellers are interleaved: every seller's best listing
 * first (in rankScore order), then every seller's second, and so on. With one seller holding 14 of
 * 35 listings, that seller takes slot 1 of the first round instead of the first fourteen slots.
 *
 * ⚠️ RANK ORDER SURVIVES WITHIN EACH ROUND. This is not shuffling and it is not fairness for its own
 * sake: inside a round the listings are still ordered by the score they earned, so a strong listing
 * from a strong seller still leads the page. Only the RUN is broken up.
 */

/**
 * How many rows the reorder is applied to.
 *
 * ⚠️ A WINDOW, NOT THE WHOLE TABLE, AND THE REASON IS PAGINATION COHERENCE RATHER THAN COST. The
 * feed paginates with `skip`/`take`, so a reorder is only safe if every page slices the SAME
 * ordered sequence. Fetching a fixed window, reordering it once and slicing that gives exactly
 * that guarantee for the pages inside the window; past it, the natural rankScore order continues
 * untouched. 60 is five pages of 12 — far more than a visitor reaches before the problem this
 * solves has stopped mattering.
 *
 * ⚠️ THIS IS THE SCALE LIMIT AND IT IS DELIBERATE. At 35 listings the window is the whole
 * catalogue. As inventory grows, diversity past row 60 stops being enforced — which is fine, since
 * a monopolised first screen is the failure mode, not a monopolised page six. If that ever needs to
 * hold globally, the honest fix is a SQL window function
 * (`ROW_NUMBER() OVER (PARTITION BY "sellerId" ORDER BY "rankScore" DESC)`) as the ORDER BY, not a
 * larger number here. Do not simply raise this to keep up with the catalogue.
 */
export const FEED_DIVERSITY_WINDOW = 60

/** The shape this needs. Anything with an id and a seller works — callers pass listing rows. */
type Diversifiable = { id: string; sellerId?: string | null }

/**
 * Interleave by seller, preserving relative rank inside each round.
 *
 * ⚠️ PURE AND DETERMINISTIC, WHICH IS A CORRECTNESS REQUIREMENT AND NOT A STYLE PREFERENCE. The
 * home page server-renders the first 12 cards and the client explorer then fetches the same feed
 * from /api/listings; `(home)/page.tsx` documents that the two must agree EXACTLY or the feed
 * reshuffles under the reader on hydration. Same input, same output, both sides — so both call this
 * one function over the same window rather than each sorting for itself.
 *
 * Rows without a sellerId are treated as their own singleton seller: they can never be the cause of
 * a run, so grouping them together would be the one case where this reorder INVENTS a monopoly.
 */
export function diversifyBySeller<T extends Diversifiable>(rows: readonly T[]): T[] {
  if (rows.length < 3) return [...rows]

  // Preserve arrival order within each seller — the caller has already sorted by rankScore.
  const bySeller = new Map<string, T[]>()
  for (const row of rows) {
    // `?? row.id` gives an unattributed row its own bucket; see the note above.
    const key = row.sellerId ?? `__no-seller__${row.id}`
    const bucket = bySeller.get(key)
    if (bucket) bucket.push(row)
    else bySeller.set(key, [row])
  }

  // One seller (or none) cannot be un-diversified; return the input untouched rather than paying
  // for a rebuild that cannot change anything.
  if (bySeller.size < 2) return [...rows]

  // ⚠️ THE BUCKETS ARE ALREADY IN RANK ORDER — Map preserves insertion order, and insertion order
  // is the order the rows arrived, i.e. rankScore desc. So round 1 emits sellers in the order their
  // BEST listing ranked, which is what keeps this from flattening the feed into arbitrary fairness.
  const buckets = [...bySeller.values()]
  const out: T[] = []
  for (let round = 0; out.length < rows.length; round++) {
    for (const bucket of buckets) {
      if (round < bucket.length) out.push(bucket[round])
    }
  }
  return out
}

/**
 * Whether the seller round-robin applies to a given sort.
 *
 * ⛔ ONLY THE DEFAULT BLEND. Diversity is a MERCHANDISING rule: it decides what a visitor who has
 * expressed no preference should meet first. The moment a reader picks "Cheapest first" they HAVE
 * expressed one, and interleaving by seller silently overrules it — which is the same argument the
 * route already makes for semantic results ("their order IS the relevance answer").
 *
 * ⚠️ THIS WAS A REAL, VISIBLE BUG, MEASURED ON PRODUCTION 2026-08-24, NOT A THEORETICAL ONE. With
 * two sellers in the catalogue — a visa desk and a ticket partner — `sort=price-low` returned
 * 0, 30k, 790k, 50k, 1.24M, 60k, 1.32M, 100k: two individually-ascending lists zipped together.
 * Every row was sorted and the feed was not, so the cheapest listing on screen sat in row 2 and
 * the second-cheapest in row 4. The reader reads that as "the sort is broken", and they are right.
 *
 * The default keeps the round-robin: that feed's whole job is to look like a marketplace.
 */
export function diversityAppliesTo(sort: string): boolean {
  return sort === DEFAULT_FEED_SORT
}

/**
 * The sort key that means "no preference" — the balanced relevance blend the browse feed opens on.
 * Named rather than inlined because three files have to agree on it: this module, the API route,
 * and the home page's server render.
 * ⚠️ It is the legacy string 'newest' and does NOT mean "most recent" — that is 'recent'.
 */
export const DEFAULT_FEED_SORT = 'newest'
