import { BOTH_SEPARATORS_RE } from './itinerary-place-names'

/**
 * TURNING A GENERATED STOP NAME INTO SOMETHING A GAZETTEER CAN ANSWER.
 *
 * ⚠️ WRITTEN AGAINST THE 23 REAL UNMAPPED NAMES IN PRODUCTION, not invented cases. On 2026-07-28,
 * 23 of 69 itinerary stops had no map pin — a third of every plotted trip — and reading them
 * disproved the diagnosis standing in the backlog ("AI-invented names no gazetteer will ever
 * contain"). Plenty are real, famous and findable:
 *
 *     Tan Son Nhat Airport (SGN)      Sun World Ba Na Hills      Nguyen Hue Pedestrian Street
 *     Long Beach Phu Quoc             Duong Dong Night Market    Cam Thanh Coconut Village
 *
 * What defeated the lookup was decoration, because `queryFor` appended ", <city>, Vietnam" to the
 * raw string and did nothing else. This module removes the decoration, and does exactly two new
 * things — the third is not new, it is an EXISTING rule that had never been applied on this path.
 *
 * ⚠️ IT DOES NOT TOUCH `or`, AND THAT IS DELIBERATE. `itinerary-place-names` draws a distinction
 * both external reviewers insisted on before it was written: `&`/`+`/`,` join places the traveller
 * visits BOTH of (plotting the first is right), while `or` offers a CHOICE they have not made, so
 * callers REFUSE rather than guess a venue the map would then state as fact. `geocodePlace` already
 * enforces that with `isAlternativesName` before anything here runs. An earlier draft of this file
 * narrowed "The Deck Saigon or Binh An Village" to "The Deck Saigon" — precisely the bypass that
 * rule exists to catch, and precisely the bug its comment records catching twice already.
 *
 * ⚠️ IT NARROWS, IT NEVER INVENTS. Every transform removes text. The caller's gates are untouched —
 * a result must still be inside Vietnam and near the day's city (`isInVietnam`, `isNearCity`) to be
 * accepted or cached — so the worst case of a bad narrowing is the unmapped stop we already have,
 * never a pin somewhere wrong.
 */

/** `A to B` — a journey between two places rather than a place. Both sides must look substantial. */
const TRANSIT_RE = /^\s*([^,]{3,})\s+to\s+([^,]{3,})\s*$/i

/**
 * The name to search a gazetteer for, or null when the name cannot denote a point.
 *
 * Null means DO NOT ASK. That matters beyond tidiness: the daily geocode budget is strict and
 * fail-closed, so a request spent on a name that cannot have a coordinate is one a real place does
 * not get. It is also the cheap half of the "negative cache" the backlog asks for — declining to
 * ask costs nothing, whereas remembering a miss is impossible today (`PlaceGeocode.lat/lng` are
 * NOT NULL, so the table physically cannot hold one).
 */
export function placeSearchName(raw: string): string | null {
  let name = (raw || '').trim()
  if (!name) return null

  // (1) NEW — a leg of travel is not a destination: "Hanoi Airport to Da Nang", "Phu Quoc to
  // Saigon". Checked first, on the untouched string.
  if (TRANSIT_RE.test(name)) return null

  // (2) NEW — "Tan Son Nhat Airport (SGN)" → "Tan Son Nhat Airport". The bracket carries an airport
  // code, a district or a translation; gazetteers index none of them.
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()

  // (3) NOT NEW — the "both" splitter from itinerary-place-names, which until now ran only in the
  // CATALOGUE resolver (itinerary-places.ts) and never on the gazetteer path. So a compound that
  // missed the catalogue was handed to the provider whole and failed: "Gam Ghi & May Rut Islands",
  // "Xuan Huong & Dong Khoi Boutiques". Its documented rule is that plotting the first is right,
  // because the traveller is going to both and they are usually metres apart.
  //
  // Only the FIRST part is tried, rather than each in turn until one resolves, because every
  // attempt costs a metered lookup — the catalogue can afford to walk the list, a paid API cannot.
  const [first] = name.split(BOTH_SEPARATORS_RE).map((part) => part.trim()).filter(Boolean)
  if (first) name = first

  // Re-checked after narrowing: "X (note) to Y" only becomes recognisable as a leg once the
  // bracket is gone.
  if (TRANSIT_RE.test(name)) return null

  // Narrowing can leave a fragment too short to identify anything.
  return name.length >= 3 ? name : null
}
