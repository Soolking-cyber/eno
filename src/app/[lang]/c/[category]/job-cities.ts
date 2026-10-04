import vnUnits from '@/data/vn-units.json'
import { fold } from '@/lib/fold'

/**
 * /c/jobs "BY CITY" (rentals-11) — the jobs page's answer to rentals' "By area" chips.
 *
 * ⚠️ BY PROVINCE, FROM `Listing.city`, NOT BY DISTRICT: a job carries no district (the importer stores the
 * vn-units province name in `city` — src/lib/job-listing.ts PLACES — and the wizard stores the same
 * vocabulary), so the district chips /c/rentals draws are always empty here and a `/c/jobs/<district>`
 * hub can never resolve. The chip's target is the explorer's PROVINCE filter, the same `province=<nameEn>`
 * the Area panel sends (province-match.ts matches it against `city`), so the count on a chip is the
 * count that filter answers — give or take a multi-city posting, whose other cities ride in `location`.
 * ⚠️ SERVER-ONLY: vn-units.json carries every ward (~200 KB); the client gets the few chips, never the file.
 */

/** A province as the explorer's Area filter holds it (area-filter.tsx `Geo`). */
export type ProvinceGeo = { code: string; name: string; nameEn: string }
export type JobCity = { geo: ProvinceGeo; label: { en: string; vi: string }; count: number }

type Unit = { code: string; name: string; nameEn: string }
const UNITS: Unit[] = (vnUnits as Unit[]).map(({ code, name, nameEn }) => ({ code, name, nameEn }))
/** Diacritics, case and spacing folded: 'Khánh Hoà' and 'Khánh Hòa' are one place, 'Ha Noi' finds 'Hà Nội'. */
const placeKey = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()
const BY_KEY = new Map<string, Unit>(UNITS.flatMap((u) => [[placeKey(u.name), u], [placeKey(u.nameEn), u]] as [string, Unit][]))
/**
 * The English an expat reads: vn-units spells the two largest cities 'Ho Chi Minh' and 'Ha Noi' (the
 * filter's values, kept in `geo`); the chip says what a visitor would search for.
 */
const EN_LABEL: Record<string, string> = { '79': 'Ho Chi Minh City', '01': 'Hanoi' }

/** How many cities the row offers — the biggest first. A long tail of single postings is not a choice. */
export const JOB_CITY_CHIPS = 8

/**
 * Grouped `city` counts → one chip per province (every spelling of a place merged), largest first,
 * ties by name; a value that names no province is dropped rather than guessed. The row is worth drawing
 * only with two or more cities, which the caller checks.
 */
export function jobCityChips(groups: readonly { city: string | null; count: number }[], max = JOB_CITY_CHIPS): JobCity[] {
  const byCode = new Map<string, JobCity>()
  for (const g of groups) {
    if (!g.city || g.count <= 0) continue
    const u = BY_KEY.get(placeKey(g.city))
    if (!u) continue
    const hit = byCode.get(u.code)
    if (hit) { hit.count += g.count; continue }
    byCode.set(u.code, { geo: { code: u.code, name: u.name, nameEn: u.nameEn }, label: { en: EN_LABEL[u.code] ?? u.nameEn, vi: u.name }, count: g.count })
  }
  return [...byCode.values()]
    .sort((a, b) => b.count - a.count || a.geo.name.localeCompare(b.geo.name, 'vi'))
    .slice(0, max)
}
