import { matchesProvinceRow } from '@/lib/province-match'
import {
  APARTMENT_BANDS, MIN_CELL_N, RENT_TYPES, assignDistrict, computeRentIndex, roundForDisplay,
  type ApartmentBand, type RentIndex, type RentRow, type RentType, type Stats,
} from '@/lib/rent-index'

/**
 * AREA RENT ON A RENTAL'S PAGE (owner, 2026-11-19: "Add area rent context"; Search Console that day: 1,529 pages "crawled –
 * currently not indexed", 81% of a sample listing pages, mostly GoPlus rooms whose text differs only by size and ward): the
 * /hcmc-rent-index figure for the cell THIS listing is counted in — its district, its type, its apartment band — and where its
 * rent sits against that cell's middle half (P25–P75). Pure: the PDP loads the snapshot (load-rent-index.ts) and draws
 * <AreaRent> (src/components/marketplace/area-rent.tsx).
 *
 * ⛔ THE INDEX'S OWN RULES PICK THE CELL, BY RUNNING THEM — never restated here. The listing goes through `computeRentIndex`
 * alone: a row the index leaves out (not a home, a Wanted post, not ₫, not a monthly price — per day or hour —, a house with
 * no bedroom count, outside the 1M–500M ₫ band) gets no line, and the type and band are the ones the index counts it in. A
 * rules change (RENT_INDEX_RULES_VERSION) moves this line with the index. The loader's own WHERE is mirrored beside it: the
 * rentals category, live and verified, in Hồ Chí Minh (`matchesProvinceRow` is provinceWhere over one row).
 * ⛔ NEVER A RANGE THE INDEX PAGE WOULD NOT PRINT: the cell must publish (n ≥ MIN_CELL_N, with its P25 and P75), as the page's
 * own `publishable` (rent-index-sections.tsx). An apartment whose bedroom band does not publish gets NO line, not the
 * all-sizes figure: that mostly measures the size mix (district-rent-cells.ts) and would call a two-bedroom "above" a studio
 * market. The all-sizes figure is used only for an apartment with no band (no bedroom count) — the cell it IS counted in.
 * ⚠️ THE VERDICT IS AGAINST THE PRINTED RANGE (100,000 ₫ steps, `roundForDisplay`), so the words never contradict the figures.
 */
export type AreaRentKind = ApartmentBand | RentType

/** What the PDP reads from the listing row: the index's own row, plus the loader's WHERE fields. */
export type AreaRentRow = RentRow & {
  categorySlug: string
  status: string
  verified: boolean
  city: string | null
  location: string | null
}

export type AreaRent = {
  kind: AreaRentKind
  /** The curated district's names, as the index's table prints them (place names are never machine-translated). */
  place: { en: string; vi: string }
  /** The cell's P25 and P75, as the index page prints them (100,000 ₫ steps). */
  low: number
  high: number
  /** Listings the cell is computed from. */
  n: number
  position: 'below' | 'within' | 'above'
  /** The snapshot's ISO time — the date the index prints. */
  asOf: string
}

const publishes = (s: Stats): s is Stats & { p25: number; p75: number } =>
  s.median !== null && s.p25 !== null && s.p75 !== null && s.n >= MIN_CELL_N

/** The index cell this listing is counted in — district slug, type, band — or null when the index would not count it. */
export function areaRentCell(row: AreaRentRow): { slug: string; type: RentType; band: ApartmentBand | null } | null {
  if (row.categorySlug !== 'rentals' || row.status !== 'active' || !row.verified) return null
  if (!matchesProvinceRow(row, 'Ho Chi Minh')) return null
  const slug = assignDistrict(row.district)
  if (!slug) return null
  const one = computeRentIndex([row])
  if (one.used !== 1) return null
  const type = RENT_TYPES.find((t) => one.cityWide[t].n === 1)
  if (!type) return null
  const band = type === 'apartment' ? APARTMENT_BANDS.find((b) => one.cityBands[b].n === 1) ?? null : null
  return { slug, type, band }
}

/** The line's figures from a snapshot, or null — no cell, or a cell the index page prints as a dash. */
export function areaRentFor(row: AreaRentRow, index: RentIndex): AreaRent | null {
  const cell = areaRentCell(row)
  if (!cell) return null
  const d = index.districts.find((x) => x.slug === cell.slug)
  if (!d) return null
  const s = cell.type === 'apartment' ? (cell.band ? d.bands[cell.band] : d.cells.apartment) : d.cells[cell.type]
  if (!publishes(s)) return null
  const low = roundForDisplay(s.p25)
  const high = roundForDisplay(s.p75)
  const price = Number(row.price)
  return {
    kind: cell.band ?? cell.type,
    place: { en: d.nameEn, vi: d.name },
    low,
    high,
    n: s.n,
    position: price < low ? 'below' : price > high ? 'above' : 'within',
    asOf: index.computedAt,
  }
}
