/**
 * Place-NAME grammar: the rules for reading what a generator wrote, with no catalogue attached.
 *
 * ⚠️ THIS FILE EXISTS FOR ONE REASON — IT HAS NO SIDE EFFECTS, so a client component can import a
 * rule from it without dragging 322 places into the browser.
 *
 * `itinerary-places.ts` builds `PLACES_BY_CITY` and its lookup index in module-scope IIFEs. Those
 * are side effects, so the module is not tree-shakeable: importing ONE regex from it pulls the
 * entire catalogue. Measured on 2026-07-26, when trip-day-list.tsx (a client component) began
 * importing `isAlternativesName` for the Google Maps links — a **72,399-byte** client chunk
 * containing "Bến Thành", to use a single regular expression. Found by murat while building it and
 * flagged rather than worked around; verified by grepping the built chunks before fixing.
 *
 * So the grammar lives here and `itinerary-places.ts` re-exports it. Every existing importer is
 * unaffected, and a client may import from this module directly and pay nothing.
 *
 * ⚠️ KEEP THIS FILE FREE OF SIDE EFFECTS AND OF CATALOGUE IMPORTS. A single `import` of
 * `itinerary-places` here, or one module-scope Map, silently restores the 72 KB.
 */

/**
 * ⚠️ TWO KINDS OF COMPOUND, AND THEY ARE NOT THE SAME PROBLEM.
 *
 *   · `&`, `+`, `,` join places the traveller is visiting BOTH of. Plotting the first one that
 *     resolves is right: it is somewhere they are actually going, and the day's other stop is
 *     usually metres away ("Saigon Zoo & Botanical Gardens" is one site).
 *   · `or` offers ALTERNATIVES — a choice the traveller has not made yet. Picking one plots a
 *     place they may never visit, and the map states it as fact. There is no "probably fine" here,
 *     so callers REFUSE rather than guess, and the stop stays unmapped until a human decides.
 *
 * Both external reviewers insisted on that distinction before it was written, and it has since
 * caught two separate bypasses — the geocoder handing an `or` name to a gazetteer, and a directions
 * link handing one to Google Maps. Each would have asserted one venue while the itinerary offered
 * two.
 */
const ALTERNATIVES_RE = /\s+(?:or|hoặc)\s+/i

/** Joiners meaning BOTH. Kept to the three the production data actually contains — adding " and "
 *  would split legitimate single names ("Fish and Chips") for no measured gain. */
export const BOTH_SEPARATORS_RE = /\s*[&+,]\s*/

/** Does this name offer a choice rather than name a place? */
export const isAlternativesName = (name: string): boolean => ALTERNATIVES_RE.test(name ?? '')
