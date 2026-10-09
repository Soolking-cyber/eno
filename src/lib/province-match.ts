import type { Prisma } from '@/generated/prisma/client'
import vnUnits from '@/data/vn-units.json'
import { DISTRICTS, PROVINCES } from '@/components/marketplace/listings-explorer.constants'
import { slugify } from '@/lib/slug'

/**
 * WHAT THE PROVINCE FILTER MATCHES — `?province=` on /api/listings, one definition for the feed
 * (feed-query.ts) and the facet counter (facet-counts.ts `matchesProvince`).
 *
 * ⛔ THE FILTER SENDS THE ENGLISH NAME AND THE SITE STORES THE VIETNAMESE ONE. The area filter
 * (area-filter.tsx → listings-explorer.tsx) sends `province=<vn-units nameEn>`: 'Ho Chi Minh',
 * 'Ha Noi', 'Da Nang'. The post wizard stores `city = <vn-units name>`: 'Hồ Chí Minh', 'Hà Nội',
 * 'Đà Nẵng' — and so do the Batdongsan and Rever imports ('Hồ Chí Minh', ~98,000 live rows). The
 * predicate was a case- and accent-sensitive `contains` of the sent string alone, so picking
 * "Ho Chi Minh" in the area filter matched rows whose city happened to be English ('Ho Chi Minh
 * City', the partner-API default) and hid every HCMC listing a person posted through the wizard.
 * The same held for Hà Nội and Đà Nẵng, and it is what made the 2026-09 importers' city strings
 * look wrong: there was no single string that both the filter and the existing data used.
 *
 * ⚠️ THE EXTRA SPELLINGS ARE MATCHED AGAINST `city` ONLY — never against `location`. Location is free
 * text that carries street names, and HCMC has a major road called "Xa lộ Hà Nội": matching the
 * Vietnamese name there would put Thủ Đức flats in the Hà Nội filter. The sent string keeps its old
 * `city OR location` match unchanged, so nothing that matched before stops matching.
 */

type Ward = { code: string; name: string; nameEn: string }
type Unit = { code: string; name: string; nameEn: string; wards: Ward[] }
const UNITS: Unit[] = (vnUnits as Unit[]).map(({ code, name, nameEn, wards }) => ({ code, name, nameEn, wards: wards ?? [] }))

/**
 * Every province's `nameEn` — the exact `?province=` value the Area panel sends
 * (listings-explorer: `params.set('province', activeProvince.nameEn)`) for each of the 34 units
 * /api/geo lists. The feed route counts all of them so the panel can drop the empty ones.
 */
export const PROVINCE_NAMES_EN: string[] = UNITS.map((u) => u.nameEn)

/**
 * The province a sent value names, by its vn-units Vietnamese or English name OR by the explorer's
 * legacy PROVINCES label ('Hanoi', 'Ho Chi Minh City') — an older saved search or shared link can
 * still carry one of those, and it must resolve to the same place.
 */
function unitFor(sent: string): Unit | undefined {
  const direct = UNITS.find((u) => u.nameEn === sent || u.name === sent)
  if (direct) return direct
  const legacy = PROVINCES.find((x) => x.name === sent || x.nameEn === sent)
  return legacy ? UNITS.find((u) => slugify(u.nameEn) === legacy.slug) : undefined
}

// Memoized: the in-memory facet counter asks once per group row, and the answer depends only on
// the sent string. Only values that RESOLVE to a province are kept — `province` is a raw query
// param, and caching misses would let junk values fill the table ahead of the real names.
const aliasCache = new Map<string, string[]>()

/**
 * The OTHER spellings a stored `Listing.city` may use for the province the filter sent: the
 * vn-units Vietnamese and English names, plus the explorer's legacy PROVINCES labels for the same
 * place ('Hanoi', 'Ho Chi Minh City'). Empty for a value that is not a province name, which leaves
 * the predicate exactly as it was.
 */
export function provinceCityAliases(sent: string): string[] {
  const p = sent.trim()
  if (!p) return []
  const hit = aliasCache.get(p)
  if (hit) return hit
  const unit = unitFor(p)
  let out: string[] = []
  if (unit) {
    const legacy = PROVINCES.find((x) => x.slug === slugify(unit.nameEn))
    const all = [unit.name, unit.nameEn, legacy?.name, legacy?.nameEn].filter((s): s is string => !!s)
    out = [...new Set(all)].filter((s) => s !== p)
  }
  if (unit && aliasCache.size < 256) aliasCache.set(p, out)
  return out
}

export function provinceWhere(sent: string): Prisma.ListingWhereInput {
  const p = sent.trim()
  return {
    OR: [
      { city: { contains: p } },
      { location: { contains: p } },
      ...provinceCityAliases(p).map((a) => ({ city: { contains: a } })),
    ],
  }
}

/** `provinceWhere` evaluated over one row — for the in-memory facet counter. */
export function matchesProvinceRow(row: { city?: string | null; location?: string | null }, sent: string): boolean {
  const p = sent.trim() // provinceWhere trims; the mirror must match the same string
  const city = row.city ?? ''
  if (city.includes(p) || (row.location ?? '').includes(p)) return true
  return provinceCityAliases(p).some((a) => city.includes(a))
}

