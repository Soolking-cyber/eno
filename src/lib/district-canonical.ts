import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { slugify } from '@/lib/slug'

/**
 * ONE URL PER PLACE — the slug `/c/<category>/<district>` must use for a district, whatever spelling
 * reached it. Pure (no database), so the category page, the district page, a test and any future
 * caller (the sitemap) share one answer.
 *
 * ⛔ THE SAME PLACE HAD TWO OR THREE LIVE URLS, ALL INDEXABLE AND SELF-CANONICAL. A chip is
 * `slugify(listing.district)` — the importers' free text — so `/c/rentals/quan-2` (stored "Quận 2")
 * and `/c/rentals/d2` (the curated DISTRICTS key the explorer uses) both answered 200 with the same
 * 3,741 listings, and "Huyện Củ Chi" / "Quận Củ Chi" split one district into two pages (6 and 84).
 * Measured on the live site 2026-09-27; every twin is listed in district-canonical.test.ts.
 *
 * ⚠️ THE CURATED KEY WINS because it is the scope the feed already applies (districtScopeForSlug):
 * a DISTRICTS entry matches every one of its spellings on `district` OR `location`, so its page is a
 * SUPERSET of any single stored spelling's page. That is what makes a 308 to it lossless — the
 * redirect can only ever show more of the same place, never fewer (pinned per alias in the test).
 *
 * ⚠️ ALIASES ARE DERIVED FROM DISTRICTS, NEVER TYPED OUT, except the two administrative prefixes
 * below, which are facts about HCMC rather than data: a stored name is the curated spelling with
 * "Quận"/"Huyện"/"TP." in front of it.
 *
 * ⚠️ NOT USED BY /api/listings. `?district=quan-2` keeps resolving through the stored names exactly
 * as before (district-slug.ts) — saved searches and shared links carry those values, and changing
 * what they match is a different decision from choosing which URL a page lives at.
 */

type Curated = (typeof DISTRICTS)[number]

/**
 * HCMC's five RURAL districts (huyện). Only these may be reached through a `huyen-` prefix: a
 * "Huyện Tân Phú" is in Đồng Nai and a "Huyện Bình Tân" in Vĩnh Long, and neither is the HCMC urban
 * district of the same name, so aliasing every curated name under `huyen-` would 308 a real place in
 * another province to the wrong city. `quan-` is NOT restricted the same way, because the importers
 * write "Quận Củ Chi", "Quận Bình Chánh", "Quận Nhà Bè" for these rural five (measured: 84, 433 and
 * 393 live rentals) — the wrong prefix is in the data and has to resolve.
 */
const HCMC_RURAL = new Set(['binh-chanh', 'can-gio', 'cu-chi', 'hoc-mon', 'nha-be'])
/** "TP. Thủ Đức" / "Thành phố Thủ Đức" — the one city-level entry. */
const CITY_LEVEL = new Set(['thu-duc'])

const PLACES = DISTRICTS.filter((d) => d.slug !== 'all' && d.match?.length)

function aliasesOf(d: Curated): Set<string> {
  const out = new Set<string>()
  for (const s of [...(d.match ?? []), d.name, d.nameEn]) {
    const slug = slugify(s)
    if (slug) out.add(slug)
  }
  for (const m of d.match ?? []) {
    const s = slugify(m)
    // A numbered spelling already carries its prefix ("quan-1", "district-1") — never "quan-district-1".
    if (!s || /\d$/.test(s)) continue
    out.add(`quan-${s}`)
    if (HCMC_RURAL.has(d.slug)) out.add(`huyen-${s}`)
    if (CITY_LEVEL.has(d.slug)) {
      out.add(`tp-${s}`)
      out.add(`thanh-pho-${s}`)
    }
  }
  return out
}

/**
 * alias → curated slug.
 *
 * ⚠️ AN ALIAS TWO ENTRIES SHARE GOES TO THE NARROWER ONE. "Quận 2" is a spelling of both `d2` and the
 * `thu-duc` umbrella (HCMC merged D2 and D9 into Thủ Đức in 2021 and the umbrella keeps matching the
 * old names — see DISTRICTS). Someone who typed District 2 meant District 2, and `d2`'s two spellings
 * are a subset of `thu-duc`'s eight, so the smaller match list wins. The test asserts that every
 * shared alias resolves to an entry whose spellings are contained in each rival's.
 */
