import { describe, expect, it } from 'vitest'
import { photonUrl, toSuggestion, toSuggestions } from './geo-suggest'

// Photon answers measured on its public instance on 2026-11-12 (the same software and OpenStreetMap data as eno-photon).
const MCDONALDS = { geometry: { coordinates: [106.74157, 10.80244] }, properties: { name: "McDonald's", housenumber: '159-161', street: 'Đường Võ Nguyên Giáp', locality: 'Khu phố 4', district: 'An Khánh', city: 'Thành phố Thủ Đức', state: 'Thành phố Hồ Chí Minh', osm_key: 'amenity', osm_value: 'fast_food' } }
const STREET = { geometry: { coordinates: [106.72913, 10.80082] }, properties: { name: 'Nguyễn Văn Hưởng', locality: 'Khu phố 14', district: 'An Khánh', state: 'Thành phố Hồ Chí Minh', osm_key: 'highway', osm_value: 'secondary' } }

// Owner, 2026-11-12: "macdonalds thao dien show exact address of that place similar to shoppee address or grab".
describe('a Photon result as the picker shows it', () => {
  it('the place, then its street address, ward, city and province — no "Khu phố" block', () => {
    expect(toSuggestion(MCDONALDS)).toEqual({ title: "McDonald's", detail: '159-161 Đường Võ Nguyên Giáp, An Khánh, Thành phố Thủ Đức, Thành phố Hồ Chí Minh', lat: 10.80244, lng: 106.74157 })
  })
  it('a street is its own title; an address with no name is "number street"', () => {
    expect(toSuggestion(STREET)).toEqual({ title: 'Nguyễn Văn Hưởng', detail: 'An Khánh, Thành phố Hồ Chí Minh', lat: 10.80082, lng: 106.72913 })
    expect(toSuggestion({ geometry: { coordinates: [106.7, 10.8] }, properties: { housenumber: '12', street: 'Quốc Hương', district: 'An Khánh' } })?.title).toBe('12 Quốc Hương')
  })
  it('each name once, accents aside ("Thảo Điền" under "Thao Dien" is the same place name)', () => {
    expect(toSuggestion({ geometry: { coordinates: [106.73, 10.8] }, properties: { name: 'Thao Dien', district: 'Thảo Điền', state: 'Hồ Chí Minh' } })?.detail).toBe('Hồ Chí Minh')
  })
  it("Vietnam's islands are Vietnam: Trường Sa (Spratly) and Hoàng Sa (Paracel) results are kept", () => {
    expect(toSuggestion({ geometry: { coordinates: [114.33, 10.38] }, properties: { name: 'Đảo Trường Sa' } })).not.toBeNull()
    expect(toSuggestion({ geometry: { coordinates: [111.6, 16.5] }, properties: { name: 'Quần đảo Hoàng Sa' } })).not.toBeNull()
  })
  it('nothing outside Vietnam, nothing without a name or a point', () => {
    expect(toSuggestion({ geometry: { coordinates: [2.35, 48.85] }, properties: { name: 'Paris' } })).toBeNull()
    expect(toSuggestion({ geometry: { coordinates: [106.7, 10.8] }, properties: {} })).toBeNull()
    expect(toSuggestion({ properties: { name: 'No point' } })).toBeNull()
  })
  it('one shop that is two OpenStreetMap objects shows once; two branches far apart show twice', () => {
    expect(toSuggestions([MCDONALDS, { ...MCDONALDS, geometry: { coordinates: [106.7416, 10.8025] } }, STREET])).toHaveLength(2)
    expect(toSuggestions([MCDONALDS, { ...MCDONALDS, geometry: { coordinates: [106.7600, 10.8200] } }])).toHaveLength(2)
    // Two branches ~200 m apart on one street are two places.
    expect(toSuggestions([MCDONALDS, { ...MCDONALDS, geometry: { coordinates: [106.74157, 10.80424] } }])).toHaveLength(2)
    expect(toSuggestions('not a list')).toEqual([])
  })
})

describe('the request to eno-photon', () => {
  it("Vietnam's box, a bias toward the pin (else central Ho Chi Minh City), no bus stops, English names only in English", () => {
    const en = new URL(photonUrl('http://eno-photon:2322', 'mcdonalds thao dien', 'en', null))
    expect(en.origin + en.pathname).toBe('http://eno-photon:2322/api')
    expect(en.searchParams.get('q')).toBe('mcdonalds thao dien')
    expect(en.searchParams.get('bbox')).toBe('102,6,117.5,23.6')
    expect(en.searchParams.get('lang')).toBe('en')
    expect([en.searchParams.get('lat'), en.searchParams.get('lon')]).toEqual(['10.7769', '106.7009'])
    expect(en.searchParams.getAll('osm_tag')).toEqual(['!highway:bus_stop', '!public_transport'])
    const vi = new URL(photonUrl('http://eno-photon:2322', 'Chợ Bến Thành', 'vi', { lat: 21.0285, lng: 105.8542 }))
    expect(vi.searchParams.has('lang')).toBe(false)
    expect([vi.searchParams.get('lat'), vi.searchParams.get('lon')]).toEqual(['21.0285', '105.8542'])
  })
})
