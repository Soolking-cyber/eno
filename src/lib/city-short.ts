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

/**
 * One administrative level in English, or null. The prefix must END (a space, or "TP." with its dot: "TPBank" is a bank), and
 * the name after it must be a place's: a district or ward number, or one to three capitalised words of letters (review:
 * "Quận 7 Phú Mỹ Hưng", "Quận 1 gần chợ Bến Thành" and "Tỉnh lộ 10" are a seller's words, and keep their translation).
 */
function adminLevelEn(segment: string): string | null {
  // "TP" only with its dot ("TP. Thủ Đức", "TP.HCM"): "TP Tower" is a building (review).
  const m = /^(?:(Quận|Huyện|Phường|Xã|Thị trấn|Thị xã|Tỉnh|Thành phố)\s+|(TP)\.\s*)(.+)$/iu.exec(segment.trim())
  if (!m) return null
  const level = m[1] ?? m[2]
  const name = m[3].trim()
  // A number, or one to three capitalised words of letters only: district and ward names run one to three syllables-words
  // ("Gò Vấp", "Nguyễn Cư Trinh"); a fourth word is a seller's ("Quận Bình Thạnh Gần Sông", review) — it keeps its translation.
  const words = name.split(/\s+/)
  const number = /^\d{1,2}$/.test(name)
  if (!number && !(words.length <= 3 && words.every((w) => /^\p{Lu}\p{L}*$/u.test(w)))) return null
  const kind = level.toLocaleLowerCase('vi')
  const label = kind.startsWith('phường') ? 'Ward' : kind === 'xã' ? 'Commune' : kind === 'thị trấn' || kind === 'thị xã' ? 'Town'
    : kind === 'tỉnh' ? 'Province' : kind.startsWith('tp') || kind.startsWith('thành') ? 'City' : 'District'
  return number ? `${label} ${name}` : `${unaccent(name)} ${label}`
}

/**
 * ⛔ A PLACE NAME IS NEVER MACHINE-TRANSLATED (best-practice gap 2026-11-10). A stored location that is NOTHING BUT Vietnamese
 * administrative places — "Huyện Nhà Bè (Xã Nhà Bè)" (the rental importers' district-with-ward shape), "Quận 7",
 * "Quận Bình Thạnh, TP. Hồ Chí Minh" — in English: "Nha Be District (Nha Be Commune)", "District 7", "Binh Thanh District,
 * Ho Chi Minh City".
 * Machine translation read "Huyện Nhà Bè" word by word: every English Nha Be rental page said "The House of Bee", the French
 * one "La maison de la bête". Null for anything that is not wholly administrative (a building, a street, free text), which
 * keeps its translation. Display only, like everything in this file.
 */
export function adminPlaceEn(text: string | null | undefined): string | null {
  if (!text) return null
  const segments = text.normalize('NFC').trim().split(/\s*,\s*/)
  // ⚠️ A WARD-LEVEL NAME IS TRUSTED ONLY IN BRACKETS: streets are named like wards ("Xã Đàn" is a Hanoi street — alone or as
  // "Xã Đàn, Quận Đống Đa", review), so every top-level part must be a district or higher ("Quận Bình Thạnh", "TP. Thủ Đức"),
  // its ward in the importers' brackets. Every location the 2026-11-10 sample of 2,220 live listings classed as
  // administrative was "district (ward)".
  if (segments.some((seg) => /^(?:Phường|Xã|Thị trấn)\s/iu.test(seg))) return null
  const out: string[] = []
  for (const seg of segments) {
    // A level with its finer one in brackets ("Quận 7 (Phường Tân Phong)"), or a level alone.
    const m = /^([^()（）]+?)\s*(?:[(（]([^()（）]+)[)）])?$/u.exec(seg)
    if (!m) return null
    const head = adminLevelEn(m[1])
    const sub = m[2] == null ? '' : adminLevelEn(m[2])
    if (head == null || sub == null) return null
    out.push(sub ? `${head} (${sub})` : head)
  }
  return out.join(', ')
}

/**
 * Does any of `texts` (a title, say) already name the place in the location's brackets — as stored or as spelled? The
 * importers' titles do ("Studio · Nha Be Commune, Nha Be District"); a seller's own "Studio for rent" does not. Accent- and
 * case-blind.
 */
export function bracketNamedIn(location: string, texts: readonly (string | null | undefined)[]): boolean {
  const inner = /[(（]([^()（）]+)[)）]/u.exec(location.normalize('NFC'))?.[1]?.trim()
  if (!inner) return false
  // The bracket of an administrative location is a ward: spelled level by level, not judged alone like a bare location.
  const wants = [inner, adminLevelEn(inner)].filter((w): w is string => !!w)
  return texts.some((t) => !!t && wants.some((w) => placeNamedIn(t, w)))
}

/**
 * Does `text` name `place` as whole words — accent- and case-blind? "…, Quận 7 TP.HCM" names "Quận 7"; "Quận 12" does not name
 * "Quận 1", nor a title about "Phường 12" "Phường 1" (review: a substring said yes to both, an exact segment no to the first).
 */
export function placeNamedIn(text: string, place: string): boolean {
  const fold = (s: string) => unaccent(s.normalize('NFC')).toLowerCase().trim()
  const p = fold(place)
  if (!p) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(fold(text))
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
