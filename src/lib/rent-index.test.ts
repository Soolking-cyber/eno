import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hammingHex } from './image-hash-url'
import { RENTAL_IMPORT_SELLERS } from './import-sellers'
import { HOME_RENTAL_SUBCATS } from './rental-homes'
import { NOT_INDEXED_HOMES,
  apartmentBand, apartmentType, assignDistrict, bedroomCount, computeRentIndex, dedupeCandidateIds, distinctShots, isMonthlyRent,
  quantile, rentSources, sameUnitByPhotos, shotDistance,
  rentIndexCsv, roundForDisplay, APARTMENT_BANDS, BAND_CSV_TYPE, CSV_BAND_ORDER, CSV_COLUMNS, IMPORT_SOURCE_NAME, MIN_CELL_N,
  MAX_MONTHLY_VND, MIN_MONTHLY_VND, MONTHLY_BARE_VND_SELLERS, MONTHLY_UNIT, RENT_INDEX_RULE_INPUTS, RENT_INDEX_RULES_VERSION,
  STUDIO_APT_TYPES, type RentRow,
} from './rent-index'

const BDS = 'bds-vn-import-seller-0001'
const NHATOT = 'nhatot-import-seller-0001'

let seq = 0
const row = (over: Partial<RentRow> = {}): RentRow => ({
  id: `l-${String(++seq).padStart(6, '0')}`,
  price: 10_000_000,
  priceUnit: 'VND/month',
  currency: '₫',
  listingType: 'rent',
  subcategorySlug: 'apartment-rental',
  district: 'Quận 1',
  areaM2: 50,
  sellerId: NHATOT,
  attributes: '{"bedrooms":"2"}',
  ...over,
})

/** A stored image URL carrying dHash `hex` the way storeListingImage bakes it in. */
const img = (hex: string) => `https://sb.eno.vn/storage/v1/object/public/listings/x-h${hex}.webp`
/** Four photos no two of which are within Hamming 10 of each other (every pair ≥ 32 bits apart). */
const SHOTS = ['0000000000000000', 'ffffffffffffffff', '00000000ffffffff', 'ffffffff00000000'].map(img)
const OTHER = ['0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0', '3333333333333333', 'cccccccccccccccc'].map(img)

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

  it('a house with no bedroom count is commercial, counted before the price band (R-a)', () => {
    const idx = computeRentIndex([
      row({ subcategorySlug: 'house-rental', attributes: null }),
      row({ subcategorySlug: 'house-rental', attributes: '{}', price: 900_000_000 }), // a shopfront, not "above the band"
      row({ subcategorySlug: 'house-rental', attributes: '{"bedrooms":"4"}' }),
      row({ subcategorySlug: 'apartment-rental', attributes: null }), // an apartment without a count is still a home
      row({ subcategorySlug: 'room-rental', attributes: null }),
    ])
    expect(idx.excluded.commercial).toBe(2)
    expect(idx.excluded.aboveBand).toBe(0)
    expect(idx.used).toBe(3)
  })

  it('reads the count from the facet JSON, and never turns a missing one into a studio', () => {
    expect(bedroomCount('{"bedrooms":"2","bathrooms":"1"}')).toBe(2)
    expect(bedroomCount('{"bedrooms":"6"}')).toBe(6)
    expect(bedroomCount('{"bedrooms":"0"}')).toBe(0)
    expect(bedroomCount('{"bedrooms":3}')).toBe(3)
    for (const bad of [null, '', '{}', 'not json', '[]', '{"bedrooms":""}', '{"bedrooms":"2.5"}', '{"bedrooms":"-1"}', '{"bedrooms":"3+"}']) {
      expect(bedroomCount(bad), String(bad)).toBeNull()
    }
  })
})

