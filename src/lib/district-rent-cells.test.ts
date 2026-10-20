import { describe, expect, it } from 'vitest'
import { APARTMENT_BANDS, MIN_CELL_N, RENT_TYPES, type DistrictRow, type Stats } from '@/lib/rent-index'
import { publishableCells } from './district-rent-cells'

const empty: Stats = { n: 0, median: null, p25: null, p75: null, nArea: 0, medianPerM2: null }
const pub = (n: number, median: number): Stats => ({ ...empty, n, median, p25: median, p75: median })
const row = (cells: Partial<Record<(typeof RENT_TYPES)[number], Stats>>, bands: Partial<Record<(typeof APARTMENT_BANDS)[number], Stats>>) => ({
  cells: Object.fromEntries(RENT_TYPES.map((t) => [t, cells[t] ?? empty])) as DistrictRow['cells'],
  bands: Object.fromEntries(APARTMENT_BANDS.map((b) => [b, bands[b] ?? empty])) as DistrictRow['bands'],
})

describe('publishableCells — the one list the district block renders and D3 submits on', () => {
  it('bands first, then houses and rooms — never the all-sizes figure beside a band (District 1, 2026-09-30)', () => {
    const d1 = row(
      { apartment: pub(645, 10_000_000), house: pub(57, 60_000_000), room: pub(61, 5_300_000) },
      { br1: pub(384, 8_600_000), br2: pub(123, 31_000_000), br3plus: pub(85, 60_000_000) },
    )
    expect(publishableCells(d1).map((c) => c.kind)).toEqual(['br1', 'br2', 'br3plus', 'house', 'room'])
    expect(publishableCells(d1)[0]).toEqual({ kind: 'br1', median: 8_600_000, n: 384 })
  })
  it('the all-sizes apartment figure only when no band publishes', () => {
    const r = row({ apartment: pub(40, 9_000_000), room: pub(12, 3_000_000) }, { br1: pub(MIN_CELL_N - 1, 8_000_000) })
    expect(publishableCells(r).map((c) => c.kind)).toEqual(['apartment', 'room'])
  })
  it('nothing under the threshold, even with a median; nothing at all for a row with no cell (can-gio)', () => {
    const r = row({ house: pub(MIN_CELL_N - 1, 9_000_000) }, { br2: pub(MIN_CELL_N - 1, 8_000_000), studio: pub(MIN_CELL_N - 1, 4_000_000) })
    expect(publishableCells(r)).toEqual([])
    expect(publishableCells(row({ house: pub(MIN_CELL_N, 9_000_000) }, {}))).toEqual([{ kind: 'house', median: 9_000_000, n: MIN_CELL_N }])
  })
  it('one per kind — at most six since rules v5: Studio, the three bedroom bands, houses, rooms', () => {
    const all = row({ apartment: pub(99, 1), house: pub(99, 1), room: pub(99, 1) }, { studio: pub(99, 1), br1: pub(99, 1), br2: pub(99, 1), br3plus: pub(99, 1) })
    expect(publishableCells(all).map((c) => c.kind)).toEqual(['studio', 'br1', 'br2', 'br3plus', 'house', 'room'])
  })

  /**
   * ⛔ RULES v5: a studio or duplex room is the Studio band, shown first. District 12 on 2026-10-20: 862 GoPlus rooms
   * in the 1-bedroom band, all but a handful of them Studio or Duplex rooms — the block now says Studio.
   */
  it('the Studio band first, alone when it is the only band that publishes — never the all-sizes figure beside it', () => {
    const d12 = row({ apartment: pub(865, 4_200_000) }, { studio: pub(860, 4_200_000), br1: pub(2, 6_000_000), br2: pub(2, 9_000_000) })
    expect(publishableCells(d12)).toEqual([{ kind: 'studio', median: 4_200_000, n: 860 }])
    const both = row({ apartment: pub(151, 6_000_000) }, { studio: pub(120, 5_600_000), br1: pub(12, 7_000_000), br2: pub(17, 9_400_000) })
    expect(publishableCells(both).map((c) => c.kind)).toEqual(['studio', 'br1', 'br2'])
  })

  /**
   * ⛔ WHAT pages.xml SUBMITS CANNOT MOVE WITH THE BANDS: in a real snapshot a band is a subset of the apartment cell at
   * the same floor, so a district has a cell exactly when its apartment, house or room cell publishes — with or
   * without the Studio band. Checked over every shape a district row can take with consistent counts.
   */
  it('is non-empty exactly when the apartment, house or room cell publishes, whichever bands publish', () => {
    const ns = [0, MIN_CELL_N - 1, MIN_CELL_N, 40]
    const stat = (n: number) => (n >= MIN_CELL_N ? pub(n, 5_000_000) : { ...empty, n })
    for (const studio of ns) for (const br1 of ns) for (const house of [0, MIN_CELL_N]) {
      const apartment = studio + br1
      const r = row({ apartment: stat(apartment), house: stat(house) }, { studio: stat(studio), br1: stat(br1) })
      const v4Bands = row({ apartment: stat(apartment), house: stat(house) }, { br1: stat(apartment) }) // v4: studios were br1
      const expected = apartment >= MIN_CELL_N || house >= MIN_CELL_N
      expect(publishableCells(r).length > 0, `${studio}/${br1}/${house}`).toBe(expected)
      expect(publishableCells(v4Bands).length > 0, `v4 ${apartment}/${house}`).toBe(expected)
    }
  })
})
