/**
 * Apartment classification for the imported rentals — type, furnishing, amenities — read ONLY from
 * what each source itself states. Owner, 2026-09-30: "proper classification for apartments duplex
 * studio with balcony fully furnished not furnished etc for easier search".
 *
 * ⛔ NO FREE TEXT EXISTS TO SEARCH, ON PURPOSE. Every importer COMPOSES its description from facts
 * ("Type: … Furnishing: …") and drops the poster's own body, which routinely carries phone numbers.
 * So the evidence is: (1) the composed `Type:` / `Furnishing:` lines, (2) the source URL SLUG — for
 * Rever and Honeycomb it is the agency's own title ("…-huong-ban-cong-dong-bac-day-du-noi-that-…"),
 * and (3) a page-facts pass (scripts/classify-apartment-rentals.ts) reading structured page fields.
 *
 * ⛔ NEVER INFERRED FROM SIZE OR PRICE. A 28 m² "serviced / mini" flat is not therefore a studio; a
 * type is set only where a source names it. Conflicting evidence (a slug saying both "duplex" and
 * "penthouse") yields NOTHING rather than a pick — an empty filter is honest, a wrong one is not.
 */

export type AptType = 'studio' | 'duplex' | 'penthouse' | 'serviced' | 'officetel'
export type Furnishing = 'premium' | 'fully' | 'partly'
export type Amenity = 'balcony' | 'pool' | 'gym' | 'pets'
export interface AptFacts { aptType?: AptType; furnishing?: Furnishing; amenities?: Amenity[] }

const fold = (s: string) => s.normalize('NFC').toLowerCase()

/** One answer when exactly one candidate matched, else nothing. */
function only<T>(hits: T[]): T | undefined {
  const u = [...new Set(hits)]
  return u.length === 1 ? u[0] : undefined
}

/** The composed `Type:` line (Nhatot / Muaban / Honeycomb). "Apartment" and collective housing name no type. */
export function aptTypeFromTypeLine(typeLine: string | null | undefined): AptType | 'penthouse-or-duplex' | undefined {
  const t = fold(typeLine ?? '').trim()
  if (!t) return undefined
  if (/^penthouse\s*\/\s*duplex$/.test(t)) return 'penthouse-or-duplex' // Honeycomb lumps them; the slug decides
  if (/serviced|mini apartment/.test(t)) return 'serviced'
  if (/^duplex/.test(t)) return 'duplex'
  if (/^penthouse/.test(t)) return 'penthouse'
  if (/officetel/.test(t)) return 'officetel'
  if (/^studio/.test(t)) return 'studio'
  return undefined
}

/** The composed `Furnishing:` line (Nhatot's own three-way field). */
export function furnishingFromLine(line: string | null | undefined): Furnishing | undefined {
  const t = fold(line ?? '').trim()
  if (/^premium/.test(t)) return 'premium'
  if (/^fully/.test(t)) return 'fully'
  if (/^unfurnished/.test(t)) return 'partly'
  return undefined
}

/**
 * Tokens that flip or displace what follows. Second-opinion catches (2026-09-30, agy + Opus):
 * "khong-ban-cong" (NO balcony), "cam-nuoi-thu-cung" (pets FORBIDDEN) and "gan-ho-boi" (NEAR a pool)
 * all contain the phrase and all mean something else. A phrase right after one of these says nothing.
 */
const NEGATORS = new Set(['khong', 'chua', 'cam', 'no', 'without', 'non'])
const NEARBY = new Set(['gan', 'near', 'cach', 'nearby', 'close', 'walk', 'next'])
/** Look-alikes: "ban-cong-an" (ward police board), "ban-cong-nghiep" (semi-industrial). */
const NOT_AFTER: Record<string, Set<string>> = { 'ban-cong': new Set(['an', 'nghiep', 'ty']) }

/**
 * A negator or "near" word at token k — unless it is really half of an ordinary compound: "không gian"
 * (space), "cam kết" (guaranteed), "phong cách" (style). Round-2 review (Opus) found each of these
 * silently dropping a real tag once the lookback widened.
 */
function flips(toks: string[], k: number): boolean {
  const t = toks[k], next = toks[k + 1], prev = toks[k - 1]
  if (NEGATORS.has(t)) return !((t === 'khong' && next === 'gian') || (t === 'cam' && next === 'ket'))
  if (NEARBY.has(t)) return !(t === 'cach' && prev === 'phong')
  return false
}

