import { describe, expect, it } from 'vitest'
import {
  MAX_INTERMEDIATE_WAYPOINTS, MAX_ROUTE_STOPS, dayRouteLink, stopMapsLink, type MapsStop,
} from './itinerary-maps-links'

const CITY = 'Ho Chi Minh City'
// The real production stops, so the fixtures are data rather than invention.
const MAPPED: MapsStop = { place: 'Independence Palace & Tao Dan Park', lat: 10.7772, lng: 106.6958 }
const UNMAPPED: MapsStop = { place: 'Golden Dragon Water Puppet Theatre', lat: null, lng: null }
const AMBIGUOUS: MapsStop = { place: 'The Deck Saigon or Binh An Village', lat: null, lng: null }

const paramOf = (url: string, key: string) => new URL(url).searchParams.get(key)

describe('coordinates are preferred over names', () => {
  it('sends a POINT when the stop is mapped, and no name at all', () => {
    // A name is a question Google answers with its own resolver; a point is not.
    const link = stopMapsLink(MAPPED, CITY)!
    expect(link.kind).toBe('directions')
    expect(paramOf(link.url, 'destination')).toBe('10.77720,106.69580')
    expect(link.url).not.toContain('Independence')
  })

  it('sends a qualified NAME only when there is no coordinate', () => {
    const link = stopMapsLink(UNMAPPED, CITY)!
    expect(link.kind).toBe('directions')
    expect(paramOf(link.url, 'destination')).toBe('Golden Dragon Water Puppet Theatre, Ho Chi Minh City, Vietnam')
  })

  it('prefers the point even for a name that WOULD be ambiguous', () => {
    // The ambiguity was about which place; a coordinate has already answered that.
    const link = stopMapsLink({ ...AMBIGUOUS, lat: 10.78, lng: 106.7 }, CITY)!
    expect(link.kind).toBe('directions')
    expect(paramOf(link.url, 'destination')).toBe('10.78000,106.70000')
  })

  it('uses the documented api=1 form', () => {
    expect(paramOf(stopMapsLink(MAPPED, CITY)!.url, 'api')).toBe('1')
  })
})

describe('an ambiguous name gets SEARCH, never directions', () => {
  it('offers options instead of navigating', () => {
    // Directions would make Google silently pick one and start driving — the exact bug the `or`
    // refusal prevents, reintroduced through a link.
    const link = stopMapsLink(AMBIGUOUS, CITY)!
    expect(link.kind).toBe('search')
    expect(link.reason).toBe('ambiguous')
    expect(link.url).toContain('/maps/search/')
    expect(link.url).not.toContain('/maps/dir/')
    expect(paramOf(link.url, 'query')).toBe('The Deck Saigon or Binh An Village, Ho Chi Minh City, Vietnam')
  })

  it.each([
    'A or B',
    'A OR B',
    'Independence Palace hoặc Tao Dan Park',
  ])('treats %p as a choice', (place) => {
    expect(stopMapsLink({ place, lat: null, lng: null }, CITY)!.kind).toBe('search')
  })

  it('does not mistake "or" inside a word for a choice', () => {
    expect(stopMapsLink({ place: 'Orussey Market', lat: null, lng: null }, CITY)!.kind).toBe('directions')
    expect(stopMapsLink({ place: 'Corner Cafe', lat: null, lng: null }, CITY)!.kind).toBe('directions')
  })
})

describe('an unmapped stop still gets a link', () => {
  it('is the POINT of the feature, not an edge case', () => {
    // Refusing to draw a false pin on our own map is not a reason to withhold the one tool that
    // might actually find the place.
    expect(stopMapsLink(UNMAPPED, CITY)).not.toBeNull()
  })

  it('returns null only when there is nothing at all to hand over', () => {
    expect(stopMapsLink({ place: '', lat: null, lng: null }, CITY)).toBeNull()
    expect(stopMapsLink({ place: '   ', lat: null, lng: null }, CITY)).toBeNull()
  })
})

