import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { canonicalDistrictSlug } from './district-canonical'
import { HCMC_OLD_WARDS } from './hcmc-old-wards'

/**
 * THE HEADING EACH HCMC WARD SITS UNDER IN THE WARD PICKER (owner, 2026-10-29: "divide thu duc city into wards so we can
 * select specific area"). The 2025 reform left HCMC with 168 wards under the city, and the picker listed them as one flat
 * run in ward-code order — Thủ Đức's twelve scattered at positions 76–84 and 110–112, nothing saying they were Thủ Đức.
 *
 * A 2025 ward kept the CODE of one of the old wards it absorbed, so its code falls in exactly one old district's code
 * range (hcmc-old-wards.ts — the same ranges honeycomb-listing.ts `checkWard` reads). The heading is that old district,
 * named as the district chips name it (DISTRICTS): Thủ Đức, Quận 9 and Quận 2 are ONE heading, "Thu Duc City", as the
 * chips have it since the 2021 merger. A code below every HCMC range is a ward of a province merged in 2025: former
 * Bình Dương (25xxx — Thủ Dầu Một 25747 … Thuận An 25978) or former Bà Rịa–Vũng Tàu (Vũng Tàu 26506 … Côn Đảo 26732),
 * measured in vn-units.json 2026-10-30.
 * A heading only — the ward's own value, name and what it filters are unchanged.
 */
export type WardGroup = { vi: string; en: string; order: number }

const THU_DUC_PARTS = new Set(['Thủ Đức', 'Quận 9', 'Quận 2'])
const BR_VT_FROM = 26300

const curated = (slug: string) => DISTRICTS.find((d) => d.slug === slug)

export function hcmcWardGroup(code: string | number): WardGroup | null {
  const c = Number(code)
  if (!Number.isInteger(c)) return null
  const at = HCMC_OLD_WARDS.findIndex(([, lo, hi]) => c >= lo && c <= hi)
  if (at >= 0) {
    const old = HCMC_OLD_WARDS[at][0]
    const slug = THU_DUC_PARTS.has(old) ? 'thu-duc' : canonicalDistrictSlug(old)
    const d = curated(slug)
    // Ordered by the FIRST old district of the heading, so Thủ Đức City sits where old Thủ Đức did (after Quận 12).
    const order = THU_DUC_PARTS.has(old) ? HCMC_OLD_WARDS.findIndex(([n]) => THU_DUC_PARTS.has(n)) : at
    return d ? { vi: d.name, en: d.nameEn, order } : { vi: old, en: old, order }
  }
  if (c < 26734) {
    return c < BR_VT_FROM
      ? { vi: 'Bình Dương (cũ)', en: 'Former Binh Duong', order: HCMC_OLD_WARDS.length }
      : { vi: 'Bà Rịa – Vũng Tàu (cũ)', en: 'Former Ba Ria–Vung Tau', order: HCMC_OLD_WARDS.length + 1 }
  }
  return null
}

/** HCMC's wards with their heading, grouped (headings in order, wards in code order within each). Other provinces: as given. */
export function groupHcmcWards<W extends { code: string }>(provinceCode: string | null, wards: W[]): (W & { group?: string; groupEn?: string })[] {
  if (provinceCode !== '79') return wards
  const withGroup = wards.map((w, i) => ({ w, i, g: hcmcWardGroup(w.code) }))
  withGroup.sort((a, b) => (a.g?.order ?? 999) - (b.g?.order ?? 999) || a.i - b.i)
  return withGroup.map(({ w, g }) => (g ? { ...w, group: g.vi, groupEn: g.en } : w))
}