describe('computeRentIndex — cross-posts are proven by photos (R-b)', () => {
  const a = row({ price: 15_000_000, areaM2: 70, district: 'Quận 7' })
  const photos = (entries: [RentRow, string[]][]) => new Map(entries.map(([r, p]) => [r.id, p]))

  it('merges two sellers\' rows that share their photos, and nothing else', () => {
    const b = { ...a, id: 'b', sellerId: BDS, priceUnit: 'VND', areaM2: 68 } // the portals disagree on the area
    const idx = computeRentIndex([a, b], photos([[a, SHOTS], [b, [...SHOTS.slice(0, 3), OTHER[0]]]]))
    expect(idx.excluded.crossPosted).toBe(1)
    expect(idx.used).toBe(1)
  })

  it('keeps an exact price-and-area match with different photos — v2 dropped it', () => {
    const b = { ...a, id: 'b', sellerId: BDS, priceUnit: 'VND' }
    const idx = computeRentIndex([a, b], photos([[a, SHOTS], [b, OTHER]]))
    expect(idx.excluded.crossPosted).toBe(0)
    expect(idx.used).toBe(2)
  })

  it('never merges on a shared banner (one photo) or an exact half, and never without photos', () => {
    const b = { ...a, id: 'b', sellerId: BDS, priceUnit: 'VND' }
    expect(computeRentIndex([a, b], photos([[a, SHOTS], [b, [SHOTS[0], ...OTHER]]])).excluded.crossPosted).toBe(0)
    expect(computeRentIndex([a, b], photos([[a, SHOTS], [b, [SHOTS[0], SHOTS[1], OTHER[0], OTHER[1]]]])).excluded.crossPosted).toBe(0)
    expect(computeRentIndex([a, b]).excluded.crossPosted).toBe(0)
  })

  it('never merges one seller\'s own rows, a different price, a different district, or a row with no district', () => {
    const same = { ...a, id: 'same' }
    const price = { ...a, id: 'price', sellerId: BDS, priceUnit: 'VND', price: 15_500_000 }
    const district = { ...a, id: 'district', sellerId: BDS, priceUnit: 'VND', district: 'Quận 1' }
    const none = { ...a, id: 'none', sellerId: BDS, priceUnit: 'VND', district: null }
    const rows = [a, same, price, district, none]
    const idx = computeRentIndex(rows, photos(rows.map((r) => [r, SHOTS])))
    expect(idx.excluded.crossPosted).toBe(0)
    expect(idx.used).toBe(5)
  })

  it('compares rooms too: a photo match is not the chance collision v2 guarded rooms against', () => {
    const r = row({ subcategorySlug: 'room-rental', price: 3_500_000, areaM2: 20, district: 'Gò Vấp' })
    const s2 = { ...r, id: 'r2', sellerId: BDS, priceUnit: 'VND' }
    expect(computeRentIndex([r, s2], photos([[r, SHOTS], [s2, SHOTS]])).excluded.crossPosted).toBe(1)
    expect(computeRentIndex([r, s2], photos([[r, SHOTS], [s2, OTHER]])).excluded.crossPosted).toBe(0)
  })

  it('counts distinct shots one to one, so two uploads of one photo are one shared photo, either way round', () => {
    const near = img('0000000000000003') // 2 bits from SHOTS[0]: the same photo re-encoded
    const twice = [SHOTS[0], near]
    const oneShared = [SHOTS[0], OTHER[0]]
    expect(sameUnitByPhotos(distinctShots(twice), distinctShots(oneShared))).toBe(false)
    expect(sameUnitByPhotos(distinctShots(oneShared), distinctShots(twice))).toBe(false)
    expect(distinctShots([...SHOTS, near, 'https://x/no-hash.jpg'])).toHaveLength(4)
    // The numeric distance is the repo's hex one, bit for bit.
    const hexes = ['0000000000000000', 'ffffffffffffffff', '0123456789abcdef', 'fedcba9876543210', '8000000000000001', '0000000000000003']
    for (const x of hexes) for (const y of hexes) {
      expect(shotDistance(distinctShots([img(x)])[0], distinctShots([img(y)])[0]), `${x}/${y}`).toBe(hammingHex(x, y))
    }
    const b = { ...a, id: 'b', sellerId: BDS, priceUnit: 'VND' }
    expect(computeRentIndex([a, b], photos([[a, [SHOTS[0], near, SHOTS[1]]], [b, [SHOTS[0], OTHER[0], OTHER[1]]]])).excluded.crossPosted).toBe(0)
    expect(computeRentIndex([b, a], photos([[a, [SHOTS[0], near, SHOTS[1]]], [b, [SHOTS[0], OTHER[0], OTHER[1]]]])).excluded.crossPosted).toBe(0)
  })

  it("lets one row absorb only one of another seller's same-photo rows, in either order", () => {
    const b1 = { ...a, id: 'b1', sellerId: BDS, priceUnit: 'VND' }
    const b2 = { ...a, id: 'b2', sellerId: BDS, priceUnit: 'VND' }
    const all = photos([[a, SHOTS], [b1, SHOTS], [b2, SHOTS]])
    for (const order of [[a, b1, b2], [b1, b2, a], [b1, a, b2]]) {
      const idx = computeRentIndex(order, all)
      expect(idx.excluded.crossPosted, order.map((r) => r.id).join()).toBe(1)
      expect(idx.used).toBe(2)
    }
  })

  it('names as candidates only rows sharing type, district and price with another seller', () => {
    const b = { ...a, id: 'b', sellerId: BDS, priceUnit: 'VND' }
    const lone = { ...a, id: 'lone', price: 16_000_000 }
    const same = { ...a, id: 'same' } // same seller as a: not a candidate pair on its own
    const office = { ...a, id: 'office', sellerId: BDS, subcategorySlug: 'office-rental' }
    const noDistrict = { ...a, id: 'nd', sellerId: BDS, district: null }
    expect(dedupeCandidateIds([a, b, lone, office, noDistrict])).toEqual([a.id, 'b'])
    expect(dedupeCandidateIds([a, same, lone])).toEqual([])
  })
})