/**
 * ⛔ THE WARD FILTER HAS THE SAME SPLIT. The area filter sends the ward's vn-units `nameEn`
 * ('Long Phuoc'); stored rows carry the Vietnamese name in `district`/`location`
 * ('TP. Thủ Đức (P. Long Phước mới)'). The sent string alone matched almost nothing.
 *
 * The ward is looked up among the wards of the SELECTED province only — ward names repeat across
 * provinces (373 of 2,745 English names do), so with no province sent there is no alias at all and
 * the predicate stays as it was (the explorer always sends the two together). Within a province, ten
 * provinces have two wards sharing an English name (HCMC: Thạnh An / Thanh An): both Vietnamese
 * spellings are matched, since the English value cannot say which was meant. The other spelling is
 * matched over `district` OR `location`, like the sent string: it has to reach `location`, because
 * that is where imported rows carry the ward. The province clause is AND-ed beside it, so a street
 * sharing a ward's name can only surface rows inside the chosen province.
 */
export function wardAliases(sentWard: string, sentProvince?: string | null): string[] {
  const w = sentWard.trim()
  const p = sentProvince?.trim()
  if (!w || !p) return []
  const hits = unitFor(p)?.wards.filter((x) => x.nameEn === w || x.name === w) ?? []
  return [...new Set(hits.flatMap((x) => [x.name, x.nameEn]))].filter((s) => s !== w)
}

/**
 * ⛔ A WARD MATCHES AS A SUBSTRING — EXCEPT INSIDE A LONGER PLACE NAME THE APP KNOWS (2026-10-09). The bare `contains`
 * put every row naming a longer place that contains the ward's name into that ward: HCMC's Phú Mỹ ward returned every
 * "Phú Mỹ Hưng" row (each District 7 teacher — "Quận 7 (Phú Mỹ Hưng)" — and every Phú Mỹ Hưng rental), An Phú returned
 * An Phú Đông, Vĩnh Lộc returned Tân Vĩnh Lộc. A first fix demanded a closed list of words around the name and LOST real
 * rows ("thị xã Phú Mỹ", "KDC Phú Mỹ", "Phú Mỹ Q7" — commit gate, Opus): free text has no closed neighbourhood. So
 * recall stays the substring's, and only the collisions the app KNOWS are taken out — every other ward name (vn-units:
 * the province's, or every province's when none was sent) and every curated place name (DISTRICTS names and `match`
 * spellings) that contains a spelling of the ward.
 * ⚠️ A COLUMN naming the ward AND such a longer place does not count ("P. An Phú, gần An Phú Đông") — rare, and the price
 * of a rule that never guesses at free text; the row's other column still can.
 */
const CURATED_PLACE_NAMES: readonly string[] = [...new Set(DISTRICTS.flatMap((d) => [d.name, d.nameEn, ...(d.match ?? [])]))]

/**
 * The known place names that CONTAIN one of these spellings and are longer — the collisions wardWhere takes out: the
 * curated names and the OTHER wards of the sent province. ⛔ BOUNDED (commit gate, 2026-10-09 — Opus): only for a
 * province that resolves; with none, every ward of the country containing a one-letter `?ward=a` became a NOT LIKE —
 * thousands of clauses from a public parameter. No province → no exclusions (wardWhere keeps the bare substring).
 */
export function longerPlaceNames(spellings: string[], sentProvince?: string | null): string[] {
  const p = sentProvince?.trim()
  const unit = p ? unitFor(p) : undefined
  if (!unit) return []
  const known = [...CURATED_PLACE_NAMES, ...unit.wards.flatMap((x) => [x.name, x.nameEn])]
  const folded = spellings.map((s) => s.toLowerCase())
  return [...new Set(known)].filter((n) => {
    const f = n.toLowerCase()
    return folded.some((s) => s && f.length > s.length && f.includes(s))
  })
}

export function wardWhere(sentWard: string, sentProvince?: string | null): Prisma.ListingWhereInput {
  const w = sentWard.trim()
  const aliases = wardAliases(w, sentProvince)
  const spellings = [w, ...aliases]
  const bare: Prisma.ListingWhereInput = { OR: spellings.flatMap((s) => [{ district: { contains: s } }, { location: { contains: s } }]) }
  // ⛔ EXCLUSIONS ONLY FOR A REAL WARD OF THE SENT PROVINCE (the Area panel always sends both): a free-typed or unknown
  // value keeps the original two LIKEs — the cost of a public parameter stays the old one.
  const p = sentProvince?.trim()
  const known = !!p && !!unitFor(p)?.wards.some((x) => x.name === w || x.nameEn === w)
  const longer = known ? longerPlaceNames(spellings, sentProvince) : []
  if (!longer.length) return bare
  // ⛔ PER COLUMN: a column counts when it names the ward and NONE of the longer places — so district "Quận 7 (Phú Mỹ
  // Hưng)" beside location "P. Phú Mỹ, Quận 7" (a District 7 home that IS in Phú Mỹ ward) still finds it through the
  // location. ⛔ NULL-SAFE BY CONSTRUCTION: the column already contains the spelling, so it is not NULL — a NOT LIKE on a
  // NULL column is NULL, which would have dropped every row with no district.
  const clean = (c: 'district' | 'location', s: string): Prisma.ListingWhereInput => ({
    AND: [c === 'district' ? { district: { contains: s } } : { location: { contains: s } },
      ...longer.map((n): Prisma.ListingWhereInput => ({ NOT: c === 'district' ? { district: { contains: n } } : { location: { contains: n } } }))],
  })
  return { OR: spellings.flatMap((s) => [clean('district', s), clean('location', s)]) }
}
