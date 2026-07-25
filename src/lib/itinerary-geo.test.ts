import { describe, expect, it } from 'vitest'
import { CITIES, CITY_MAP } from './itinerary-data'
import { ITINERARY_PLACES, PLACES_BY_CITY, findPlace } from './itinerary-places'
import {
  CITY_RADIUS_KM,
  DEFAULT_RADIUS_KM,
  VN_BBOX,
  distanceFromCityKm,
  isInVietnam,
  isNearCity,
} from './itinerary-geo'

// ── Coordinates that reach a map must be checked, not trusted ──────────────────────────
//
// geo.ts records why: eight of 24 live listings once sat at (0,0), and one such pin dragged
// the explorer's fitBounds across the planet, zooming every other listing into invisibility.
// Itinerary coordinates are catalog- or AI-sourced, so unlike a listing's they have never
// been seen by the person who "entered" them.
//
// The suite defends two different failures. A bbox catches nonsense — (0,0), a swapped
// lat/lng, another country. It CANNOT catch the likelier generated error, a coordinate that
// is comfortably inside Vietnam but nowhere near the city it is filed under; that is what
// isNearCity is for, and why the city centres below are themselves asserted: a wrong centre
// silently widens the gate for that entire city.

describe('isInVietnam', () => {
  it('accepts real Vietnamese coordinates from north to south', () => {
    expect(isInVietnam(21.0285, 105.8542)).toBe(true) // Hanoi
    expect(isInVietnam(16.0544, 108.2022)).toBe(true) // Da Nang
    expect(isInVietnam(10.8231, 106.6297)).toBe(true) // Ho Chi Minh City
    expect(isInVietnam(8.6833, 106.6)).toBe(true) // Con Dao, the southern island
    expect(isInVietnam(23.39, 105.32)).toBe(true) // Lung Cu, the northernmost point
  })

  it('rejects Null Island and the other zero-shaped defaults', () => {
    // The actual production incident: a missing coordinate defaulted to 0 instead of null.
    expect(isInVietnam(0, 0)).toBe(false)
    expect(isInVietnam(null, null)).toBe(false)
    expect(isInVietnam(undefined, undefined)).toBe(false)
    expect(isInVietnam(21.0285, 0)).toBe(false)
    expect(isInVietnam(0, 105.8542)).toBe(false)
    expect(isInVietnam(NaN, NaN)).toBe(false)
    expect(isInVietnam(Infinity, 105)).toBe(false)
  })

  it('rejects a SWAPPED lat/lng, which stays numeric and looks fine', () => {
    // Hanoi with its pair reversed is 105.85N — off the earth entirely, but a naive
    // `typeof === number` check accepts it and Leaflet throws.
    expect(isInVietnam(105.8542, 21.0285)).toBe(false)
    // Da Nang swapped is 108.2N — same shape of bug.
    expect(isInVietnam(108.2022, 16.0544)).toBe(false)
  })

  it('rejects places outside the envelope', () => {
    expect(isInVietnam(13.7563, 100.5018)).toBe(false) // Bangkok — west of 102E
    expect(isInVietnam(22.3193, 114.1694)).toBe(false) // Hong Kong — east of 110E
    expect(isInVietnam(1.3521, 103.8198)).toBe(false) // Singapore — south of 8N
    expect(isInVietnam(51.5074, -0.1278)).toBe(false) // London
  })

  it('DOES admit Cambodia and Laos, which is geometry and not a bug', () => {
    // Vietnam is a long S-curve wrapping Cambodia, so any axis-aligned rectangle containing
    // Vietnam also contains most of Cambodia and part of Laos. Tightening the box to exclude
    // them would cut off the Mekong Delta and the northwest. This is pinned as a TEST rather
    // than left implicit, so nobody "fixes" the bbox and quietly breaks real destinations —
    // and so it is obvious that isNearCity, not the box, is what rejects a wrong-country
    // coordinate for a city.
    expect(isInVietnam(11.5564, 104.9282)).toBe(true) // Phnom Penh
    expect(isInVietnam(17.9757, 102.6331)).toBe(true) // Vientiane
  })

  it('does not stretch east into the South China Sea', () => {
    // A box wide enough for the Spratlys stops rejecting the errors it exists to catch.
    expect(VN_BBOX.maxLng).toBeLessThan(114)
    expect(isInVietnam(10.37, 114.36)).toBe(false) // Spratly Islands
  })
})

