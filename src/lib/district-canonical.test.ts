import { describe, expect, it } from 'vitest'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { districtTextMatches, longerDistrictSpellings } from '@/lib/district-match'
import { slugify } from '@/lib/slug'
import { canonicalDistrictSlug, districtLabel, districtLinkSlug, isCuratedDistrict, mergeDistrictGroups } from './district-canonical'

/**
 * ⛔ ONE PLACE, ONE URL. Every twin below was a live, indexable, self-canonical page on 2026-09-27
 * (chips on https://eno.vn/c/rentals), and the soft-404 slugs answered 200 + noindex.
 *
 * The rental counts are what `/api/listings?category=rentals&district=<slug>` returned that day for
 * the SOURCE slug; the target counts are that call's `facets.area` for the curated key. They are here
 * as the evidence for each redirect (a target must hold at least what its source held), not as
 * fixtures the code reads.
 */
const LIVE_TWINS: [stored: string, source: string, target: string, sourceRentals: number, targetRentals: number][] = [
  ['Quận 1', 'quan-1', 'd1', 1627, 1627],
  ['Quận 2', 'quan-2', 'd2', 3741, 3741],
  ['Quận 3', 'quan-3', 'd3', 1179, 1179],
  ['Quận 4', 'quan-4', 'd4', 511, 511],
  ['Quận 5', 'quan-5', 'd5', 276, 276],
  ['Quận 6', 'quan-6', 'd6', 441, 441],
  ['Quận 7', 'quan-7', 'd7', 2655, 2655],
  ['Quận 8', 'quan-8', 'd8', 535, 535],
  ['Quận 9', 'quan-9', 'd9', 1118, 1118],
  ['Quận 10', 'quan-10', 'd10', 910, 910],
  ['Quận 11', 'quan-11', 'd11', 206, 206],
  ['Quận 12', 'quan-12', 'd12', 847, 847],
  ['Quận Bình Chánh', 'quan-binh-chanh', 'binh-chanh', 433, 528],
  ['Huyện Bình Chánh', 'huyen-binh-chanh', 'binh-chanh', 78, 528],
  ['Quận Bình Tân', 'quan-binh-tan', 'binh-tan', 805, 805],
  ['Quận Bình Thạnh', 'quan-binh-thanh', 'binh-thanh', 2476, 2476],
  ['Quận Cần Giờ', 'quan-can-gio', 'can-gio', 1, 1],
  ['Quận Củ Chi', 'quan-cu-chi', 'cu-chi', 84, 90],
  ['Huyện Củ Chi', 'huyen-cu-chi', 'cu-chi', 6, 90],
  ['Quận Gò Vấp', 'quan-go-vap', 'go-vap', 1483, 1483],
  ['Quận Hóc Môn', 'quan-hoc-mon', 'hoc-mon', 87, 161],
  ['Huyện Hóc Môn', 'huyen-hoc-mon', 'hoc-mon', 74, 161],
  ['Quận Nhà Bè', 'quan-nha-be', 'nha-be', 393, 498],
  ['Huyện Nhà Bè', 'huyen-nha-be', 'nha-be', 105, 498],
  ['Quận Phú Nhuận', 'quan-phu-nhuan', 'phu-nhuan', 1219, 1219],
  ['Quận Tân Bình', 'quan-tan-binh', 'tan-binh', 1893, 1893],
  ['Quận Tân Phú', 'quan-tan-phu', 'tan-phu', 1155, 1175],
  ['TP. Thủ Đức', 'tp-thu-duc', 'thu-duc', 1164, 6023],
]

