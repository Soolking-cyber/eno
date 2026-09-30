import { MIN_CELL_N, type ApartmentBand, type DistrictRow, type RentType, type Stats } from '@/lib/rent-index'

/**
 * THE FIGURES A RENTALS DISTRICT PAGE PRINTS FROM THE RENT INDEX (SEO wave B, D2) — pure, and the one
 * definition: the page's block renders exactly this list, and D3's sitemap rule submits a district
 * page only when it is non-empty, so the two cannot disagree.
 *
 * In display order, at most five, each at the publishing threshold (MIN_CELL_N, the index's own):
 * the three apartment bedroom bands, houses, rooms. ⚠️ THE ALL-SIZES APARTMENT FIGURE ONLY WHEN NO
 * BAND PUBLISHES: it mostly measures the size mix (65% of District 1's counted apartments are
 * one-bedroom, rent-index.ts), so beside the bands it would be a sixth, misleading number.
 */
export type RentCellKind = ApartmentBand | 'apartment' | Exclude<RentType, 'apartment'>
export type RentCell = { kind: RentCellKind; median: number; n: number }

const publishes = (s: Stats): s is Stats & { median: number } => s.median !== null && s.n >= MIN_CELL_N

export function publishableCells(row: Pick<DistrictRow, 'cells' | 'bands'>): RentCell[] {
  const out: RentCell[] = []
  for (const b of ['br1', 'br2', 'br3plus'] as const) {
    const s = row.bands[b]
    if (publishes(s)) out.push({ kind: b, median: s.median, n: s.n })
  }
  if (out.length === 0 && publishes(row.cells.apartment)) out.push({ kind: 'apartment', median: row.cells.apartment.median, n: row.cells.apartment.n })
  for (const t of ['house', 'room'] as const) {
    const s = row.cells[t]
    if (publishes(s)) out.push({ kind: t, median: s.median, n: s.n })
  }
  return out.slice(0, 5)
}