describe('city centres (all 21)', () => {
  it('are present, valid, and inside the bbox', () => {
    expect(CITIES).toHaveLength(21)
    const bad = CITIES.filter((c) => !isInVietnam(c.lat, c.lng))
    expect(bad.map((c) => c.id)).toEqual([])
  })

  it('sit in latitude bands consistent with their declared region', () => {
    // A typo'd or copy-pasted centre usually lands in the wrong half of the country, and this
    // catches it without needing a second source for all 21. Bands overlap deliberately —
    // 'central' spans the highlands and the south-central coast.
    for (const c of CITIES) {
      if (c.region === 'north') expect(c.lat, `${c.id} lat`).toBeGreaterThan(19.5)
      if (c.region === 'south') expect(c.lat, `${c.id} lat`).toBeLessThan(12)
      if (c.region === 'central') {
        expect(c.lat, `${c.id} lat`).toBeGreaterThan(10.5)
        expect(c.lat, `${c.id} lat`).toBeLessThan(19)
      }
    }
  })

  it('are distinct — no two cities share a centre', () => {
    const keys = CITIES.map((c) => `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`)
    expect(new Set(keys).size).toBe(CITIES.length)
  })

  it('anchors a few well-known centres to within 25km of their real position', () => {
    // Spot checks against independently-known values. Loose enough that "which point counts as
    // the centre" is not the test's business, tight enough that a wrong city is caught.
    const anchors: Array<[string, number, number]> = [
      ['hanoi', 21.03, 105.85],
      ['hue', 16.46, 107.59],
      ['danang', 16.05, 108.20],
      ['hoian', 15.88, 108.34],
      ['hochiminh', 10.82, 106.63],
      ['nhatrang', 12.24, 109.20],
      ['phuquoc', 10.29, 103.98],
      ['sapa', 22.34, 103.84],
    ]
    for (const [id, lat, lng] of anchors) {
      const city = CITY_MAP.get(id as never)
      expect(city, id).toBeDefined()
      const d = distanceFromCityKm({ lat: city!.lat, lng: city!.lng }, { lat, lng })
      expect(d, `${id} is ${d}km from its expected position`).toBeLessThan(25)
    }
  })
})

describe('isNearCity', () => {
  const hanoi = CITY_MAP.get('hanoi')!
  const hcmc = CITY_MAP.get('hochiminh')!
  const hoian = CITY_MAP.get('hoian')!

  it('accepts a place genuinely in the city', () => {
    // Hoan Kiem Lake, central Hanoi.
    expect(isNearCity({ lat: 21.0287, lng: 105.8524 }, hanoi, 'hanoi')).toBe(true)
    // Ben Thanh Market, central HCMC.
    expect(isNearCity({ lat: 10.7726, lng: 106.6980 }, hcmc, 'hochiminh')).toBe(true)
  })

  it('accepts a legitimate day trip inside the city radius', () => {
    // Cu Chi tunnels, ~40km from central HCMC — a standard half-day trip, not an error.
    expect(isNearCity({ lat: 11.1436, lng: 106.4614 }, hcmc, 'hochiminh')).toBe(true)
  })

  it('REJECTS a coordinate that is in Vietnam but the wrong city — the real generated error', () => {
    // This is the case a bounding box cannot see. Ben Thanh Market (HCMC) filed under Hanoi
    // passes isInVietnam perfectly; it is ~1,140km out.
    expect(isInVietnam(10.7726, 106.698)).toBe(true)
    expect(isNearCity({ lat: 10.7726, lng: 106.698 }, hanoi, 'hanoi')).toBe(false)
    // And the mirror: a Hanoi landmark filed under Hoi An.
    expect(isNearCity({ lat: 21.0287, lng: 105.8524 }, hoian, 'hoian')).toBe(false)
  })

  it('gives a regional destination a wider radius than a compact town', () => {
    // A single global radius would either reject every Ha Giang loop stop or accept a
    // neighbouring province's coordinate for Hoi An.
    expect(CITY_RADIUS_KM.hagiang).toBeGreaterThan(CITY_RADIUS_KM.hoian)
    expect(CITY_RADIUS_KM.mekong).toBeGreaterThan(CITY_RADIUS_KM.cantho)
  })

  it('every city has a radius, or falls back to a bounded default', () => {
    for (const c of CITIES) {
      const r = CITY_RADIUS_KM[c.id] ?? DEFAULT_RADIUS_KM
      expect(r, `${c.id} radius`).toBeGreaterThan(0)
      expect(r, `${c.id} radius`).toBeLessThanOrEqual(120) // never effectively unbounded
    }
  })

  it('rejects an invalid point rather than throwing, so callers get one answer', () => {
    expect(isNearCity({ lat: 0, lng: 0 }, hanoi, 'hanoi')).toBe(false)
    expect(isNearCity({ lat: NaN, lng: NaN }, hanoi, 'hanoi')).toBe(false)
    expect(distanceFromCityKm({ lat: 0, lng: 0 }, hanoi)).toBeNull()
  })
})

// ── The catalog itself ─────────────────────────────────────────────────────────────────
//
// The two-pass curation ran OUTSIDE the repo, so these assertions are what make its output
// trustworthy in here. Every stored coordinate is re-validated against the same gates that
// produced it — otherwise a later hand-edit could drop a plausible-but-wrong pin into the
// file and nothing would notice until a traveller's map spanned the country.

