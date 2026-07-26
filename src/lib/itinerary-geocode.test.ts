import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The geocode cache. What matters here is not that a lookup works — it is that a WRONG lookup can
// never be remembered, because a cached coordinate is permanent by design and is never re-fetched.

const h = vi.hoisted(() => ({
  state: {
    cache: new Map<string, { lat: number; lng: number }>(),
    cacheReadThrows: false,
    cacheWriteThrows: false,
    writes: [] as Array<{ key: string; cityId: string; lat: number; lng: number; source: string }>,
    reads: 0,
    // Provider responses, keyed by provider.
    google: null as { lat: number; lng: number } | null,
    nominatim: null as { lat: number; lng: number } | null,
    googleCalls: 0,
    nominatimCalls: 0,
    googleThrows: false,
  },
}))

vi.mock('./db', () => ({
  db: {
    $queryRaw: async (_s: TemplateStringsArray, key: string, cityId: string) => {
      h.state.reads += 1
      if (h.state.cacheReadThrows) throw new Error('relation "PlaceGeocode" does not exist')
      const hit = h.state.cache.get(`${key}|${cityId}`)
      return hit ? [hit] : []
    },
    $executeRaw: async (_s: TemplateStringsArray, key: string, cityId: string, lat: number, lng: number, source: string) => {
      if (h.state.cacheWriteThrows) throw new Error('relation "PlaceGeocode" does not exist')
      h.state.writes.push({ key, cityId, lat, lng, source })
      h.state.cache.set(`${key}|${cityId}`, { lat, lng })
      return 1
    },
  },
}))

import { foldPlaceKey, geocodePlace } from './itinerary-geocode'
import { CITY_MAP } from './itinerary-data'

const HCMC = CITY_MAP.get('hochiminh')!
// A point inside Ho Chi Minh City — Ben Thanh Market.
const IN_CITY = { lat: 10.7721, lng: 106.6980 }

beforeEach(() => {
  h.state.cache.clear()
  h.state.cacheReadThrows = false
  h.state.cacheWriteThrows = false
  h.state.writes = []
  h.state.reads = 0
  h.state.google = null
  h.state.nominatim = null
  h.state.googleCalls = 0
  h.state.nominatimCalls = 0
  h.state.googleThrows = false

  vi.stubGlobal('fetch', async (url: string) => {
    const isGoogle = String(url).includes('maps.googleapis.com')
    if (isGoogle) {
      h.state.googleCalls += 1
      if (h.state.googleThrows) throw new Error('network')
      if (!h.state.google) return { ok: true, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) }
      return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: h.state.google } }] }) }
    }
    h.state.nominatimCalls += 1
    if (!h.state.nominatim) return { ok: true, json: async () => [] }
    return { ok: true, json: async () => [{ lat: String(h.state.nominatim!.lat), lon: String(h.state.nominatim!.lng) }] }
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('the gates — a wrong coordinate must never be remembered', () => {
  it('REFUSES a point outside Vietnam and caches nothing', async () => {
    // A geocoder will happily answer "Saigon Kitchen" with Portland, Oregon.
    h.state.nominatim = { lat: 45.5152, lng: -122.6784 }
    expect(await geocodePlace('Saigon Kitchen', 'hochiminh')).toBeNull()
    expect(h.state.writes).toHaveLength(0)
  })

  it('REFUSES a point in Vietnam but in the WRONG CITY, and caches nothing', async () => {
    // Hanoi is ~1150km from Ho Chi Minh City: inside the country box, nowhere near the city.
    h.state.nominatim = { lat: 21.0285, lng: 105.8542 }
    expect(await geocodePlace('Some Place', 'hochiminh')).toBeNull()
    expect(h.state.writes).toHaveLength(0)
  })

  it('accepts and remembers a point inside the city', async () => {
    h.state.nominatim = IN_CITY
    const hit = await geocodePlace('Cuc Gach Quan', 'hochiminh')
    expect(hit).toMatchObject({ lat: IN_CITY.lat, lng: IN_CITY.lng, source: 'nominatim' })
    expect(h.state.writes).toHaveLength(1)
  })

  it('gates BEFORE writing, not after — the cache can never hold a rejected point', async () => {
    // The ordering is the whole guarantee: a cached row is permanent and never re-fetched, so a
    // bad value written once would be wrong forever.
    h.state.nominatim = { lat: 21.0285, lng: 105.8542 }
    await geocodePlace('Some Place', 'hochiminh')
    expect(h.state.cache.size).toBe(0)
  })
})