describe('the per-day route respects the VERIFIED waypoint cap', () => {
  const many = (n: number): MapsStop[] =>
    Array.from({ length: n }, (_, i) => ({ place: `Place ${i}`, lat: 10.7 + i / 1000, lng: 106.7 }))

  it('is 3 intermediate waypoints — the mobile-browser limit from Google’s docs', () => {
    // "up to three waypoints supported on mobile browsers, and a maximum of nine waypoints
    // supported otherwise". eno is mobile-first and the Capacitor WebView is a mobile browser, so
    // nine would work on a desktop and break the primary surface.
    expect(MAX_INTERMEDIATE_WAYPOINTS).toBe(3)
    expect(MAX_ROUTE_STOPS).toBe(5)
  })

  it('emits origin + destination and no waypoints param for two stops', () => {
    const route = dayRouteLink(many(2), CITY)!
    expect(paramOf(route.url, 'waypoints')).toBeNull()
    expect(route.includedCount).toBe(2)
    expect(route.truncated).toBe(false)
  })

  it('fills waypoints exactly to the cap without truncating at the limit', () => {
    const route = dayRouteLink(many(MAX_ROUTE_STOPS), CITY)!
    expect(paramOf(route.url, 'waypoints')!.split('|')).toHaveLength(MAX_INTERMEDIATE_WAYPOINTS)
    expect(route.includedCount).toBe(MAX_ROUTE_STOPS)
    expect(route.truncated).toBe(false)
  })

  it('NEVER exceeds the cap, and SAYS it truncated', () => {
    // A URL Google rejects is worse than a shorter route; a silently shortened route is worse still.
    for (const n of [6, 9, 12, 30]) {
      const route = dayRouteLink(many(n), CITY)!
      expect(paramOf(route.url, 'waypoints')!.split('|').length).toBeLessThanOrEqual(MAX_INTERMEDIATE_WAYPOINTS)
      expect(route.includedCount).toBe(MAX_ROUTE_STOPS)
      expect(route.truncated).toBe(true)
    }
  })

  it('keeps the day’s ORDER — origin is the first stop, destination the last included', () => {
    const stops = many(3)
    const route = dayRouteLink(stops, CITY)!
    expect(paramOf(route.url, 'origin')).toBe('10.70000,106.70000')
    expect(paramOf(route.url, 'destination')).toBe('10.70200,106.70000')
  })
})

describe('the route excludes what it must not assert', () => {
  it('drops an ambiguous stop from the route and reports it', () => {
    // Inside a multi-stop route, a name Google picks bends the whole path around a place the
    // traveller never chose — and there is no UI to notice it in.
    const route = dayRouteLink([MAPPED, AMBIGUOUS, UNMAPPED], CITY)!
    expect(route.url).not.toContain('The+Deck')
    expect(route.url).not.toContain('The%20Deck')
    expect(route.skippedAmbiguous).toBe(1)
    expect(route.includedCount).toBe(2)
  })

  it('includes an unmapped-but-unambiguous stop by name', () => {
    const route = dayRouteLink([MAPPED, UNMAPPED], CITY)!
    // Read it back through the parser rather than string-matching the URL: URLSearchParams
    // form-encodes spaces as '+', which decodeURIComponent does not reverse. Asserting on the
    // decoded PARAM is both correct and what a consumer actually sees.
    expect(paramOf(route.url, 'destination')).toBe('Golden Dragon Water Puppet Theatre, Ho Chi Minh City, Vietnam')
  })

  it('returns null when fewer than two stops can be routed', () => {
    expect(dayRouteLink([MAPPED], CITY)).toBeNull()
    expect(dayRouteLink([], CITY)).toBeNull()
    // One real stop plus one that may not be asserted is not a route.
    expect(dayRouteLink([MAPPED, AMBIGUOUS], CITY)).toBeNull()
  })

  it('uses driving mode explicitly rather than leaving it to Google', () => {
    expect(paramOf(dayRouteLink(many2(), CITY)!.url, 'travelmode')).toBe('driving')
  })
})

function many2(): MapsStop[] {
  return [
    { place: 'A', lat: 10.7, lng: 106.7 },
    { place: 'B', lat: 10.71, lng: 106.71 },
  ]
}
