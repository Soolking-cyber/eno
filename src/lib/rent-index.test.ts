import { describe, expect, it } from 'vitest'
import {
  assignDistrict, computeRentIndex, isMonthlyRent, quantile, rentIndexCsv, CSV_COLUMNS, MIN_CELL_N,
  MAX_MONTHLY_VND, MIN_MONTHLY_VND, MONTHLY_BARE_VND_SELLERS, MONTHLY_UNIT, type RentRow,
} from './rent-index'

const BDS = 'bds-vn-import-seller-0001'
const NHATOT = 'nhatot-import-seller-0001'

const row = (over: Partial<RentRow> = {}): RentRow => ({
  price: 10_000_000,
  priceUnit: 'VND/month',
  currency: '₫',
  listingType: 'rent',
  subcategorySlug: 'apartment-rental',
  district: 'Quận 1',
  areaM2: 50,
  sellerId: NHATOT,
  ...over,
})

/** n rows with prices 1..n million, distinct areas so none collapse as cross-posts. */
const many = (n: number, over: Partial<RentRow> = {}) =>
  Array.from({ length: n }, (_, i) => row({ price: (i + 1) * 1_000_000, areaM2: 30 + i, ...over }))

describe('quantile', () => {
  it('is type-7 linear interpolation', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(quantile([7], 0.75)).toBe(7)
  })
})

describe('assignDistrict', () => {
  it('number-bounds the numbered districts', () => {
    expect(assignDistrict('Quận 1')).toBe('d1')
    expect(assignDistrict('Quận 10')).toBe('d10')
    expect(assignDistrict('Quận 1 (P. Bến Thành mới)')).toBe('d1')
    expect(assignDistrict('Quận 12')).toBe('d12')
  })
  it('puts abolished District 2/9 in their own rows, never straight into the Thủ Đức umbrella', () => {
    expect(assignDistrict('Quận 2')).toBe('d2')
    expect(assignDistrict('Quận 9')).toBe('d9')
    expect(assignDistrict('TP. Thủ Đức (P. Long Phước mới)')).toBe('thu-duc')
    // Thảo Điền is a ward of the former District 2 (D0, decision D-d): its own row, and — since d2 is
    // one of the umbrella's parts — still inside Thủ Đức's union row.
    expect(assignDistrict('Thảo Điền')).toBe('d2')
    expect(assignDistrict('Thao Dien')).toBe('d2')
    expect(assignDistrict('Phường Thảo Điền, TP. Thủ Đức')).toBe('d2')
  })
  it('refuses a value naming two districts, and an unknown one', () => {
    expect(assignDistrict('Quận 1, Quận 3')).toBeNull()
    expect(assignDistrict('Quận 1, TP. Thủ Đức')).toBeNull()
    expect(assignDistrict('Hà Nội')).toBeNull()
    expect(assignDistrict(null)).toBeNull()
  })
})

describe('isMonthlyRent', () => {
  /** computeRentIndex's inline test at rent-index.ts:219 (176c0d63), verbatim, over a row's two fields. */
  const oldInline = (r: { priceUnit: string | null; sellerId: string }) =>
    r.priceUnit === MONTHLY_UNIT || (r.priceUnit === 'VND' && MONTHLY_BARE_VND_SELLERS.has(r.sellerId))

  const UNITS = [null, '', 'VND', 'VND/month', 'month', 'VND/day', 'VND/service', 'VND/kg', 'VND/hour', 'vnd', ' VND']
  const SELLERS = [BDS, 'cmub0wead0000zrq418bqq27m', NHATOT, 'some-member', '']

  it('answers exactly as the inline test it replaced, for every unit × seller', () => {
    for (const priceUnit of UNITS) {
      for (const sellerId of SELLERS) {
        expect(isMonthlyRent(priceUnit, sellerId), `${priceUnit} × ${sellerId}`).toBe(oldInline({ priceUnit, sellerId }))
      }
    }
  })

  it('is the explicit monthly unit from anyone, or a bare VND from the two proven importers only', () => {
    expect(isMonthlyRent('VND/month', 'some-member')).toBe(true)
    expect(isMonthlyRent('VND', BDS)).toBe(true)
    expect(isMonthlyRent('VND', 'cmub0wead0000zrq418bqq27m')).toBe(true)
    expect(isMonthlyRent('VND', NHATOT)).toBe(false)
    expect(isMonthlyRent('month', BDS)).toBe(false)
    expect(isMonthlyRent(null, BDS)).toBe(false)
  })
})

