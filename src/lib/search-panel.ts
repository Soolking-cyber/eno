/**
 * The header search window's two panels, as a pure function.
 *
 * ⛔ THE BUG THIS EXISTS TO PREVENT IS A GAP BETWEEN THEM. The history panel wanted an EMPTY query
 * and the instant-match panel wants two characters, so one character satisfied NEITHER: the window
 * blinked out and back in mid-word, on every search, for every returning user. The fix is that the
 * history panel holds for one more character — but the fix is one comparison in a component that
 * also owns focus, refs, a fetch and a router, and the only way to PROVE the two ranges still meet
 * is to test them apart from all of that. `isSwipe()` in card-slots.ts exists for the same reason.
 *
 * ⚠️ BOTH PREDICATES MUST MEASURE THE QUERY THE SAME WAY — see `queryLength`. They are complements of one comparison:
 * the moment one measures `query.length` and the other `query.trim().length`, a query of `"a "`
 * satisfies both (a double panel) or neither (the blink is back). The disjoint/no-gap test below
 * is what holds that together.
 */

/** Below this, the query cannot usefully match anything — the panel shows history instead. */
export const INSTANT_MIN_CHARS = 2

/**
 * How long the query is, as the person typing it would count.
 *
 * ⛔ `normalize('NFC')` IS NOT OPTIONAL ON A VIETNAMESE SITE. `String.length` counts UTF-16 code
 * units, and Vietnamese tone marks have both a precomposed and a decomposed encoding that RENDER
 * IDENTICALLY. Measured: `ế` is 1 unit composed and **3** decomposed; `ữ` and `ợ` likewise. So a
 * user whose input arrives decomposed — a paste out of a macOS-authored document, a normalizing
 * IME, text carried through an app that stores NFD — trips the 2-character instant gate on their
 * FIRST letter, and the history panel they were reading vanishes a character early. NFC folds all
 * three forms to 1, so every encoding of the same word counts the same.
 * ⚠️ This predates the panel fix — `searchVal.trim().length >= 2` had the same hole, and so did
 * `useSearchSuggest`, which measures the query AGAIN for its own 2-character fetch gate. Both now
 * call `normalizeQuery` and share `INSTANT_MIN_CHARS`, so the panel and the fetch cannot drift.
 * ⛔ NORMALISING IS ABOUT THE LENGTH, NOT THE MATCH — a reviewer argued an NFD query would find
 * nothing on the server and I nearly wrote that down. MEASURED instead: `/api/search/suggest` with
 * NFC vs NFD `áo` returns the SAME 6 listings, categories and brands. The API already folds
 * accents, so the submit path needs no normalising and this is not a search-results fix.
 */
export function normalizeQuery(query: string): string {
  return query.normalize('NFC').trim()
}

export function queryLength(query: string): number {
  // ⚠️ SPREAD, NOT `.length`: `.length` is UTF-16 code units, so a single emoji (a surrogate pair)
  // counts 2 and opens the instant panel on one visible character. Spreading iterates CODE POINTS.
  // ⛔ Code points, not grapheme clusters — a ZWJ sequence (👨‍👩‍👧) or a flag still counts >1. That is
  // deliberate: `Intl.Segmenter` for a two-character threshold is not worth the cost, and no
  // Vietnamese text needs it once NFC has composed the tone marks.
  return [...normalizeQuery(query)].length
}

/**
 * Should the trending fetch be running?
 *
 * ⚠️ THE SAME RANGE AS `suggestOpen`, NOT `=== 0`, AND THE HOOK IS WHY. `useTrendingSearches` takes
 * `enabled` as its only effect dependency, so flipping it false runs the cleanup and ABORTS the
 * in-flight request; `items` is left alone but on a cold cache there is nothing to leave, so it
 * stays `[]`. Gate this at `=== 0` and a first-time visitor who types before the fetch lands kills
 * it, has no history to fall back on, and never sees trending again that session.
 * (On a WARM memo the hook does keep its items when disabled — which is why `=== 0` looked correct
 * every time it was tested second. Both statements are true; they describe different caches.)
 *
 * ⚠️ THE KNOWN COST, MEASURED, AND WHY IT IS THE RIGHT SIDE OF THE TRADE. Because the fetch now
 * survives the first keystroke, a first-time visitor with NO history can be sitting at one
 * character when trending lands, and the panel opens under them. Three reviewers called that a
 * regression. It is a real event — reproduced by delaying `/api/search/trending` 2500ms, where the
 * panel goes absent → absent → opens at +3000ms — but the delay was the probe's, not the app's:
 * the endpoint answers in 6-14ms locally. The same pop-in already existed at ZERO characters and
 * nobody called it a bug; the diff only moved which keystroke it can land on. And it is a panel
 * OPENING, never closing, which is the end state the user wants either way.
 * ⛔ WHAT IS STILL UNFIXED, HONESTLY: a first-time visitor with no history who backspaces 2 -> 1
 * sees the window close for as long as the refetch takes (measured `bksp:ABSENT`). The old rule did
 * the same and never reopened at all, so this is strictly better — but it is not nothing, and the
 * fix is a latch, not a comparison. Don't let this comment read as "that case is handled".
 */
export function trendingEnabled(focused: boolean, query: string): boolean {
  return focused && queryLength(query) < INSTANT_MIN_CHARS
}

export type SearchPanels = {
  /** History/trending panel: recent searches, recent locations, trending terms. */
  suggestOpen: boolean
  /** Instant-match listbox: brands, categories, listings. Owns the arrow keys. */
  instantOpen: boolean
  /** Either — the pill morphs to a flat-bottomed window while this is true. */
  panelOpen: boolean
}

/**
 * `hasSuggestions` is `recentSearches.length > 0 || recentLocations.length > 0 || trending.length > 0`
 * — the history panel has nothing to show without at least one of them, and an empty open panel is
 * worse than a closed one.
 */
export function searchPanels(focused: boolean, query: string, hasSuggestions: boolean): SearchPanels {
  const n = queryLength(query)
  const suggestOpen = focused && n < INSTANT_MIN_CHARS && hasSuggestions
  const instantOpen = focused && n >= INSTANT_MIN_CHARS
  return { suggestOpen, instantOpen, panelOpen: suggestOpen || instantOpen }
}