describe('ITINERARY_PLACES', () => {
  it('every place is inside Vietnam', () => {
    const bad = ITINERARY_PLACES.filter((p) => !isInVietnam(p.lat, p.lng))
    expect(bad.map((p) => `${p.id} (${p.lat},${p.lng})`)).toEqual([])
  })

  it('every place is within its OWN destination radius', () => {
    // The gate that matters: a coordinate can be flawlessly Vietnamese and still belong to a
    // city 1,000km away.
    const bad = ITINERARY_PLACES.filter((p) => {
      const city = CITY_MAP.get(p.cityId)
      if (!city) return true
      return !isNearCity({ lat: p.lat, lng: p.lng }, { lat: city.lat, lng: city.lng }, p.cityId)
    })
    expect(bad.map((p) => `${p.id} → ${p.cityId}`)).toEqual([])
  })

  it('has unique ids and a known cityId on every row', () => {
    const ids = ITINERARY_PLACES.map((p) => p.id)
    expect(new Set(ids).size, 'duplicate place ids').toBe(ids.length)
    const known = new Set(CITIES.map((c) => c.id))
    expect(ITINERARY_PLACES.filter((p) => !known.has(p.cityId)).map((p) => p.id)).toEqual([])
  })

  it('carries both names on every row, so neither language renders blank', () => {
    const missing = ITINERARY_PLACES.filter((p) => !p.name.trim() || !p.nameVi.trim())
    expect(missing.map((p) => p.id)).toEqual([])
  })

  it('covers every destination — an itinerary for any city has something to map', () => {
    for (const c of CITIES) {
      const list = PLACES_BY_CITY.get(c.id) ?? []
      expect(list.length, `${c.id} has no places`).toBeGreaterThan(0)
    }
    // The catalog is meant to be genuinely useful, not a token row per city.
    expect(ITINERARY_PLACES.length).toBeGreaterThanOrEqual(200)
  })
})

describe('findPlace', () => {
  it('resolves an English name, a Vietnamese name, and ignores case and accents', () => {
    expect(findPlace('Hoan Kiem Lake')?.id).toBe('hoan-kiem-lake')
    expect(findPlace('Hồ Hoàn Kiếm')?.id).toBe('hoan-kiem-lake')
    expect(findPlace('ho hoan kiem')?.id).toBe('hoan-kiem-lake')
    expect(findPlace('HOAN KIEM LAKE')?.id).toBe('hoan-kiem-lake')
  })

  it('returns null for an unknown name rather than guessing', () => {
    // A miss must be a miss: the caller's contract is to omit the coordinate, never invent one.
    expect(findPlace('Definitely Not A Real Place 12345')).toBeNull()
    expect(findPlace('')).toBeNull()
  })

  it('does NOT fall back nationwide when a city was specified', () => {
    // This is the dangerous case. A generated itinerary for Hoi An naming a Hanoi landmark must
    // resolve to nothing — resolving it anyway would put the pin ~800km from the day's other
    // stops while looking perfectly valid.
    expect(findPlace('Hoan Kiem Lake', 'hanoi')?.id).toBe('hoan-kiem-lake')
    expect(findPlace('Hoan Kiem Lake', 'hoian')).toBeNull()
  })

  it('every resolved place is plottable, for every row in the catalog', () => {
    // Round-trip: whatever findPlace hands back must already satisfy the geo gates.
    for (const p of ITINERARY_PLACES) {
      const hit = findPlace(p.name, p.cityId)
      expect(hit, `${p.id} does not resolve by its own name`).not.toBeNull()
      expect(isInVietnam(hit!.lat, hit!.lng), `${p.id} resolved to an invalid point`).toBe(true)
    }
  })
})

describe('findPlace · the gaps codex found', () => {
  it('resolves a VIETNAMESE partial name inside a city, not just the English one', () => {
    // The scoped partial branch used to test fold(p.name) only, so a Vietnamese fragment never
    // matched even where the exact Vietnamese name did.
    const market = findPlace('Chợ Bến Thành', 'hochiminh')
    expect(market, 'exact Vietnamese name must resolve').not.toBeNull()
    expect(findPlace('chợ bến thành', 'hochiminh')?.id).toBe(market!.id)
  })

  it('gates EVERY return path, scoped included, not just the nationwide one', () => {
    // Every scoped hit must satisfy the same radius rule as a nationwide hit. Proven across the
    // whole catalog: if the scoped branch skipped the gate, a row whose stored point drifted
    // outside its radius would still resolve — and that is precisely the bug that was here.
    for (const p of ITINERARY_PLACES) {
      const scoped = findPlace(p.name, p.cityId)
      const wide = findPlace(p.name)
      for (const hit of [scoped, wide]) {
        if (!hit) continue
        const city = CITY_MAP.get(hit.cityId)!
        expect(
          isNearCity({ lat: hit.lat, lng: hit.lng }, { lat: city.lat, lng: city.lng }, hit.cityId),
          `${hit.id} resolved but is outside its own radius`,
        ).toBe(true)
      }
    }
  })

  it('refuses an ambiguous partial rather than picking one', () => {
    // Two candidates means we do not know which; a guess is a pin in the wrong part of town.
    // 'cave' matches several places in Phong Nha, so it must resolve to nothing.
    expect(findPlace('cave', 'phongnha')).toBeNull()
  })
})