describe('computeRentIndex — apartment bands (R-d)', () => {
  it('bands 1, 2 and 3+ by the count; a missing count with no studio type gets no band', () => {
    expect([null, 1, 2, 3, 4, 6].map((n) => apartmentBand(n, null))).toEqual([null, 'br1', 'br2', 'br3plus', 'br3plus', 'br3plus'])
    // A serviced flat, a penthouse or an officetel is banded by its bedrooms, like an apartment with no type.
    for (const t of ['serviced', 'penthouse', 'officetel']) {
      expect([null, 1, 2, 3].map((n) => apartmentBand(n, t)), t).toEqual([null, 'br1', 'br2', 'br3plus'])
    }
  })

  it('publishes each band from its own rows, as a subset of the apartment cell', () => {
    const idx = computeRentIndex([
      ...many(MIN_CELL_N, { attributes: '{"bedrooms":"1"}' }),
      ...many(MIN_CELL_N, { attributes: '{"bedrooms":"2"}', price: 30_000_000, areaM2: 80 }).map((r, i) => ({ ...r, price: 30_000_000 + i * 1_000_000 })),
      ...many(3, { attributes: '{"bedrooms":"4"}', areaM2: 150 }),
      ...many(2, { attributes: null, areaM2: 200 }),
      ...many(MIN_CELL_N, { subcategorySlug: 'house-rental', attributes: '{"bedrooms":"1"}', areaM2: 300 }),
    ])
    const d1 = idx.districts.find((d) => d.slug === 'd1')!
    expect(d1.cells.apartment.n).toBe(25)
    expect(d1.bands.br1).toMatchObject({ n: 10, median: 5_500_000 })
    expect(d1.bands.br2).toMatchObject({ n: 10, median: 34_500_000 })
    expect(d1.bands.br3plus).toMatchObject({ n: 3, median: null })
    expect(d1.bands.studio).toMatchObject({ n: 0, median: null })
    expect(idx.cityBands.br1.n).toBe(10)
  })
})

