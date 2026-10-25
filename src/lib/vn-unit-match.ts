/**
 * Matching a place NAME to a vn-units entry (province or ward) — diacritic-, case- and prefix-insensitive. Shared by the
 * client pickers (area-filter.tsx re-exports findUnit) and the server (the listing edit page resolves a stored city and
 * district to real codes, so the picker opens on them — sweep, 2026-10-22). No 'use client': a server component cannot
 * call a function exported from a client module.
 */
export type NamedUnit = { code: string; name: string; nameEn: string }

export function normUnitName(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\b(tinh|thanh pho|tp|quan|huyen|phuong|xa|thi tran|thi xa)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The unit a name names. The literal Vietnamese name first (case-insensitive, diacritics kept — "Thạnh An" and
 * "Thanh An" are two HCMC wards); then normalised; then the same with spaces ignored — "Saigon" is the ward "Sài Gòn", which the English
 * geocoder spells as one word; then, unless `exact`, the loose containment the reverse geocoder's candidates need.
 * `exact` is for a STORED name, where a near miss would move a listing to a different place: it also refuses a
 * normalised match that names more than one unit (10 such pairs in vn-units, all diacritic-only).
 */
const lit = (s: string) => (s || '').normalize('NFC').trim().toLowerCase()
// The Vietnamese name only: it is unique within every province's wards (measured), while nameEn drops the diacritics, so
// "Thanh An" is the nameEn of both HCMC's Thanh An and Thạnh An. nameEn is matched by the normalised passes.
const findLiteral = <U extends NamedUnit>(list: U[], raw: string): U | undefined => {
  const l = lit(raw)
  return l ? list.find((u) => lit(u.name) === l) : undefined
}

export function findUnit<U extends NamedUnit>(list: U[], raw: string, opts: { exact?: boolean } = {}): U | undefined {
  if (!lit(raw)) return undefined
  const literal = findLiteral(list, raw)
  if (literal) return literal
  const n = normUnitName(raw)
  if (!n) return undefined
  const squash = (s: string) => s.replace(/ /g, '')
  const ns = squash(n)
  const normal = (u: U) => normUnitName(u.name) === n || normUnitName(u.nameEn) === n
  const squashed = (u: U) => squash(normUnitName(u.name)) === ns || squash(normUnitName(u.nameEn)) === ns
  if (opts.exact) {
    const hits = list.filter((u) => normal(u) || squashed(u))
    return hits.length === 1 ? hits[0] : undefined
  }
  return list.find(normal) || list.find(squashed) ||
    list.find((u) => { const un = normUnitName(u.name); return un.includes(n) || n.includes(un) })
}

/**
 * A stored listing's city and district as picker units (real codes), for the edit screen. Without codes the area picker
 * opened on Ho Chi Minh City with no ward, and an untouched Apply moved the listing there (sweep, 2026-10-22). Exact
 * matches only; a name that matches nothing, or names a district (pre-2025, "Quận 12"), comes back null, and the wizard
 * keeps that name with an empty code as before.
 */
export function resolveStoredArea(
  provinces: (NamedUnit & { wards?: NamedUnit[] })[], city: string | null | undefined, district: string | null | undefined,
): { province: NamedUnit | null; ward: NamedUnit | null } {
  const p = city ? findUnit(provinces, city, { exact: true }) : undefined
  // ⚠️ A DISTRICT IS NOT A WARD: "Quận Cầu Giấy" (pre-2025) normalises to the new ward "Cầu Giấy", a smaller place the
  // seller never chose. A stored name that reads as a pre-2025 unit (Quận / Huyện / Thị xã / Thị trấn / Thành phố / District / Q.1)
  // matches a ward only by its literal name — "Quan Triều" is a real ward of Thái Nguyên.
  const districtLevel = /^(quan|huyen|thi xa|thi tran|thanh pho|tp|district|q\.?\s*\d)\b/.test(
    (district || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim(),
  )
  const wards = p?.wards ?? []
  const w = !p || !district ? undefined : districtLevel ? findLiteral(wards, district) : findUnit(wards, district, { exact: true })
  const unit = (u: NamedUnit | undefined) => (u ? { code: u.code, name: u.name, nameEn: u.nameEn } : null)
  return { province: unit(p), ward: unit(w) }
}
