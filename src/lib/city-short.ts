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

/**
 * A CARD'S AREA: the ward in brackets and a Ho Chi Minh City tail come off, because the card's one-line row clipped there
 * anyway ("Quận Gò Vấp (Phường A…"). Runs on the TRANSLATED text, so the MT dictionary still keys on the stored value.
 * ⛔ DISPLAY ONLY, like everything in this file. The PDP keeps the whole string.
 */
export function cardArea(text: string): string {
  // Only a bracket that is nothing but a WARD goes, in the stored shape "Quận 12 (Phường An Phú Đông)" or its translation
  // "District 12 (An Phu Dong Ward)". A bracket with anything else in it may be the only place naming the district, so it stays.
  // ⚠️ No lookbehind and no `\b`: Safari before 16.4 cannot parse the first and would lose the whole card chunk, and `\b` is ASCII-only.
  const bare = text.replace(/\s*[(（](?:Phường|Xã|Thị trấn)\s[^)）,]*[)）]\s*|\s*[(（][^)）,]*\s(?:Ward|Commune)[)）]\s*/giu, ' ').replace(/\s+/g, ' ').trim()
  const parts = bare.split(/\s*,\s*/)
  if (parts.length > 1 && isHcmc(parts[parts.length - 1])) parts.pop()
  return parts.join(', ') || text
}

const unaccent = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
/**
 * A card's area in English: "Quận 12" reads as District 12 and "Quận Bình Thạnh" as Binh Thanh District, the spelling the area chips and H1s already use.
 * 23 Vietnamese place names sat on the live English /c/rentals (measured 2026-11-05). Display only, for a stored value no translation reached.
 */
export function cardAreaEn(text: string): string {
  return text.normalize('NFC').split(/\s*,\s*/).map(areaSegmentEn).join(', ')
}

/** One administrative level at a time: a comma-joined value carries several ("Phường Bến Nghé, Quận 1"), each with its own label. */
function areaSegmentEn(segment: string): string {
  const t = segment.trim()
  const m = /^(Quận|Huyện|Phường|Xã|Thị trấn|TP\.?|Thành phố)\s*(.+)$/iu.exec(t)
  if (!m) return unaccent(t)
  const kind = m[1].toLocaleLowerCase('vi')
  const label = kind.startsWith('phường') ? 'Ward' : kind === 'xã' ? 'Commune' : kind === 'thị trấn' ? 'Town' : kind.startsWith('tp') || kind.startsWith('thành') ? 'City' : 'District'
  // A number leads ("District 1", "Ward 5"), a name follows ("Binh Thanh District"), as the English chips write them.
  return /^\d+$/.test(m[2]) ? `${label} ${m[2]}` : `${unaccent(m[2])} ${label}`
}
