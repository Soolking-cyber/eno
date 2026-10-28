/**
 * eno's VOICE CONCIERGE (owner, 2026-10-27: "an app ai avatar concierge with toolcall a small square floating window …
 * it should be able to navigate through app seamlessly"). The shapes shared by the brain, the action validator, the page
 * reader and the routes. Plan: ~/eno-classroom-2026-10-25/concierge/PLAN.md.
 *
 * ⛔ The model never writes a URL. It writes an ACTION in the catalog's own vocabulary; the server validates it against
 * the taxonomy and builds the URL (actions.ts); the page only follows a `go` line the server wrote.
 */

/** What the model asks for this turn — flat, every field present (`''` = none), so both brains' decoders accept it. */
export type ConciergeAction = {
  /**
   * browse: open a category with filters. find: the SAME fields, but the app does not move — the server reads that view's
   * first cards and the brain answers again with them as SEARCH RESULTS (turn.ts), so it can open the one that fits
   * (owner, 2026-10-28: "make sure it has tool calls to open right product on website"). listing: open one card.
   * page: open a page.
   */
  kind: 'none' | 'browse' | 'find' | 'listing' | 'page'
  /** browse / find: `refine` merges into the page's current filters (same category); `replace` starts from the category. */
  mode: 'refine' | 'replace'
  /** browse / find: a TAXONOMY slug; `''` with `refine` = the page's category. */
  category: string
  /** browse / find: a subcategory slug of `category`; `''` = keep (refine) or all (replace); `any` = all. */
  subcategory: string
  /** browse / find: catalog keys and values (facet keys, `district`, `province`, `priceMin`, `priceMax`, `sort`,
   *  `condition`, `type`); a range facet takes `min-max` with either side open; the value `any` removes the key (refine). */
  filters: { key: string; value: string }[]
  /** browse / find: free words for the search box (no places, no prices) — `''` = none. */
  search: string
  /** listing: an id from this turn's PAGE or SEARCH RESULTS · page: a key of CONCIERGE_PAGES. */
  target: string
}

export const NO_ACTION: ConciergeAction = Object.freeze({
  kind: 'none', mode: 'refine', category: '', subcategory: '', filters: [], search: '', target: '',
}) as ConciergeAction

/** One result card as the model may hear it — public card fields only, never contact data or ids of sellers. */
export type PageCard = {
  id: string
  title: string
  /** Spoken-ready price text from src/lib/vnd.ts (`12.000.000 ₫/month`), or '' when the card has none. */
  price: string
  /** District / city as shown on the card. */
  place: string
  /** A few public facts the card shows (teacher: nationality, English level, experience; rental: bedrooms). */
  facts: string[]
}

/** What the person is looking at when they speak — read on the server from the page's own URL. */
export type PageState = {
  /** The parent page's public path + query, as sent (validated: same-origin relative path). */
  href: string
  kind: 'explorer' | 'listing' | 'other'
  /** Explorer only: the URL's own state, in the explorer's reader's terms. */
  category: string | null
  subcategory: string | null
  /** Explorer only: the filters as catalog key → value (district, priceMin/priceMax, sort, condition, type, facet keys). */
  filters: Record<string, string>
  search: string
  /**
   * Explorer only: URL params a refine carries over AS THEY ARE — what the catalog cannot name (brand, model, line, the
   * good-price toggle, a ward). Without them "cheapest first" on an Apple shelf would show every brand (commit review,
   * codex).
   */
  keep?: Record<string, string>
  /** Explorer only: the feed's own total for these filters (null = not counted in time). */
  total: number | null
  /** Up to five cards the page shows first (explorer), or the listing itself (listing). */
  cards: PageCard[]
  /** One compact block for the prompt — data, never instructions. */
  summary: string
}

/** A validated action: where the page goes, and how the avatar may describe it. */
export type ResolvedAction = {
  kind: 'browse' | 'listing' | 'page'
  /** The public path + query the page navigates to (already `localizedHref`-ed). */
  href: string
  /** Plain words for the trace and the caption ("Teachers · can teach in District 1 · native speakers"). */
  label: string
  /** browse: the category and filters it shows (the next turn's PAGE before it is re-read). */
  category?: string
  /** page: the window cannot live on that page (/post, /messages, /teachers/join): the host navigates, then closes. */
  closes?: boolean
  /**
   * browse: part of what was asked could not be applied (a filter, value or search the view does not take) — the page
   * shows the rest. ⛔ The model's own words are not said then: they were written for the whole action (review round 3).
   */
  partial?: boolean
}
