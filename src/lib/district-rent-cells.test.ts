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
    const r = row({ house: pub(MIN_CELL_N - 1, 9_000_000) }, { br2: pub(MIN_CELL_N - 1, 8_000_000) })
    expect(publishableCells(r)).toEqual([])
    expect(publishableCells(row({ house: pub(MIN_CELL_N, 9_000_000) }, {}))).toEqual([{ kind: 'house', median: 9_000_000, n: MIN_CELL_N }])
  })
  it('at most five', () => {
    const all = row({ apartment: pub(99, 1), house: pub(99, 1), room: pub(99, 1) }, { br1: pub(99, 1), br2: pub(99, 1), br3plus: pub(99, 1) })
    expect(publishableCells(all)).toHaveLength(5)
  })
})