/**
 * ⛔ RULES v5 — A STUDIO OR DUPLEX ROOM IS ITS OWN BAND (2026-10-21). GoPlus files its Studio and Duplex rooms as
 * bedrooms '1' plus `aptType` (goplus-listing.ts UNIT_LABEL), and on 20 October they were 2,377 of the 2,516 rows in
 * the 1-bedroom band. These pin what the band holds, and that `br1` is a one-bedroom flat again.
 */
describe('computeRentIndex — the studio band (rules v5)', () => {
  /** The facet JSON GoPlus stores for each unit type (goplus-listing.ts UNIT_LABEL), and a member's posts. */
  const GOPLUS_STUDIO = '{"bedrooms":"1","aptType":"studio"}'
  const GOPLUS_DUPLEX = '{"bedrooms":"1","aptType":"duplex"}'
  const GOPLUS_1BR = '{"bedrooms":"1","aptType":"serviced"}'

  it('reads the stored type exactly — never trimmed, re-cased or guessed — and nothing unreadable', () => {
    expect(apartmentType(GOPLUS_STUDIO)).toBe('studio')
    expect(apartmentType('{"aptType":"duplex"}')).toBe('duplex')
    expect(apartmentType('{"aptType":"Studio"}')).toBe('Studio')
    expect(apartmentType('{"aptType":" studio"}')).toBe(' studio')
    for (const bad of [null, '', '{}', 'not json', '[]', '{"aptType":1}', '{"aptType":null}', '{"aptType":["studio"]}', '{"bedrooms":"1"}']) {
      expect(apartmentType(bad), String(bad)).toBeNull()
    }
    expect(STUDIO_APT_TYPES).toEqual(['studio', 'duplex'])
  })

  it('is a Studio or Duplex stored with one bedroom, or a stored 0 — and only those', () => {
    for (const t of STUDIO_APT_TYPES) {
      expect([0, 1].map((n) => apartmentBand(n, t)), t).toEqual(['studio', 'studio'])
      // ⚠️ Any other count keeps the band it gives: a three-bedroom duplex flat is not a studio, and a type with no
      // count is no more a studio than a missing count is (a portal's "Duplex" may be a family flat).
      expect([null, 2, 3, 6].map((n) => apartmentBand(n, t)), t).toEqual([null, 'br2', 'br3plus', 'br3plus'])
    }
    // The post form's "Studio" bedrooms chip stores '0': a studio whatever the type says, or with none.
    expect([null, 'serviced', 'penthouse'].map((t) => apartmentBand(0, t))).toEqual(['studio', 'studio', 'studio'])
    // The chips' own values only, exactly as stored: a hand-typed "Studio" is not a studio here, as it is not to the filter.
    expect(['Studio', ' studio', 'studio ', 'STUDIO', 'Duplex', 'loft', ''].map((t) => apartmentBand(1, t))).toEqual(Array(7).fill('br1'))
  })

  it('takes GoPlus\'s Studio and Duplex rooms out of the 1-bedroom band, which keeps its serviced one-bedroom flats', () => {
    const idx = computeRentIndex([
      ...many(MIN_CELL_N, { attributes: GOPLUS_STUDIO }),
      ...many(MIN_CELL_N, { attributes: GOPLUS_DUPLEX, areaM2: 60 }),
      ...many(MIN_CELL_N, { attributes: GOPLUS_1BR, areaM2: 90 }).map((r, i) => ({ ...r, price: 7_000_000 + i * 100_000 })),
    ])
    const d1 = idx.districts.find((d) => d.slug === 'd1')!
    expect(d1.bands.studio).toMatchObject({ n: 20, median: 5_500_000 })
    expect(d1.bands.br1).toMatchObject({ n: 10, median: 7_450_000 })
    expect(idx.cityBands.studio.n).toBe(20)
    expect(idx.cityBands.br1.n).toBe(10)
    // The all-sizes figure still counts every apartment, studios included: v5 moved no row out of it.
    expect(d1.cells.apartment.n).toBe(30)
    expect(idx.cityWide.apartment.n).toBe(30)
  })

  it('puts no row in two bands, and every banded row inside the apartment cell', () => {
    const shapes = [GOPLUS_STUDIO, GOPLUS_DUPLEX, GOPLUS_1BR, '{"bedrooms":"0"}', '{"bedrooms":"2","aptType":"duplex"}',
      '{"bedrooms":"3","aptType":"studio"}', '{"aptType":"studio"}', '{"aptType":"penthouse"}', null, '{"bedrooms":"6"}']
    const rows = shapes.flatMap((a, k) => many(3, { attributes: a, areaM2: 40 + k * 10 }))
    const idx = computeRentIndex(rows)
    const bandN = APARTMENT_BANDS.reduce((sum, b) => sum + idx.cityBands[b].n, 0)
    // Three shapes have no band: a Studio with no count, a penthouse with no count, and no facets at all.
    expect(bandN).toBe(idx.cityWide.apartment.n - 3 * 3)
    expect(idx.cityBands).toMatchObject({
      studio: { n: 3 * 3 }, // Studio · Duplex (each with '1') · a stored 0
      br1: { n: 3 },
      br2: { n: 3 }, // the two-bedroom duplex
      br3plus: { n: 3 * 2 }, // the "three-bedroom studio" keeps its count's band; the six-bedroom flat
    })
  })

  it('bands apartments only: a house or a room filed as a studio is not banded', () => {
    const idx = computeRentIndex([
      row({ subcategorySlug: 'house-rental', attributes: GOPLUS_STUDIO }),
      row({ subcategorySlug: 'room-rental', attributes: '{"bedrooms":"0","aptType":"studio"}', areaM2: 31 }),
    ])
    expect(idx.used).toBe(2)
    for (const b of APARTMENT_BANDS) expect(idx.cityBands[b].n, b).toBe(0)
  })
})

