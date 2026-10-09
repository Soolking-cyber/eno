import { describe, expect, it } from 'vitest'
import { placeCoordinates } from '@/lib/geo'
import { categoryHasMap, mapPinRows } from './map-pin-rows'

/**
 * ⛔ A TEACHER IS NEVER A MAP PIN (teacher onboarding redesign, owner, 2026-10-08). A person carries no coordinates, so the
 * explorer map could only guess their home from the Listing's city / district — and the redesign's rows show how wrong
 * that guess goes (the second block below pins the facts the rule rests on).
 */
describe('mapPinRows', () => {
  const rows = [
    { id: 'flat', listingType: 'rent' },
    { id: 'jane', listingType: 'teacher' },
    { id: 'bike', listingType: 'sell' },
    { id: 'old-card' }, // a card builder that predates listingType — kept, as before
  ]
  it('drops teacher rows and keeps everything else, in order', () => {
    expect(mapPinRows(rows).map((r) => r.id)).toEqual(['flat', 'bike', 'old-card'])
  })
  it('hands back the SAME array when it drops nothing — the map\'s marker effect keys on it', () => {
    const places = rows.filter((r) => r.listingType !== 'teacher')
    expect(mapPinRows(places)).toBe(places)
  })
})

describe('why: the text fallback cannot place a teacher', () => {
  it('a teacher abroad (city \'\') would be pinned in central Saigon — as a "match" it is not', () => {
    expect(placeCoordinates('', null)).toMatchObject({ lat: 10.7769, lng: 106.7009, matched: false })
  })
  it('a province no fallback knows (Gia Lai) lands there too', () => {
    expect(placeCoordinates('Gia Lai', null).matched).toBe(false)
  })
  it('the curated District 7 name misses its district pin (the old free text "Quận 7" hit it)', () => {
    expect(placeCoordinates('Hồ Chí Minh', 'Quận 7 (Phú Mỹ Hưng)').byDistrict).toBe(false)
    expect(placeCoordinates('Hồ Chí Minh', 'Quận 7').byDistrict).toBe(true)
  })
})

describe('categoryHasMap — the one rule every map entry reads (gate review, 2026-10-09)', () => {
  it('teachers has no map; every other feed, and the unfiltered one, keeps it', () => {
    expect(categoryHasMap('teachers')).toBe(false)
    for (const c of ['rentals', 'jobs', 'services', 'electronics', '', null, undefined]) expect(categoryHasMap(c)).toBe(true)
  })
})
