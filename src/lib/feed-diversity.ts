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
type Diversifiable = { id: string; sellerId?: string | null; subcategorySlug?: string | null }

/**
 * SUBCATEGORIES THAT SHARE ONE SEAT IN THE DEFAULT FEED, however many storefronts sell in them.
 *
 * ⛔ THE ROUND-ROBIN'S UNIT IS THE SELLER, AND A CATALOGUE SPLIT ACROSS SELLERS DEFEATS IT. Measured on
 * production 2026-09-25, the day nine mobile carriers were imported as nine partner storefronts
 * (scripts/import-esim.ts): the window's fan-out takes the twelve best-ranked SELLERS, the nine
 * carriers were the nine freshest, and eSIM plans filled 18 of the first 24 home cards and roughly
 * three-quarters of the first 60 — the same "one catalogue owns the front page" failure this module
 * exists to prevent, arriving through nine doors instead of one. Owner: "one shared seat".
 * So in the default feed every row of these subcategories is ONE seat, positioned by its best row;
 * the carriers still interleave INSIDE that seat. Inside the aisle itself (the feed filtered to the
 * subcategory) the option is off and every carrier is its own seat again — see `sharedSeatsFor`.
 * ⚠️ Not a rank change: rankScore is untouched (it must stay the published formula's output); this
 * decides only the ORDER of a window, exactly as the seller round-robin does.
 */
export const SHARED_SEAT_SUBCATEGORIES: readonly string[] = ['esim']

/** Options for the seat rule. Off unless a caller asks — every pre-existing caller is unchanged. */
export type SeatOptions = { sharedSeats?: boolean }

/**
 * Whether a feed filtered to `subcategory` should collapse the shared seats: only when NO subcategory
 * is chosen. Inside the shared aisle every row is the catalogue and the useful variety is between its
 * sellers; inside any other subcategory there are no catalogue rows, so the rule could only cost a
 * query. One function so the API route and the home page cannot disagree about it.
 * ⚠️ WHAT IT DOES NOT DO: past FEED_DIVERSITY_WINDOW the feed is plain rank order (the module's
 * documented limit), so a tied catalogue's rows beyond its window share arrive together there — on
 * 2026-09-25, rows ~60-115 of the home feed — until their recency component decays. The first screen
 * is the failure this prevents; "a monopolised page six" is the accepted cost, as above.
 */
export function sharedSeatsFor(subcategory: string | null | undefined): boolean {
  return !subcategory
}

/** The seat a row competes for: its seller's, or its catalogue's when the shared-seat rule is on. */
export function seatKey(row: Diversifiable, opts?: SeatOptions): string {
  if (opts?.sharedSeats && row.subcategorySlug && SHARED_SEAT_SUBCATEGORIES.includes(row.subcategorySlug)) {
    return `__catalogue__${row.subcategorySlug}`
  }
  // `?? row.id` gives an unattributed row its own bucket; see diversifyBySeller.
  return row.sellerId ?? `__no-seller__${row.id}`
}

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
export function diversifyBySeller<T extends Diversifiable>(rows: readonly T[], opts?: SeatOptions): T[] {
  if (rows.length < 3) return [...rows]

  // Preserve arrival order within each seller — the caller has already sorted by rankScore.
  // ⚠️ With `sharedSeats`, a catalogue's rows share ONE bucket and keep their arrival order inside
  // it — which, from diverseFeedWindow, is already interleaved by carrier (see catalogueGroup).
  const bySeller = new Map<string, T[]>()
  for (const row of rows) {
    const key = seatKey(row, opts)
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

/**
 * Merge already-sorted per-seller groups by taking one from each in turn.
 *
 * ⛔ THIS IS THE HALF `diversifyBySeller` COULD NOT DO, AND THE REASON IS THE INPUT. That function
 * reorders a window it is HANDED — the top 60 by rankScore — so it can only interleave sellers who
 * are already in that window. Measured on production 2026-09-08 with 10,215 listings across nine
 * sellers: one seller's 152 rows all scored an identical 0.5772, filled the entire window, and the
 * round-robin became a no-op because `bySeller.size < 2`. Every card on the front page was one
 * shop. The file's own note predicted exactly this ("as inventory grows, diversity past row 60
 * stops being enforced") and named the fix.
 *
 * The fix needs each seller's BEST rows fetched separately, then merged here — which is what
 * `diverseFeedWindow` (feed-window.ts) does. This function is the pure, testable half of it.
 *
 * ⚠️ GROUPS ARRIVE IN PRIORITY ORDER AND KEEP IT. Round 1 is groups[0][0], groups[1][0], … so the
 * strongest seller still leads the page; only the RUN is broken up. Empty groups are skipped rather
 * than leaving holes, so a seller with two listings simply stops appearing after round two.
 */
export function mergeRoundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const out: T[] = []
  const depth = Math.max(0, ...groups.map((g) => g.length))
  for (let i = 0; i < depth; i++) for (const g of groups) if (i < g.length) out.push(g[i])
  return out
}
