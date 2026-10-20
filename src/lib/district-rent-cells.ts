import { APARTMENT_BANDS, MIN_CELL_N, type ApartmentBand, type DistrictRow, type RentType, type Stats } from '@/lib/rent-index'

/**
 * THE FIGURES A RENTALS DISTRICT PAGE PRINTS FROM THE RENT INDEX (SEO wave B, D2) — pure, and the one
 * definition: the page's block renders exactly this list, and D3's sitemap rule submits a district
 * page only when it is non-empty, so the two cannot disagree.
 *
 * In display order, each at the publishing threshold (MIN_CELL_N, the index's own): the apartment bands in the
 * index's own order (APARTMENT_BANDS — Studio, then 1, 2 and 3+ bedrooms since rules v5), houses, rooms. So at most
 * six, one per kind: it was five, the three bedroom bands plus houses and rooms, until v5 added the Studio band.
 * ⚠️ THE ALL-SIZES APARTMENT FIGURE ONLY WHEN NO BAND PUBLISHES: it mostly measures the size mix (65% of District 1's
 * counted apartments were one-bedroom, rent-index.ts), so beside the bands it would be a misleading extra number.
 * ⚠️ WHETHER THE LIST IS EMPTY DOES NOT DEPEND ON THE BANDS — which is what D3's sitemap rule reads. A band is a subset
 * of the apartment cell at the same floor, so a band that publishes means the apartment cell publishes too; the list is
 * non-empty exactly when the apartment, house or room cell publishes. Adding the Studio band (v5) changed which
 * figures a district page prints, never which district pages pages.xml submits.
 */
export type RentCellKind = ApartmentBand | 'apartment' | Exclude<RentType, 'apartment'>
export type RentCell = { kind: RentCellKind; median: number; n: number }

const publishes = (s: Stats): s is Stats & { median: number } => s.median !== null && s.n >= MIN_CELL_N

export function publishableCells(row: Pick<DistrictRow, 'cells' | 'bands'>): RentCell[] {
  const out: RentCell[] = []
  for (const b of APARTMENT_BANDS) {
    const s = row.bands[b]
    if (publishes(s)) out.push({ kind: b, median: s.median, n: s.n })
  }
  if (out.length === 0 && publishes(row.cells.apartment)) out.push({ kind: 'apartment', median: row.cells.apartment.median, n: row.cells.apartment.n })
  for (const t of ['house', 'room'] as const) {
    const s = row.cells[t]
    if (publishes(s)) out.push({ kind: t, median: s.median, n: s.n })
  }
  return out
}