/** How far back a negation can sit: "khong-cho-phep-nuoi-thu-cung" (pets NOT permitted) puts it 3 back. */
const LOOKBACK = 4

/**
 * Does the slug STATE this phrase — whole tokens, not negated, not "near …", not a look-alike?
 * ⚠️ Looks LOOKBACK tokens back so "khong-co-ban-cong" and "khong-duoc-phep-nuoi-thu-cung" are
 * caught as well as "khong-ban-cong", and "gan-ho-boi" as well as "near-the-pool".
 */
function slugHas(slug: string, ...phrases: string[]): boolean {
  const toks = slug.split(/[-/_]+/).filter(Boolean)
  return phrases.some((phrase) => {
    const p = phrase.split('-')
    for (let i = 0; i + p.length <= toks.length; i++) {
      if (!p.every((w, j) => toks[i + j] === w)) continue
      let flipped = false
      for (let k = Math.max(0, i - LOOKBACK); k < i; k++) if (flips(toks, k)) { flipped = true; break }
      if (flipped) continue
      const next = toks[i + p.length]
      if (next && NOT_AFTER[phrase]?.has(next)) continue
      return true
    }
    return false
  })
}

/**
 * A literal phrase in the slug, whole tokens — for phrases that ARE a negation ("khong-noi-that").
 * ⚠️ "khong-noi-that-cao-cap" is "NOT high-end furniture" (so: some furniture), not "no furniture" —
 * a following grade word disqualifies it (Opus, round 2).
 */
function slugHasPhrase(slug: string, phrase: string): boolean {
  const toks = slug.split(/[-/_]+/).filter(Boolean)
  const p = phrase.split('-')
  for (let i = 0; i + p.length <= toks.length; i++) {
    if (!p.every((w, j) => toks[i + j] === w)) continue
    if (['cao', 'day', 'full', 'sang'].includes(toks[i + p.length] ?? '')) continue
    return true
  }
  return false
}

/**
 * ⚠️ PREMIUM OUTRANKS FULLY: "đầy đủ nội thất cao cấp" (fully furnished, high-end) is the commonest
 * premium phrasing and matches both — Opus caught `only()` turning it into nothing. Premium IS full.
 * ⛔ BASIC FURNITURE ("nội thất cơ bản") IS NOT CLASSIFIED: the stored value `partly` is labelled
 * "Unfurnished" / "Nhà trống" in the filter, and a flat with a bed and a sofa is not that. A contradiction
 * between "unfurnished" and a furnished tier also yields nothing.
 */
function furnishingOf(premium: boolean, fully: boolean, unfurnished: boolean): Furnishing | undefined {
  if (unfurnished && (premium || fully)) return undefined
  if (premium) return 'premium'
  if (fully) return 'fully'
  if (unfurnished) return 'partly'
  return undefined
}

/** Facts stated in a source URL slug (the agency's own title for Rever and Honeycomb). */
export function factsFromSlug(url: string | null | undefined): AptFacts {
  let slug = ''
  try { slug = decodeURIComponent(new URL(url ?? '').pathname).toLowerCase() } catch { return {} }
  const out: AptFacts = {}
  const types: AptType[] = []
  if (slugHas(slug, 'studio')) types.push('studio')
  if (slugHas(slug, 'duplex')) types.push('duplex')
  if (slugHas(slug, 'penthouse')) types.push('penthouse')
  if (slugHas(slug, 'officetel')) types.push('officetel')
  if (slugHas(slug, 'can-ho-dich-vu', 'serviced-apartment', 'service-apartment')) types.push('serviced')
  const aptType = only(types)
  if (aptType) out.aptType = aptType

  const furnishing = furnishingOf(
    slugHas(slug, 'noi-that-cao-cap', 'luxury-furnished', 'luxurious-furnished', 'high-end-furniture'),
    slugHas(slug, 'day-du-noi-that', 'noi-that-day-du', 'full-noi-that', 'full-furnished', 'fully-furnished', 'full-furniture'),
    // ⛔ NOT "nha-trong": unaccented, "nhà trống" (empty home) and "nhà trong hẻm" (a house IN an
    // alley) are the same slug. The accented page text keeps it (reverFurnishing), where they differ.
    // "khong-noi-that" is itself the negation, so it is matched as a phrase, not through NEGATORS.
    slugHasPhrase(slug, 'khong-noi-that') || slugHas(slug, 'unfurnished'),
  )
  if (furnishing) out.furnishing = furnishing

  const am: Amenity[] = []
  // "huong-ban-cong-…" (balcony faces …) states a balcony as surely as "co-ban-cong".
  if (slugHas(slug, 'ban-cong', 'balcony', 'balconies')) am.push('balcony')
  if (slugHas(slug, 'ho-boi', 'pool', 'swimming-pool')) am.push('pool')
  if (slugHas(slug, 'gym')) am.push('gym')
  if (slugHas(slug, 'pet-friendly', 'pets-allowed', 'nuoi-thu-cung')) am.push('pets')
  if (am.length) out.amenities = am
  return out
}