/** The slugs that answered 200 + "Page not found" (soft 404) and have a real place to go to. */
const SOFT_404_REDIRECTS: [spelling: string, source: string, target: string, targetRentals: number][] = [
  // Thảo Điền is a ward of the former District 2, and `d2` owns it (SEO wave B, D0; decision D-d).
  // It used to go to the umbrella, because only `thu-duc` listed the spelling and `d2` would have
  // dropped the ~20% of those listings stored under "TP. Thủ Đức" (100-row text-search sample: 80
  // Quận 2, 20 TP. Thủ Đức). `d2` now carries both spellings itself, so a row stored as Thảo Điền —
  // whatever its district column says — is inside `d2`'s scope, and the 308 stays lossless. The
  // umbrella still lists them too, so the same rows stay on /thu-duc. Count: /api/listings on the
  // D0 build, reading production (2026-09-30) — 16 more than the live `d2` (3,746), every one a
  // car-rental row whose address names Thảo Điền; its places (kind=places) stayed at 3,741.
  ['Thảo Điền', 'thao-dien', 'd2', 3762],
  ['Phú Mỹ Hưng', 'phu-my-hung', 'd7', 2655],
  ['District 2', 'district-2', 'd2', 3741],
  ['Thành phố Thủ Đức', 'thanh-pho-thu-duc', 'thu-duc', 6023],
]

/** The feed's curated scope for one row, mirrored exactly as facet-counts.ts `districtSlugsFor` does. */
function inCuratedScope(row: { district?: string | null; location?: string | null }, slug: string): boolean {
  const d = DISTRICTS.find((x) => x.slug === slug)
  if (!d?.match?.length) return false
  const hay = [row.district ?? '', row.location ?? '']
  if (!d.match.some((m) => hay.some((h) => districtTextMatches(h, m)))) return false
  return !longerDistrictSpellings(slug).some((l) => (row.district ?? '').includes(l))
}

describe('canonicalDistrictSlug — the live twins', () => {
  it.each(LIVE_TWINS)('%s (/%s) → /%s', (stored, source, target, sourceRentals, targetRentals) => {
    expect(slugify(stored)).toBe(source)
    expect(canonicalDistrictSlug(source)).toBe(target)
    expect(districtLinkSlug(stored)).toBe(target)
    // ⛔ LOSSLESS: a row stored under the source spelling is inside the target's scope, so the 308
    // can never show a renter fewer of the listings the old URL showed.
    expect(inCuratedScope({ district: stored }, target)).toBe(true)
    expect(targetRentals).toBeGreaterThanOrEqual(sourceRentals)
  })

  it('merges every rental twin into one of the 24 curated places — the chip row has no duplicates left', () => {
    const targets = new Set(LIVE_TWINS.map(([, , t]) => t))
    expect(targets.size).toBe(24)
    for (const t of targets) expect(isCuratedDistrict(t)).toBe(true)
  })
})

describe('canonicalDistrictSlug — the soft 404s that have a real place', () => {
  it.each(SOFT_404_REDIRECTS)('%s (/%s) → /%s', (spelling, source, target, targetRentals) => {
    expect(canonicalDistrictSlug(source)).toBe(target)
    expect(inCuratedScope({ location: spelling }, target)).toBe(true)
    expect(targetRentals).toBeGreaterThan(0)
  })

  it('leaves a place outside HCMC alone — /tay-ho stays /tay-ho and 404s on its own emptiness', () => {
    expect(canonicalDistrictSlug('tay-ho')).toBe('tay-ho')
    expect(canonicalDistrictSlug('cau-giay')).toBe('cau-giay')
  })
})