describe('computeRentIndex — which rows count', () => {
  it('accepts a bare "VND" unit only from the importers proven to store monthly rent', () => {
    const idx = computeRentIndex([
      row({ priceUnit: 'VND', sellerId: BDS }),
      row({ priceUnit: 'VND', sellerId: 'some-member' }),
      row({ priceUnit: 'VND/day' }),
    ])
    expect(idx.used).toBe(1)
    expect(idx.excluded.unit).toBe(2)
  })

  it('drops offices, vehicle hire, wanted posts and other currencies, and counts each reason', () => {
    const idx = computeRentIndex([
      row({ subcategorySlug: 'office-rental' }),
      row({ subcategorySlug: 'motorbike-rental' }),
      row({ subcategorySlug: null }),
      row({ listingType: 'wanted' }),
      row({ currency: '$' }),
    ])
    expect(idx.used).toBe(0)
    expect(idx.excluded).toMatchObject({ notResidential: 3, notForRent: 1, currency: 1 })
  })

  it('applies the monthly band at both ends', () => {
    const idx = computeRentIndex([
      row({ price: MIN_MONTHLY_VND - 1 }),
      row({ price: MIN_MONTHLY_VND, areaM2: 31 }),
      row({ price: MAX_MONTHLY_VND, areaM2: 32 }),
      row({ price: MAX_MONTHLY_VND + 1 }),
    ])
    expect(idx.used).toBe(2)
    expect(idx.excluded).toMatchObject({ belowBand: 1, aboveBand: 1 })
  })

  it('keeps a row with an implausible area but leaves it out of ₫/m²', () => {
    const rows = [
      ...many(MIN_CELL_N),
      row({ price: 20_000_000, areaM2: 2.04 }), // the 1000× dot-separator bug
      row({ price: 20_000_000, areaM2: 50_000 }),
      row({ price: 5_000_000, areaM2: 1_000 }), // 5,000 ₫/m² — a plot, not a floor
      row({ price: 5_000_000, areaM2: null }),
    ]
    const cell = computeRentIndex(rows).cityWide.apartment
    expect(cell.n).toBe(MIN_CELL_N + 4)
    expect(cell.nArea).toBe(MIN_CELL_N)
  })

  it('collapses an exact cross-post between two sellers, but not two identical units from one seller', () => {
    const a = row({ price: 15_000_000, areaM2: 70, district: 'Quận 7' })
    const idx = computeRentIndex([
      a,
      { ...a, sellerId: BDS, priceUnit: 'VND' },
      { ...a }, // same seller, same building, same price: a second unit
      { ...a, district: null, sellerId: BDS }, // no district → too little identity
    ])
    expect(idx.excluded.crossPosted).toBe(1)
    expect(idx.used).toBe(3)
  })

  it("drops only as many of one seller's twins as another seller has matching units", () => {
    const a = row({ price: 15_000_000, areaM2: 70, district: 'Quận 7' })
    const b = { ...a, sellerId: BDS, priceUnit: 'VND' }
    const idx = computeRentIndex([a, b, b])
    expect(idx.excluded.crossPosted).toBe(1)
    expect(idx.used).toBe(2)
  })

  it('never collapses rooms, whose round prices and areas collide between genuinely different units', () => {
    const r = row({ subcategorySlug: 'room-rental', price: 3_500_000, areaM2: 20, district: 'Gò Vấp' })
    const idx = computeRentIndex([r, { ...r, sellerId: BDS, priceUnit: 'VND' }])
    expect(idx.excluded.crossPosted).toBe(0)
    expect(idx.used).toBe(2)
  })
})

describe('computeRentIndex — what is published', () => {
  it(`suppresses a cell below ${MIN_CELL_N} listings but still reports its n`, () => {
    const idx = computeRentIndex(many(MIN_CELL_N - 1))
    const d1 = idx.districts.find((d) => d.slug === 'd1')!
    expect(d1.cells.apartment).toMatchObject({ n: MIN_CELL_N - 1, median: null, p25: null, p75: null })
    expect(idx.cityWide.apartment.median).toBeNull()
  })

  it('publishes median and IQR at the threshold', () => {
    const cell = computeRentIndex(many(MIN_CELL_N)).cityWide.apartment
    expect(cell).toMatchObject({ n: 10, median: 5_500_000, p25: 3_250_000, p75: 7_750_000 })
  })

  it('builds Thủ Đức as the umbrella over its own rows plus d2 and d9, and marks the parts', () => {
    const idx = computeRentIndex([
      ...many(4, { district: 'Quận 2' }),
      ...many(3, { district: 'Quận 9', areaM2: 90 }),
      ...many(5, { district: 'TP. Thủ Đức', areaM2: 120 }),
    ])
    const get = (s: string) => idx.districts.find((d) => d.slug === s)!
    expect(get('d2')).toMatchObject({ total: 4, partOf: 'thu-duc' })
    expect(get('d9')).toMatchObject({ total: 3, partOf: 'thu-duc' })
    expect(get('thu-duc')).toMatchObject({ total: 12, partOf: null })
    // City-wide counts each listing once.
    expect(idx.cityWide.apartment.n).toBe(12)
  })

  it('publishes no per-source breakdown anywhere (owner, 2026-09-27)', () => {
    const idx = computeRentIndex([
      ...many(MIN_CELL_N),
      ...many(MIN_CELL_N, { sellerId: BDS, priceUnit: 'VND', areaM2: 200 }),
    ])
    expect(Object.keys(idx)).not.toContain('bySource')
    expect(Object.keys(idx.cityWide.apartment)).not.toContain('sources')
    const csv = rentIndexCsv(idx)
    expect(csv).not.toMatch(/Batdongsan|Nhatot|,source,/)
  })
})

describe('rentIndexCsv', () => {
  it('neutralises a text field a spreadsheet would run as a formula', () => {
    const idx = computeRentIndex([], new Date('2026-09-27T00:00:00Z'))
    idx.districts.push({ slug: 'x', name: 'x', nameEn: '=HYPERLINK("x")', partOf: null, total: 0, cells: idx.cityWide })
    expect(rentIndexCsv(idx)).toContain(`,district,x,"'=HYPERLINK(""x"")",`)
  })

  it('emits the header, city and district rows from the same object', () => {
    const idx = computeRentIndex(many(MIN_CELL_N), new Date('2026-09-27T00:00:00Z'))
    const lines = rentIndexCsv(idx).trimEnd().split('\r\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    // 3 types × (city + d1)
    expect(lines).toHaveLength(1 + 3 * 2)
    const d1Apartment = lines.find((l) => l.includes(',district,d1,') && l.includes(',apartment,'))!
    expect(d1Apartment.startsWith('2026-09-27T00:00:00.000Z,district,d1,District 1,,apartment,10,5500000,3250000,7750000,10,')).toBe(true)
    // A suppressed cell keeps its n and leaves the statistics empty.
    expect(lines.find((l) => l.includes(',city,') && l.includes(',house,'))).toMatch(/,house,0,,,,0,$/)
  })
})