describe('computeRentIndex — rounding', () => {
  it('publishes whole thousands of đồng, never an interpolated …999', () => {
    const idx = computeRentIndex(many(MIN_CELL_N).map((r, i) => ({ ...r, price: 12_000_000 + i * 99_999, areaM2: 37 })))
    const cell = idx.cityWide.apartment
    for (const v of [cell.median, cell.p25, cell.p75, cell.medianPerM2]) expect(v! % 1_000).toBe(0)
    expect(cell.median).toBe(12_450_000) // 12,449,995.5 before rounding
  })

  it('rounds for display in 100,000 ₫ steps', () => {
    expect(roundForDisplay(15_437_000)).toBe(15_400_000)
    expect(roundForDisplay(15_450_000)).toBe(15_500_000)
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
    // The sources are NAMED (the methodology line), never counted: a kind and a name, nothing else.
    expect(idx.sources).toEqual([{ kind: 'import', name: 'Batdongsan.com.vn' }, { kind: 'import', name: 'Nhatot.com' }])
    for (const s of idx.sources) expect(Object.keys(s).sort()).toEqual(['kind', 'name'])
  })
})

/**
 * ⛔ THE SOURCES THE PAGE NAMES ARE THE SNAPSHOT'S (owner decision 9's method fix, 2026-10-20). The methodology once
 * named five portals in a fixed sentence that went false on 16 October; now it names `index.sources`, so these pin
 * what that list may hold: the sellers of the rows the figures were COMPUTED from, and nobody else.
 */
