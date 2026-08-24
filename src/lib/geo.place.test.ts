import { describe, it, expect } from 'vitest'
import { normalizePlace, placeCoordinates, getListingCoordinates } from './geo'

// ⛔ THE REGRESSION THIS FILE EXISTS FOR. The old city table tested `city.includes('hanoi')` —
// no space — against city values that all carry one, so it matched nothing and every listing
// without a stored coordinate was pinned on Ho Chi Minh City. These are the exact strings the
// production database holds, read from `select distinct city from "Listing"` on 2026-08-24.
const REAL_CITY_VALUES = [
  'Hồ Chí Minh', 'Ho Chi Minh City', 'Ha Noi', 'Nha Trang',
  'Phu Quoc', 'Hoi An', 'Ha Tinh', 'Nghe An', 'Hai Phong',
]

describe('normalizePlace', () => {
  it('collapses spelling, spacing, case and diacritics to one key', () => {
    for (const v of ['Hà Nội', 'Ha Noi', 'ha-noi', 'HANOI', ' Hà  Nội ']) {
      expect(normalizePlace(v)).toBe('hanoi')
    }
  })

  // đ is a distinct Vietnamese letter, not a d with a mark, so NFD leaves it intact.
  it('folds đ, which Unicode decomposition does not', () => {
    expect(normalizePlace('Đà Nẵng')).toBe('danang')
  })

  it('is total — null and undefined are the empty key, never a throw', () => {
    expect(normalizePlace(null)).toBe('')
    expect(normalizePlace(undefined)).toBe('')
  })
})

describe('placeCoordinates', () => {
  it('recognises every city value the production database actually holds', () => {
    const unmatched = REAL_CITY_VALUES.filter((c) => !placeCoordinates(c).matched)
    expect(unmatched).toEqual([])
  })

  it('puts each city somewhere that is actually that city, not Saigon', () => {
    // Latitude alone separates these unambiguously; Saigon is 10.78.
    expect(placeCoordinates('Ha Noi').lat).toBeGreaterThan(20)
    expect(placeCoordinates('Hai Phong').lat).toBeGreaterThan(20)
    expect(placeCoordinates('Nha Trang').lat).toBeCloseTo(12.24, 1)
    expect(placeCoordinates('Hoi An').lat).toBeCloseTo(15.88, 1)
    expect(placeCoordinates('Ha Tinh').lat).toBeCloseTo(18.36, 1)
    expect(placeCoordinates('Phu Quoc').lng).toBeLessThan(105) // far west, Gulf of Thailand
  })

  it('reports an unknown place rather than pretending it matched', () => {
    const r = placeCoordinates('Nowhereville')
    expect(r.matched).toBe(false)
    expect(Number.isFinite(r.lat)).toBe(true) // still plottable — the fallback is deliberate
  })

  // ⚠️ 'District 1' exists in more than one city. A global district lookup would move a Da Nang
  // listing 600km south, which is exactly the class of bug this whole file is about.
  it('never lets a district drag the pin out of its own city', () => {
    const danang = placeCoordinates('Da Nang', 'District 1')
    expect(danang.lat).toBeCloseTo(16.05, 1)
  })

  it('uses a district refinement when it does belong to the city', () => {
    const tayho = placeCoordinates('Ha Noi', 'Tay Ho')
    expect(tayho.lat).toBeCloseTo(21.07, 1)
    expect(tayho.lat).not.toBeCloseTo(21.0285, 4) // not the plain city centre
  })
})

describe('getListingCoordinates', () => {
  const listing = (over: Record<string, unknown> = {}) =>
    ({ id: 'ckabc123', lat: null, lng: null, city: 'Nha Trang', district: null, ...over }) as never

  it('prefers a stored coordinate over the city table', () => {
    const c = getListingCoordinates(listing({ lat: 12.218753, lng: 109.238318 }))
    expect(c).toEqual({ lat: 12.218753, lng: 109.238318 })
  })

  // The jitter must be a pure function of the id: a pin that moved when the feed was re-sorted
  // is what the reader reported as "the locations change when I sort by price".
  it('gives the same listing the same point every time, whatever the feed order', () => {
    const a = getListingCoordinates(listing())
    const b = getListingCoordinates(listing())
    expect(a).toEqual(b)
  })

  it('places a coordinate-less Nha Trang listing in Nha Trang, not Saigon', () => {
    const c = getListingCoordinates(listing())
    expect(c.lat).toBeCloseTo(12.24, 1)
  })
})