const ALIAS_TO_CURATED: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, Curated>()
  for (const d of PLACES) {
    for (const a of aliasesOf(d)) {
      const prev = map.get(a)
      if (!prev || (d.match?.length ?? 0) < (prev.match?.length ?? 0)) map.set(a, d)
    }
  }
  // A curated key always names itself, whatever alias sets happen to contain it.
  for (const d of PLACES) map.set(d.slug, d)
  return new Map([...map].map(([a, d]) => [a, d.slug]))
})()

/**
 * The one URL slug for a district slug as it arrived — a curated key, a slugified stored name, or a
 * spelling in any case. Returns the curated key when the input names a curated place, otherwise the
 * input normalised through `slugify` (so `/c/rentals/Cau-Giay` and `/c/rentals/cau-giay` are one URL).
 *
 * ⚠️ THE RESULT IS A URL, NOT A PROMISE THAT THE PAGE HAS LISTINGS. The page still counts the
 * scope and answers a real 404 when it is empty — including when the target is empty in THAT
 * category (`/c/electronics/thao-dien` must not 308 to an empty `/c/electronics/thu-duc`).
 */
export function canonicalDistrictSlug(slug: string): string {
  const s = slugify(slug)
  return ALIAS_TO_CURATED.get(s) ?? s
}

/** The canonical URL slug for a stored `Listing.district` value — what a chip must link. */
export function districtLinkSlug(storedName: string): string {
  return canonicalDistrictSlug(storedName)
}

/** Is this slug a curated HCMC place (a DISTRICTS key other than `all`)? */
export function isCuratedDistrict(slug: string): boolean {
  return PLACES.some((d) => d.slug === slug)
}

/** "Bình Trưng" → "Binh Trung": the form English-language pages use for a Vietnamese place name. */
export function unaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
}

/**
 * A district's display name in both page languages.
 *
 * ⛔ ENGLISH PAGES SAID "Rentals in Quận 2". The label was the importer's stored Vietnamese string,
 * so the English title, H1 and breadcrumb all read in Vietnamese while English-speaking renters
 * search "District 2". A curated place now uses its DISTRICTS names (`nameEn` / `name`); anything
 * else keeps its stored name in Vietnamese and drops the diacritics in English, which is how the
 * curated English names themselves are written ("Binh Thanh District").
 */
export function districtLabel(slug: string, storedName?: string | null): { en: string; vi: string } {
  const d = PLACES.find((x) => x.slug === slug)
  if (d) return { en: d.nameEn, vi: d.name }
  const vi = storedName?.trim() || slug.replace(/-/g, ' ')
  return { en: unaccent(vi), vi }
}

export type DistrictChip = { slug: string; label: { en: string; vi: string }; count: number }

/**
 * `groupBy(['district'])` rows → one chip per canonical place, busiest first.
 *
 * ⚠️ MERGED BY CANONICAL SLUG, which is what removes the twin chips: "Quận Củ Chi" (84) and
 * "Huyện Củ Chi" (6) are one `cu-chi` chip, and its count is the sum. The count ORDERS the chips and
 * gates them at the indexing floor (src/lib/index-floor.ts, SEO wave B I1) — it is the stored-name
 * tally, not the page's scope (which also matches `location`), so it is never printed. A non-curated
 * place is labelled from its busiest stored spelling.
 */
export function mergeDistrictGroups(groups: readonly { district: string | null; count: number }[]): DistrictChip[] {
  const bySlug = new Map<string, { count: number; top: string; topCount: number }>()
  for (const g of groups) {
    const name = g.district?.trim()
    if (!name) continue
    const slug = districtLinkSlug(name)
    if (!slug) continue // a name of punctuation only slugifies to '' — `/c/<cat>/` is not a page
    const cur = bySlug.get(slug)
    if (!cur) bySlug.set(slug, { count: g.count, top: name, topCount: g.count })
    else {
      cur.count += g.count
      if (g.count > cur.topCount) {
        cur.top = name
        cur.topCount = g.count
      }
    }
  }
  return [...bySlug]
    .map(([slug, v]) => ({ slug, label: districtLabel(slug, v.top), count: v.count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
}
