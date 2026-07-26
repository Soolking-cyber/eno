import { describe, expect, it } from 'vitest'
import { findPlace, isAlternativesName, resolvePlaceName } from './itinerary-places'

// ⚠️ THESE ARE THE REAL NAMES. All six are the actual `place` values of the only stops that exist
// in production (measured 2026-07-26 over DIRECT_URL, read-only): one itinerary, six stops, all in
// Ho Chi Minh City, and 0 of 6 carried a coordinate. Every fixture below is data, not invention —
// a test written against names I imagined would prove the resolver handles imaginary problems.
const PRODUCTION_STOPS = [
  'Independence Palace & Tao Dan Park',
  'Cuc Gach Quan',
  'Golden Dragon Water Puppet Theatre',
  'Saigon Zoo & Botanical Gardens',
  'The Deck Saigon or Binh An Village',
  'Bach Dang Wharf Park',
] as const

const CITY = 'hochiminh' as const

describe('the measured baseline', () => {
  it('confirms findPlace resolves NONE of the six whole', () => {
    // The starting point the task reports, re-derived here rather than taken on trust.
    const hits = PRODUCTION_STOPS.filter((name) => findPlace(name, CITY))
    expect(hits).toEqual([])
  })

  it('confirms exactly two become resolvable once compounds are split', () => {
    // The ceiling for compound-splitting ALONE. The other four are real venues no landmark
    // catalogue will ever hold — a restaurant, a water-puppet theatre, a wharf park — and they
    // are what the geocode-and-remember table exists for.
    const resolved = PRODUCTION_STOPS.filter((name) => resolvePlaceName(name, CITY))
    expect(resolved).toEqual([
      'Independence Palace & Tao Dan Park',
      'Saigon Zoo & Botanical Gardens',
    ])
    expect(resolved).toHaveLength(2)
  })
})

describe('joiners meaning BOTH — take the first that resolves', () => {
  it('takes the resolving half of an & compound', () => {
    const hit = resolvePlaceName('Independence Palace & Tao Dan Park', CITY)
    expect(hit).not.toBeNull()
    expect(hit!.name).toMatch(/Independence Palace/i)
  })

  it.each([
    ['ampersand', 'Independence Palace & Tao Dan Park'],
    ['plus', 'Independence Palace + Tao Dan Park'],
    ['comma', 'Independence Palace, Tao Dan Park'],
  ])('splits on %s', (_label, name) => {
    expect(resolvePlaceName(name, CITY)).not.toBeNull()
  })

  it('takes the FIRST resolving part, not merely any part', () => {
    // Both halves resolve here (they are one site). Order decides, so the result is predictable
    // rather than dependent on catalogue iteration.
    const first = resolvePlaceName('Saigon Zoo & Botanical Gardens', CITY)
    const reversed = resolvePlaceName('Botanical Gardens & Saigon Zoo', CITY)
    expect(first!.name).toMatch(/Zoo/i)
    expect(reversed!.name).toMatch(/Botanical/i)
  })

  it('skips a leading part that does not resolve', () => {
    expect(resolvePlaceName('Somewhere That Does Not Exist & Independence Palace', CITY)).not.toBeNull()
  })

  it('prefers a WHOLE-name hit over splitting it', () => {
    // A catalogued name containing a separator must not be shredded into a partial match.
    const whole = findPlace('Independence Palace', CITY)
    expect(resolvePlaceName('Independence Palace', CITY)).toEqual(whole)
  })
})

describe('"or" means ALTERNATIVES — refuse, never guess', () => {
  it('leaves the production "or" stop unmapped', () => {
    // The stop that makes this rule concrete: plotting "The Deck Saigon" states as fact a place
    // the traveller may never visit, and the map has no way to show a maybe.
    expect(resolvePlaceName('The Deck Saigon or Binh An Village', CITY)).toBeNull()
  })

  it('refuses even when a half WOULD resolve', () => {
    // The whole point: this is not a lookup failure, it is a refusal.
    expect(findPlace('Independence Palace', CITY)).not.toBeNull()
    expect(resolvePlaceName('Independence Palace or Tao Dan Park', CITY)).toBeNull()
  })

  it('refuses regardless of case', () => {
    for (const name of ['Independence Palace OR Tao Dan Park', 'Independence Palace Or Tao Dan Park']) {
      expect(resolvePlaceName(name, CITY)).toBeNull()
    }
  })

  it('refuses the Vietnamese form', () => {
    expect(resolvePlaceName('Independence Palace hoặc Tao Dan Park', CITY)).toBeNull()
  })

  it('refuses a mixed compound — one alternative anywhere taints the whole name', () => {
    expect(resolvePlaceName('Independence Palace & Tao Dan Park or Saigon Zoo', CITY)).toBeNull()
  })

  it('does NOT treat "or" inside a word as a choice', () => {
    // "Orussey", "Corner", "Doric" — the marker needs whitespace on both sides or every third
    // name would become unmappable.
    expect(isAlternativesName('Orussey Market')).toBe(false)
    expect(isAlternativesName('Corner Cafe')).toBe(false)
    expect(isAlternativesName('Independence Palace')).toBe(false)
    expect(isAlternativesName('The Deck Saigon or Binh An Village')).toBe(true)
  })
})

describe('refusing rather than approximating', () => {
  it.each(['', '   ', '&', ' , ', '+'])('returns null for %p', (name) => {
    expect(resolvePlaceName(name, CITY)).toBeNull()
  })

  it('returns null when no part resolves', () => {
    expect(resolvePlaceName('Cuc Gach Quan & Bach Dang Wharf Park', CITY)).toBeNull()
  })

  it('never resolves a single unknown name by partial luck', () => {
    for (const name of ['Cuc Gach Quan', 'Golden Dragon Water Puppet Theatre', 'Bach Dang Wharf Park']) {
      expect(resolvePlaceName(name, CITY)).toBeNull()
    }
  })

  it('a city-scoped miss does not fall back to a nationwide match', () => {
    // Inherited from findPlace and worth pinning here too: a same-named place in another province
    // would put the pin ~1000km away while looking perfectly valid.
    const inHanoi = resolvePlaceName('Independence Palace', 'hanoi')
    expect(inHanoi).toBeNull()
  })
})