describe('computeRentIndex — the sources it names', () => {
  const GOPLUS = 'goplus-partner-seller'
  const partners = new Map([[GOPLUS, 'GoPlus']])
  const at = new Date('2026-10-20T00:00:00Z')

  it('names the sellers of the counted rows only — never one whose rows a rule left out', () => {
    const idx = computeRentIndex([
      row(), // Nhatot.com, counted
      row({ sellerId: GOPLUS, areaM2: 31 }), // the partner, counted
      row({ sellerId: 'some-member', areaM2: 32 }), // a member's own post, counted
      row({ sellerId: BDS, priceUnit: 'VND', listingType: 'wanted' }), // a renter's post: not counted
      row({ sellerId: 'muaban-net-import-seller-0001', subcategorySlug: 'office-rental' }), // not a home
      row({ sellerId: 'honeycomb-import-seller-0001', currency: '$' }), // not in đồng
    ], new Map(), at, partners)
    expect(idx.used).toBe(3)
    expect(idx.sources).toEqual([{ kind: 'import', name: 'Nhatot.com' }, { kind: 'partner', name: 'GoPlus' }, { kind: 'members' }])
  })

  it("leaves out a seller whose only row was merged into another seller's as a cross-post", () => {
    const a = row({ price: 15_000_000, areaM2: 70, district: 'Quận 7' })
    const b = { ...a, id: 'bds-twin', sellerId: BDS, priceUnit: 'VND' }
    const idx = computeRentIndex([a, b], new Map([[a.id, SHOTS], [b.id, SHOTS]]), at)
    expect(idx.excluded.crossPosted).toBe(1)
    expect(idx.sources).toEqual([{ kind: 'import', name: 'Nhatot.com' }])
  })

  it('names each source once, imports then partners then members, by name — whatever order the rows come in', () => {
    const rows = [
      row({ sellerId: 'member-b', areaM2: 40 }), row({ sellerId: GOPLUS, areaM2: 41 }), row({ sellerId: 'zz-partner', areaM2: 42 }),
      row({ sellerId: 'member-a', areaM2: 43 }), row({ areaM2: 44 }), row({ sellerId: BDS, priceUnit: 'VND', areaM2: 45 }),
      row({ sellerId: GOPLUS, areaM2: 46 }), row({ areaM2: 47 }),
    ]
    const both = new Map([...partners, ['zz-partner', 'Another Partner']])
    const want = [
      { kind: 'import', name: 'Batdongsan.com.vn' }, { kind: 'import', name: 'Nhatot.com' },
      { kind: 'partner', name: 'Another Partner' }, { kind: 'partner', name: 'GoPlus' }, { kind: 'members' },
    ]
    expect(computeRentIndex(rows, new Map(), at, both).sources).toEqual(want)
    expect(computeRentIndex([...rows].reverse(), new Map(), at, both).sources).toEqual(want)
  })

  it('names nothing when nothing is counted', () => {
    expect(computeRentIndex([], new Map(), at, partners).sources).toEqual([])
    expect(computeRentIndex([row({ listingType: 'wanted' })], new Map(), at, partners).sources).toEqual([])
  })

  it('takes an import storefront\'s name from the code, never from the partner map, and a stranger is a member', () => {
    expect(rentSources([NHATOT], new Map([[NHATOT, 'Not Nhatot']]))).toEqual([{ kind: 'import', name: 'Nhatot.com' }])
    // Without the loader's map (a test, a snapshot computed elsewhere) a partner reads as a member — never as an import.
    expect(rentSources([GOPLUS], new Map())).toEqual([{ kind: 'members' }])
  })

  it('keeps a partner with no stored name a partner — never relabelled a member', () => {
    expect(rentSources([GOPLUS, 'some-member'], new Map([[GOPLUS, '']]))).toEqual([{ kind: 'partner', name: '' }, { kind: 'members' }])
  })
})

