import { describe, expect, it } from 'vitest'
import { areaRentCell, areaRentFor, type AreaRentRow } from './area-rent'
import { MIN_CELL_N, MONTHLY_UNIT, computeRentIndex, type RentRow } from './rent-index'

/**
 * The area rent line (src/lib/area-rent.ts): which index cell a listing is counted in, and that the line never prints a range
 * the /hcmc-rent-index page would print as a dash.
 */
let seq = 0
function row(over: Partial<AreaRentRow> = {}): AreaRentRow {
  seq += 1
  return {
    id: `l${seq}`,
    price: 4_500_000,
    priceUnit: MONTHLY_UNIT,
    currency: '₫',
    listingType: 'rent',
    subcategorySlug: 'apartment-rental',
    district: 'Gò Vấp',
    areaM2: 21,
    sellerId: `s${seq}`,
    attributes: JSON.stringify({ bedrooms: '1', aptType: 'studio' }),
    categorySlug: 'rentals',
    status: 'active',
    verified: true,
    city: 'Hồ Chí Minh',
    location: null,
    ...over,
  }
}

// Ten Gò Vấp studios at 4.0M … 4.9M: P25 4,225,000 and P75 4,675,000, printed 4.2M – 4.7M. Three two-bedroom flats
// (under MIN_CELL_N, so the 2-bedroom band prints a dash). Ten houses with a bedroom count in District 7.
const studios: RentRow[] = Array.from({ length: 10 }, (_, i) => row({ price: 4_000_000 + i * 100_000 }))
const twoBeds: RentRow[] = Array.from({ length: 3 }, () => row({ price: 9_000_000, attributes: JSON.stringify({ bedrooms: '2' }) }))
const houses: RentRow[] = Array.from({ length: 10 }, (_, i) => row({ subcategorySlug: 'house-rental', district: 'Quận 7', price: 15_000_000 + i * 1_000_000, attributes: JSON.stringify({ bedrooms: '3' }) }))
const INDEX = computeRentIndex([...studios, ...twoBeds, ...houses], new Map(), new Date('2026-11-19T00:49:00Z'))

describe('the cell is the one the index counts the listing in', () => {
  it('a GoPlus studio (1 bedroom + aptType studio) is the studio band of its district', () => {
    expect(areaRentCell(row())).toEqual({ slug: 'go-vap', type: 'apartment', band: 'studio' })
  })

  it('an apartment with no bedroom count has no band (the all-sizes cell)', () => {
    expect(areaRentCell(row({ attributes: null }))).toEqual({ slug: 'go-vap', type: 'apartment', band: null })
  })

  it.each([
    ['a per-day price', { priceUnit: 'VND/day' }],
    ['a per-hour price', { priceUnit: 'VND/hour' }],
    ['a Wanted post', { listingType: 'wanted' }],
    ['a price in dollars', { currency: 'USD' }],
    ['a house with no bedroom count (commercial)', { subcategorySlug: 'house-rental', attributes: null }],
    ['a rent under the index band', { price: 900_000 }],
    ['a serviced apartment (not in the index)', { subcategorySlug: 'homestay-serviced' }],
    ['a vehicle hire', { subcategorySlug: 'car-rental' }],
    ['a job', { categorySlug: 'jobs', listingType: 'sell' }],
    ['a sale', { categorySlug: 'property', listingType: 'sell' }],
    ['a listing outside Ho Chi Minh City', { city: 'Hà Nội' }],
    ['a listing with no district', { district: null }],
    ['a district naming two places', { district: 'Quận 1, Quận 3' }],
    ['a listing no longer live', { status: 'sold' }],
    ['an unverified listing', { verified: false }],
  ])('no cell for %s', (_, over) => {
    expect(areaRentCell(row(over as Partial<AreaRentRow>))).toBeNull()
  })
})

describe('the range is the index page\'s own', () => {
  it('prints the cell\'s P25–P75 in 100,000 ₫ steps, its count and the snapshot date', () => {
    expect(areaRentFor(row({ price: 4_450_000 }), INDEX)).toEqual({
      kind: 'studio', place: { en: 'Go Vap District', vi: 'Gò Vấp' }, low: 4_200_000, high: 4_700_000, n: 10, position: 'within', asOf: '2026-11-19T00:49:00.000Z',
    })
  })

  it('judges against the printed range, so the words match the figures', () => {
    expect(areaRentFor(row({ price: 4_150_000 }), INDEX)?.position).toBe('below')
    expect(areaRentFor(row({ price: 4_200_000 }), INDEX)?.position).toBe('within')
    expect(areaRentFor(row({ price: 4_700_000 }), INDEX)?.position).toBe('within')
    expect(areaRentFor(row({ price: 4_750_000 }), INDEX)?.position).toBe('above')
  })

  it('a house uses its district\'s house cell', () => {
    const r = areaRentFor(row({ subcategorySlug: 'house-rental', district: 'Quận 7', price: 30_000_000, attributes: JSON.stringify({ bedrooms: '4' }) }), INDEX)
    expect(r).toMatchObject({ kind: 'house', place: { en: 'District 7 (Phu My Hung)' }, n: 10, position: 'above' })
  })

  it(`no line when the band is under ${MIN_CELL_N} listings — not the all-sizes figure in its place`, () => {
    expect(INDEX.districts.find((d) => d.slug === 'go-vap')?.cells.apartment.median).not.toBeNull()
    expect(areaRentFor(row({ price: 9_000_000, attributes: JSON.stringify({ bedrooms: '2' }) }), INDEX)).toBeNull()
  })

  it('an apartment with no bedroom count gets the all-sizes apartment cell when it publishes', () => {
    expect(areaRentFor(row({ attributes: null }), INDEX)).toMatchObject({ kind: 'apartment', n: 13 })
  })

  it('no line for a district the snapshot has no row for, or for a row the index would not count', () => {
    expect(areaRentFor(row({ district: 'Quận 3' }), INDEX)).toBeNull()
    expect(areaRentFor(row({ priceUnit: 'VND/day' }), INDEX)).toBeNull()
  })
})
