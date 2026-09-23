import type { Prisma } from '@/generated/prisma/client'
import vnUnits from '@/data/vn-units.json'
import { PROVINCES } from '@/components/marketplace/listings-explorer.constants'
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

export function wardWhere(sentWard: string, sentProvince?: string | null): Prisma.ListingWhereInput {
  const w = sentWard.trim()
  return {
    OR: [w, ...wardAliases(w, sentProvince)].flatMap((s) => [{ district: { contains: s } }, { location: { contains: s } }]),
  }
}