describe('IMPORT_SOURCE_NAME', () => {
  /** Where each rental importer pins its storefront's id and name — it refuses to write into one named otherwise. */
  const PINNED: Record<(typeof RENTAL_IMPORT_SELLERS)[number], string> = {
    'bds-vn-import-seller-0001': 'scripts/import-batdongsan-rentals.ts',
    'cmub0wead0000zrq418bqq27m': 'scripts/import-rever-rentals.ts',
    'nhatot-import-seller-0001': 'src/lib/nhatot-listing.ts',
    'muaban-net-import-seller-0001': 'scripts/muaban-net-map.ts',
    'honeycomb-import-seller-0001': 'src/lib/honeycomb-listing.ts',
  }

  it("is each rental importer's own storefront name, for every rental importer", () => {
    expect(Object.keys(IMPORT_SOURCE_NAME).sort()).toEqual([...RENTAL_IMPORT_SELLERS].sort())
    for (const id of RENTAL_IMPORT_SELLERS) {
      const src = readFileSync(PINNED[id], 'utf8')
      expect(src, PINNED[id]).toMatch(new RegExp(`SELLER_ID = '${id}'`))
      const pinned = src.match(/SELLER_NAME = '([^']+)'/)?.[1]
      expect(IMPORT_SOURCE_NAME[id], PINNED[id]).toBe(pinned)
    }
  })
})

