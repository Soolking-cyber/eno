/**
 * IS THIS LOCATION HO CHI MINH CITY? — so a surface too narrow for the full name can show the
 * abbreviation everyone here actually uses.
 *
 * ⚠️ IT RETURNS A BOOLEAN, NOT A STRING, and that is deliberate: the caller picks the wording
 * through `tr()` like every other piece of copy, so the abbreviation is translated by the same
 * mechanism as the rest of the app and cannot drift into a second vocabulary. The app already
 * abbreviates this city in the search placeholder — "HCM" in English, "TP.HCM" in Vietnamese — and
 * those are the two forms callers should use.
 *
 * ⚠️ WHY ONLY THIS ONE CITY. Measured over the live catalogue: 9,726 of 9,773 listings have
 * `location` exactly "Hồ Chí Minh" — 99.5%. Every other value is already short ("Bình Thạnh",
 * "Ha Tinh") or is a two-part label that is not a bare province. A general shortening table would
 * be speculation; this is the one name that is both long and ubiquitous.
 *
 * ⛔ DISPLAY ONLY. Nothing here touches `Listing.location`, the geo filters, the facet counts or
 * the search index — abbreviating a stored value would split the facet and break every saved
 * search. The caller substitutes at render time.
 */

/**
 * ⚠️ NFC FIRST. Vietnamese text arrives in both composed and decomposed forms, and "ồ" decomposed
 * is two code points that will not equal the composed one — a comparison that looks right and
 * silently never matches. Same normalisation rule the string-length work landed on.
 * ⚠️ Diacritics are then stripped so the unaccented spellings the feed also carries
 * ("Ho Chi Minh City", "Thu Duc, Ho Chi Minh City") match the same rule.
 */
const fold = (s: string) =>
  s.normalize('NFC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The bare city, with or without the "thành phố" prefix or the English "city" suffix.
 * ⚠️ `tp` IS ACCEPTED AS WELL AS `thanh pho` — it is the standard Vietnamese administrative
 * abbreviation and "TP. Hồ Chí Minh" is how the city is written on most forms. `fold()` turns the
 * full stop into a space, so both spellings arrive here identically. No live listing uses it today
 * (measured: 9,726 are the bare name), but a merchant feed easily could, and a reviewer flagged it.
 * ⛔ ANCHORED, NOT A SUBSTRING TEST. A `includes('ho chi minh')` would also match
 * "Thu Duc, Ho Chi Minh City" — which is a DISTRICT within the city and whose own name is the
 * useful part of the label. Shortening that to "HCM" would delete the more specific fact.
 */
const HCMC = /^(?:(?:thanh pho|tp)\s+)?ho chi minh(?:\s+city)?$/

export function isHcmc(location: string | null | undefined): boolean {
  if (!location) return false
  return HCMC.test(fold(location))
}