describe('remembering', () => {
  it('asks a provider ONCE for a given place and city', async () => {
    h.state.nominatim = IN_CITY
    await geocodePlace('Cuc Gach Quan', 'hochiminh')
    await geocodePlace('Cuc Gach Quan', 'hochiminh')
    await geocodePlace('Cuc Gach Quan', 'hochiminh')
    expect(h.state.nominatimCalls).toBe(1)
  })

  it('treats accent and case variants as ONE remembered place', async () => {
    h.state.nominatim = IN_CITY
    await geocodePlace('Bến Thành Market', 'hochiminh')
    await geocodePlace('ben thanh market', 'hochiminh')
    await geocodePlace('BEN THANH MARKET', 'hochiminh')
    expect(h.state.nominatimCalls).toBe(1)
  })

  it('does NOT share an answer across cities', async () => {
    // "Central Market" is a different place in every city; a nationwide key would hand the second
    // traveller the first one's pin.
    h.state.nominatim = IN_CITY
    await geocodePlace('Central Market', 'hochiminh')
    h.state.nominatim = { lat: 15.8801, lng: 108.3380 } // Hoi An
    await geocodePlace('Central Market', 'hoian')
    expect(h.state.nominatimCalls).toBe(2)
    expect(h.state.writes.map((w) => w.cityId).sort()).toEqual(['hochiminh', 'hoian'])
  })

  it('reports a cache hit as such, so a caller can tell what it cost', async () => {
    h.state.nominatim = IN_CITY
    await geocodePlace('Cuc Gach Quan', 'hochiminh')
    const second = await geocodePlace('Cuc Gach Quan', 'hochiminh')
    expect(second?.source).toBe('cache')
  })
})

describe('failing soft', () => {
  it('still geocodes when the table does not exist yet', async () => {
    // True until the DDL is applied. A missing cache must cost money, not correctness.
    h.state.cacheReadThrows = true
    h.state.cacheWriteThrows = true
    h.state.nominatim = IN_CITY
    expect(await geocodePlace('Cuc Gach Quan', 'hochiminh')).toMatchObject({ lat: IN_CITY.lat })
  })

  it('falls through to the free provider when the paid one errors', async () => {
    h.state.googleThrows = true
    h.state.nominatim = IN_CITY
    expect(await geocodePlace('Cuc Gach Quan', 'hochiminh')).not.toBeNull()
  })

  it('returns null when every provider misses — an unmapped stop, not a guess', async () => {
    expect(await geocodePlace('A Place That Does Not Exist', 'hochiminh')).toBeNull()
    expect(h.state.writes).toHaveLength(0)
  })

  it('returns null for an empty name without calling a provider', async () => {
    expect(await geocodePlace('   ', 'hochiminh')).toBeNull()
    expect(h.state.nominatimCalls).toBe(0)
  })

  it('returns null for a city that is not in the catalogue', async () => {
    h.state.nominatim = IN_CITY
    expect(await geocodePlace('Somewhere', 'atlantis' as never)).toBeNull()
    expect(h.state.nominatimCalls).toBe(0)
  })
})

describe('the fold is the catalogue’s', () => {
  it('normalises the way the place catalogue does', () => {
    expect(foldPlaceKey('Bến Thành Market')).toBe('ben thanh market')
    expect(foldPlaceKey('  Đầm   Sen  ')).toBe('dam sen')
    expect(foldPlaceKey('')).toBe('')
  })
})