describe('rentIndexCsv', () => {
  it('neutralises a text field a spreadsheet would run as a formula', () => {
    const idx = computeRentIndex([], new Map(), new Date('2026-09-27T00:00:00Z'))
    idx.districts.push({ slug: 'x', name: 'x', nameEn: '=HYPERLINK("x")', partOf: null, total: 0, cells: idx.cityWide, bands: idx.cityBands })
    expect(rentIndexCsv(idx)).toContain(`,district,x,"'=HYPERLINK(""x"")",`)
  })

  it('emits the header, city and district rows from the same object', () => {
    const idx = computeRentIndex(many(MIN_CELL_N), new Map(), new Date('2026-09-27T00:00:00Z'))
    const lines = rentIndexCsv(idx).trimEnd().split('\r\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(CSV_COLUMNS.at(-1)).toBe('rules_version')
    // (3 types + 4 apartment bands) × (city + d1)
    expect(lines).toHaveLength(1 + 7 * 2)
    const d1Apartment = lines.find((l) => l.includes(',district,d1,') && l.includes(',apartment,'))!
    expect(d1Apartment.startsWith('2026-09-27T00:00:00.000Z,district,d1,District 1,,apartment,10,5500000,3250000,7750000,10,')).toBe(true)
    expect(d1Apartment.endsWith(`,${RENT_INDEX_RULES_VERSION}`)).toBe(true)
    // many() rows are two-bedroom: the 2-bedroom band row carries them, the others are empty.
    expect(lines.find((l) => l.includes(',district,d1,') && l.includes(`,${BAND_CSV_TYPE.br2},`))).toContain(`,${BAND_CSV_TYPE.br2},10,5500000,`)
    expect(lines.find((l) => l.includes(',city,') && l.includes(`,${BAND_CSV_TYPE.br1},`))).toMatch(/,apartment_1br,0,,,,0,,5$/)
    expect(lines.find((l) => l.includes(',city,') && l.includes(`,${BAND_CSV_TYPE.studio},`))).toMatch(/,apartment_studio,0,,,,0,,5$/)
    // A suppressed cell keeps its n and leaves the statistics empty.
    expect(lines.find((l) => l.includes(',city,') && l.includes(',house,'))).toMatch(/,house,0,,,,0,,5$/)
    // The header is the one it was under v3: v4 and v5 moved the number, never a column (the CSV route is unchanged).
    expect(lines[0]).toBe('snapshot_utc,scope,district_slug,district_name,part_of,type,n,median_vnd_month,p25_vnd_month,p75_vnd_month,n_with_area,median_vnd_per_m2_month,rules_version')
    // Every row says which rules made it.
    for (const l of lines.slice(1)) expect(l.split(',').at(-1)).toBe(String(RENT_INDEX_RULES_VERSION))
  })

  /**
   * ⛔ v5 ADDS A ROW TYPE AND MOVES NO EXISTING ROW. Each scope's block keeps the six rows every earlier file had, in
   * their order, with `apartment_studio` appended after them; the first data row is still the city's all-apartment row
   * (infra/vn-node/eno-warmup.sh reads the snapshot and `rules_version` from it).
   */
  it('appends the studio row to each scope, after the six rows of every earlier file', () => {
    const studios = many(MIN_CELL_N, { attributes: '{"bedrooms":"1","aptType":"studio"}' })
    const idx = computeRentIndex([...many(MIN_CELL_N, { areaM2: 80 }), ...studios], new Map(), new Date('2026-10-21T00:00:00Z'))
    const types = rentIndexCsv(idx).trimEnd().split('\r\n').slice(1).map((l) => l.split(',').slice(1, 6).join(','))
    const block = ['apartment', 'house', 'room', 'apartment_1br', 'apartment_2br', 'apartment_3plus_br', 'apartment_studio']
    expect(types).toEqual([
      ...block.map((t) => `city,all,Ho Chi Minh City,,${t}`),
      ...block.map((t) => `district,d1,District 1,,${t}`),
    ])
    const studioRow = rentIndexCsv(idx).split('\r\n').find((l) => l.includes(',city,') && l.includes(',apartment_studio,'))!
    expect(studioRow).toContain(',apartment_studio,10,5500000,')
    // Every band is in the file exactly once per scope, whatever order the page shows them in.
    expect([...CSV_BAND_ORDER].sort()).toEqual([...APARTMENT_BANDS].sort())
    expect(new Set(Object.values(BAND_CSV_TYPE)).size).toBe(APARTMENT_BANDS.length)
  })
})

/**
 * ⛔ THE RULES ARE VERSIONED, SO THIS FAILS WHEN ONE MOVES WITHOUT THE VERSION (SEO wave B, R1).
 * `RENT_INDEX_RULE_INPUTS` holds every constant a rule reads plus each curated district's spellings,
 * which `assignDistrict` reads — D0 moving Thảo Điền into `d2` changed published rows with no rule
 * constant changing. If this fails: bump RENT_INDEX_RULES_VERSION, say in the page's methodology what
 * changed, and pin both numbers below.
 * ⚠️ v4 KEPT v3's FINGERPRINT ('63023d4c6c71ba50') ON PURPOSE: it moved no rule — it marked the 16 October 2026 source
 * change (rent-index.ts says why). A version may move without its inputs; the inputs may never move without it.
 * ⛔ v5 MOVES IT, BECAUSE v5 IS A RULE: the studio band (its types at one bedroom, the stored 0) and the band list.
 */
describe('the rules fingerprint', () => {
  it('is pinned to rules version 5 — the studio band', () => {
    const fingerprint = createHash('sha256').update(JSON.stringify(RENT_INDEX_RULE_INPUTS)).digest('hex').slice(0, 16)
    expect({ version: RENT_INDEX_RULES_VERSION, fingerprint }).toEqual({ version: 5, fingerprint: '4e4e903033f3d78c' })
  })

  it('covers the studio rule — its types at one bedroom and the stored 0 — and the band list', () => {
    expect(RENT_INDEX_RULE_INPUTS.studio).toEqual({ aptTypes: ['studio', 'duplex'], withBedrooms: 1, zeroBedrooms: 'studio' })
    expect(RENT_INDEX_RULE_INPUTS.bands).toEqual(['studio', 'br1', 'br2', 'br3plus'])
  })

  it('types exactly the shared list of home subcategories, less the ones named as not indexed', () => {
    const indexed = HOME_RENTAL_SUBCATS.filter((s) => !(NOT_INDEXED_HOMES as readonly string[]).includes(s))
    expect(Object.keys(RENT_INDEX_RULE_INPUTS.types).sort()).toEqual([...indexed].sort())
    // Serviced apartments are homes on the pages (owner O-45) but stay out of the v3 figures.
    expect(NOT_INDEXED_HOMES).toEqual(['homestay-serviced'])
  })

  it('covers the curated spellings, Thảo Điền in d2 among them', () => {
    const d2 = RENT_INDEX_RULE_INPUTS.districts.find((d) => d.slug === 'd2')!
    expect(d2.match).toContain('Thảo Điền')
  })
})