/**
 * Rever's "Tiện ích" list, as the listing's agent ticked it. ⚠️ SOME AGENTS TICK ALL TWELVE — private
 * pool, garden, basement and maid's room on a 48 m² flat — so a list at (or near) the full
 * vocabulary is boilerplate and says nothing; below that it is the agent's statement about the flat.
 */
export const REVER_AMENITY_VOCABULARY = 12
export function reverAmenities(items: string[]): Amenity[] {
  if (!items.length || items.length >= REVER_AMENITY_VOCABULARY - 2) return []
  const out: Amenity[] = []
  for (const raw of items) {
    const t = fold(raw).trim()
    if (t === 'ban công') out.push('balcony')
    else if (t.startsWith('hồ bơi')) out.push('pool')
    else if (t === 'gym') out.push('gym')
    else if (t === 'nuôi thú cưng') out.push('pets')
  }
  return [...new Set(out)]
}

/** Rever's own furnishing bullet in the page's meta description ("• Nội thất cơ bản"). */
export function reverFurnishing(metaDescription: string): Furnishing | undefined {
  const d = fold(metaDescription)
  return furnishingOf(/nội thất cao cấp/.test(d), /(đầy đủ nội thất|nội thất đầy đủ|full nội thất)/.test(d), /(nhà trống|không nội thất)/.test(d))
}

/**
 * Nhà Tốt's "Tình trạng nội thất" value. ⚠️ ON A RENTAL IT OFTEN ARRIVES AS `furnishing_sell`, not
 * `furnishing_rent` (measured 2026-09-30) — the importer read only the latter, which is why half the
 * rows carry no furnishing. The caller passes whichever of the two is present.
 */
export function nhatotFurnishing(value: string | null | undefined): Furnishing | undefined {
  const t = fold(value ?? '')
  if (!t.trim()) return undefined
  if (/cao cấp/.test(t)) return 'premium'
  if (/đầy đủ/.test(t)) return 'fully'
  // "Hoàn thiện cơ bản" is basic FINISHING (walls, floors) with no furniture — unfurnished, unlike
  // "nội thất cơ bản" (basic furniture), which is deliberately left unclassified everywhere.
  if (/(hoàn thiện cơ bản|bàn giao thô|không nội thất|nhà trống)/.test(t)) return 'partly'
  return undefined
}

/**
 * ⛔ HONEYCOMB HAS NO PER-FLAT AMENITIES LIST. Its only checklist is "What's Nearby" — Gymnasium,
 * Pool, Coffee Shop — the NEIGHBOURHOOD, not the flat (checked 2026-09-30). Reading it would tag
 * apartments with a pool they do not have, so Honeycomb amenities come from its title slug only.
 */

/**
 * Merge evidence, earliest source first. A field is taken from the FIRST source that states it; a
 * later source never overrides it. Amenities are the union (a slug naming a balcony and a page
 * listing a pool describe the same flat).
 */
export function mergeFacts(...sources: AptFacts[]): AptFacts {
  const out: AptFacts = {}
  const am = new Set<Amenity>()
  for (const f of sources) {
    if (!out.aptType && f.aptType) out.aptType = f.aptType
    if (!out.furnishing && f.furnishing) out.furnishing = f.furnishing
    for (const a of f.amenities ?? []) am.add(a)
  }
  if (am.size) out.amenities = [...am].sort()
  return out
}
