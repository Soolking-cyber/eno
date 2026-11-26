import vnUnits from '@/data/vn-units.json'
import { HCMC_OLD_WARDS } from './hcmc-old-wards'
import { slugify } from './slug'

/**
 * ⛔ THE WARDS A DISTRICT PAGE'S LISTINGS SIT IN, FOR ITS LEDE (Seobility crawl 11, 2026-11-26). Seobility's "duplicate
 * content" ignores numbers and the grid's link text, so /c/rentals/d12 and /c/rentals/d8 — whose paragraphs differed only
 * in "District 12" / "District 8" and the counts — were one page to it, and so were Tân Bình and Bình Tân (the same two
 * words). The wards are the page's own words: read from the stored `location` ("Quận 12 (Phường An Phú Đông)", or an
 * import's "Thao Dien Ward, Thu Duc"), counted over the page's whole scope, in the official list's spelling in both
 * languages (place names are never translated — a numbered ward becomes "Ward 7" / "Phường 7").
 */
export type WardName = { en: string; vi: string }

const VI_WARD = /Phường\s+([^,()]+)/u
// Case-sensitive: a seller's "near the ward office" is no ward (commit gate 2026-11-26).
const EN_WARD = /([^,()]+?)\s+Ward\b/u

/**
 * ⛔ ONLY A NAME FROM AN OFFICIAL LIST IS PRINTED (commit gate 2026-11-26). `location` holds a seller's free text after the
 * word "Phường" as easily as a ward ("Phường Thảo Điền gần sông", "Phường liên hệ Zalo nhé"), and this sentence stands on an
 * indexable page in eno's own voice. So a name counts only when it is a ward of the 2025 units (src/data/vn-units.json, the
 * country's) or an HCMC ward from before the 2025 reform (hcmc-old-wards.ts — the stored rows still carry those), matched
 * without marks and printed in the list's own spelling ("Thao Dien" → "Thảo Điền"); a 1–2 digit number is a numbered ward.
 * SERVER-ONLY: vn-units.json is ~200 KB (job-cities.ts has the same note). Every stored value read on 2026-11-26 (116 strings,
 * 6,401 listings) named a ward on these lists.
 */
type Known = { exact: Map<string, string>; bare: Map<string, string | null> } // '' / null = two wards share the key
let known: Known | null = null
/**
 * Two lookups: the exact name (marks kept, case folded) first, then the name without marks only where that names ONE ward —
 * "Tân Định" (HCMC) and "Tân Dĩnh" (another province) are one string without their marks, and the bare form would print
 * the wrong one. An ambiguous bare name (null) prints nothing.
 */
function knownWards(): Known {
  if (known) return known
  const exact = new Map<string, string>()
  const bare = new Map<string, string | null>()
  // `exact` takes the Vietnamese name only: an English name ("Tan Dinh") is unaccented, so it is a `bare` key like any other.
  const add = (key: string, name: string, accented: boolean) => {
    const e = key.normalize('NFC').toLowerCase()
    if (accented) {
      const was = exact.get(e)
      if (was === undefined) exact.set(e, name)
      else if (was !== name) exact.set(e, '')
    }
    const b = slugify(key)
    if (!b) return
    const had = bare.get(b)
    if (had === undefined) bare.set(b, name)
    else if (had !== name) bare.set(b, null)
  }
  for (const p of vnUnits as readonly { wards?: readonly { name: string; nameEn?: string }[] }[]) {
    for (const w of p.wards ?? []) { add(w.name, w.name, true); if (w.nameEn) add(w.nameEn, w.name, false) }
  }
  for (const [, , , list] of HCMC_OLD_WARDS) for (const w of list.split('|')) if (!/^\d+$/.test(w)) add(w, w, true)
  known = { exact, bare }
  return known
}

/** The ward a stored location names, in its official spelling, or null ("Quận 12, Hồ Chí Minh" names none). */
export function wardOf(location: string | null | undefined): string | null {
  if (!location) return null
  const text = location.normalize('NFC')
  const raw = (text.match(VI_WARD) ?? text.match(EN_WARD))?.[1]?.trim().replace(/\s+/g, ' ')
  if (!raw) return null
  // A numbered ward: HCMC's old numbered wards run 1–28 (hcmc-old-wards.ts); "07" and "7" are one ward, "0" or "99" none.
  if (/^\d{1,2}$/.test(raw)) { const n = Number(raw); return n >= 1 && n <= 28 ? String(n) : null }
  const { exact, bare } = knownWards()
  return exact.get(raw.toLowerCase()) || bare.get(slugify(raw)) || null
}

/**
 * The `max` wards with the most listings, most first, from a `groupBy(['location'])`. Two spellings of one ward
 * ("Thảo Điền" / "Thao Dien") are one ward: wardOf already returns the list's spelling.
 */
export function topWards(groups: readonly { location: string | null; count: number }[], max = 5): WardName[] {
  const byKey = new Map<string, { name: string; count: number }>()
  for (const g of groups) {
    const name = wardOf(g.location)
    if (!name) continue
    const key = slugify(name)
    if (!key) continue
    const had = byKey.get(key)
    if (had) had.count += g.count
    else byKey.set(key, { name, count: g.count })
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'))
    .slice(0, max)
    .map(({ name }) => (/^\d+$/.test(name) ? { en: `Ward ${name}`, vi: `Phường ${name}` } : { en: name, vi: name }))
}