describe('canonicalDistrictSlug — the rules', () => {
  it('keeps every curated key as itself', () => {
    for (const d of DISTRICTS) {
      if (d.slug === 'all') continue
      expect(canonicalDistrictSlug(d.slug)).toBe(d.slug)
    }
  })

  it('does not turn `all` (no scope) into a place', () => {
    expect(canonicalDistrictSlug('all')).toBe('all')
    expect(isCuratedDistrict('all')).toBe(false)
  })

  it('normalises case and stray characters to the one slug', () => {
    expect(canonicalDistrictSlug('D2')).toBe('d2')
    expect(canonicalDistrictSlug('Quận-2')).toBe('d2')
    expect(canonicalDistrictSlug('Cau-Giay')).toBe('cau-giay')
    expect(canonicalDistrictSlug('binh-trung')).toBe('binh-trung')
  })

  /**
   * ⚠️ `huyen-` ONLY FOR HCMC'S FIVE RURAL DISTRICTS. "Huyện Tân Phú" is in Đồng Nai and "Huyện Bình
   * Tân" in Vĩnh Long; 308-ing either to the HCMC urban district of the same name would send a real
   * place in another province to the wrong city.
   */
  it('does not alias a huyện prefix onto an urban HCMC district', () => {
    expect(canonicalDistrictSlug('huyen-tan-phu')).toBe('huyen-tan-phu')
    expect(canonicalDistrictSlug('huyen-binh-tan')).toBe('huyen-binh-tan')
    expect(canonicalDistrictSlug('huyen-cu-chi')).toBe('cu-chi')
  })

  it('never builds a prefix onto a numbered spelling', () => {
    expect(canonicalDistrictSlug('quan-district-1')).toBe('quan-district-1')
  })

  /**
   * ⚠️ A SHARED ALIAS GOES TO THE NARROWER PLACE, AND "NARROWER" MUST BE REAL. "Quận 2" is a spelling
   * of both `d2` and the Thủ Đức umbrella; the chosen entry's spellings must be a subset of every
   * rival's, otherwise "fewest spellings wins" would be an arbitrary tie-break between two places.
   */
  it('resolves every alias two places share to the one whose spellings the other contains', () => {
    const places = DISTRICTS.filter((d) => d.slug !== 'all' && d.match?.length)
    const owners = new Map<string, string[]>()
    for (const d of places) {
      for (const m of d.match!) {
        const a = slugify(m)
        owners.set(a, [...(owners.get(a) ?? []), d.slug])
      }
    }
    const shared = [...owners].filter(([, o]) => new Set(o).size > 1)
    expect(shared.length).toBeGreaterThan(0) // quan-2, district-2, quan-9, district-9
    for (const [alias, o] of shared) {
      const chosen = places.find((d) => d.slug === canonicalDistrictSlug(alias))!
      for (const rival of new Set(o)) {
        const r = places.find((d) => d.slug === rival)!
        for (const m of chosen.match!) expect(r.match).toContain(m)
      }
    }
  })
})

describe('districtLabel — English names on English pages', () => {
  it('uses the curated names', () => {
    expect(districtLabel('d2')).toEqual({ en: 'District 2 (Thu Duc)', vi: 'Quận 2 (Thủ Đức)' })
    expect(districtLabel('binh-thanh')).toEqual({ en: 'Binh Thanh District', vi: 'Bình Thạnh' })
  })

  it('unaccents a non-curated stored name for English and keeps it for Vietnamese', () => {
    expect(districtLabel('binh-trung', 'Bình Trưng')).toEqual({ en: 'Binh Trung', vi: 'Bình Trưng' })
    expect(districtLabel('cau-giay', 'Cầu Giấy')).toEqual({ en: 'Cau Giay', vi: 'Cầu Giấy' })
    expect(districtLabel('dak-lak', 'Đắk Lắk').en).toBe('Dak Lak')
  })
})

describe('mergeDistrictGroups — the chip row', () => {
  it('merges twins, sums their tallies and orders busiest first', () => {
    const chips = mergeDistrictGroups([
      { district: 'Quận Củ Chi', count: 84 },
      { district: 'Quận 2', count: 3741 },
      { district: 'Huyện Củ Chi', count: 6 },
      { district: 'Bình Trưng', count: 3 },
      { district: 'Binh Trung', count: 9 },
      { district: null, count: 500 },
      { district: '  ', count: 7 },
      { district: '—', count: 2 },
    ])
    expect(chips.map((c) => [c.slug, c.count])).toEqual([
      ['d2', 3741],
      ['cu-chi', 90],
      ['binh-trung', 12],
    ])
    expect(chips[0].label.en).toBe('District 2 (Thu Duc)')
    // The busiest stored spelling names a non-curated place.
    expect(chips[2].label).toEqual({ en: 'Binh Trung', vi: 'Binh Trung' })
  })
})
