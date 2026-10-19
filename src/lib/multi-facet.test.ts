import { describe, expect, it } from 'vitest'
import { canonicalFacetValue, isMultiFacetKey, multiFacetValue, multiFacetValues, removeMultiFacetValue, toggleMultiFacetValue } from './multi-facet'
import { TAXONOMY, facetsFor } from './taxonomy'

/**
 * The one reading of a multi-select facet's value (amenities — GoPlus partnership, 2026-10-19). Every reader of
 * `attr_amenities` goes through these functions; what is pinned here is what the feed, the counts, the Filter panel and
 * the explorer's URL all agree on.
 */
describe('multi-facet', () => {
  it('knows the apartment amenities facet as the multi one — and no single-select facet', () => {
    expect(isMultiFacetKey('amenities')).toBe(true)
    for (const k of ['bedrooms', 'furnishing', 'aptType', 'posted', 'hasVideo', 'video', 'size']) expect(isMultiFacetKey(k)).toBe(false)
    expect(facetsFor('rentals', 'apartment-rental').find((f) => f.key === 'amenities')?.multi).toBe(true)
  })

  it('reads a comma list in TAXONOMY order, deduplicated and trimmed — one search, one value', () => {
    expect(multiFacetValues('amenities', 'car-alley,no-landlord')).toEqual(['no-landlord', 'car-alley'])
    expect(multiFacetValues('amenities', ' pets , pets,no-landlord ')).toEqual(['no-landlord', 'pets'])
    expect(multiFacetValue('amenities', ['car-alley', 'no-landlord'])).toBe('no-landlord,car-alley')
  })

  it('drops unknown parts and never errors — a list with nothing valid left is no filter', () => {
    expect(multiFacetValues('amenities', 'no-landlord,jacuzzi')).toEqual(['no-landlord'])
    expect(multiFacetValues('amenities', 'jacuzzi')).toEqual([])
    expect(multiFacetValues('amenities', '')).toEqual([])
    expect(multiFacetValues('amenities', null)).toEqual([])
    expect(multiFacetValues('amenities', 'all')).toEqual([])
    expect(multiFacetValue('amenities', ['jacuzzi'])).toBeNull()
    // A token delimiter can never ride in: only taxonomy slugs survive.
    expect(multiFacetValues('amenities', 'no-landlord|size:m')).toEqual([])
    // Not a multi key → nothing (callers read a single facet's value as given).
    expect(multiFacetValues('bedrooms', '2')).toEqual([])
  })

  it('toggles one pick in and out, the last one out clearing the facet', () => {
    expect(toggleMultiFacetValue('amenities', null, 'car-alley')).toBe('car-alley')
    expect(toggleMultiFacetValue('amenities', 'car-alley', 'no-landlord')).toBe('no-landlord,car-alley')
    expect(toggleMultiFacetValue('amenities', 'no-landlord,car-alley', 'no-landlord')).toBe('car-alley')
    expect(toggleMultiFacetValue('amenities', 'car-alley', 'car-alley')).toBeNull()
  })

  it('canonicalises a multi value and passes any other facet value through as given', () => {
    expect(canonicalFacetValue('amenities', 'car-alley,no-landlord,bogus')).toBe('no-landlord,car-alley')
    expect(canonicalFacetValue('amenities', 'bogus')).toBeNull()
    expect(canonicalFacetValue('bedrooms', '2')).toBe('2')
  })

  // Reviewer catches (2026-10-19): an active chip's ✕ must be idempotent, and "Has video" has one meaningful value.
  it('removes a pick idempotently — a ✕ delivered twice never puts it back', () => {
    expect(removeMultiFacetValue('amenities', 'no-landlord,car-alley', 'no-landlord')).toBe('car-alley')
    expect(removeMultiFacetValue('amenities', 'car-alley', 'no-landlord')).toBe('car-alley')
    expect(removeMultiFacetValue('amenities', 'car-alley', 'car-alley')).toBeNull()
    expect(removeMultiFacetValue('amenities', null, 'car-alley')).toBeNull()
  })

  it('keeps "Has video" only as its one meaningful value — anything else is no filter, so no chip', () => {
    expect(canonicalFacetValue('hasVideo', 'yes')).toBe('yes')
    expect(canonicalFacetValue('hasVideo', 'maybe')).toBeNull()
    expect(canonicalFacetValue('hasVideo', '')).toBeNull()
  })

  // A reviewer's catch (2026-10-19): `multi` is looked up BY KEY (isMultiFacetKey), so a second, single-select facet
  // that reused a multi key elsewhere in the taxonomy would have its values read as an unknown list and silently
  // dropped. Pin that no other facet shares a multi facet's key.
  it('no single-select facet anywhere shares a multi facet\'s key', () => {
    const byKey = new Map<string, boolean[]>()
    for (const c of TAXONOMY) for (const f of c.facets) byKey.set(f.key, [...(byKey.get(f.key) ?? []), !!f.multi])
    for (const [key, flags] of byKey) if (flags.some(Boolean)) expect(flags.every(Boolean), key).toBe(true)
    expect(isMultiFacetKey('amenities')).toBe(true)
  })

  it('keeps every value a token can carry — the taxonomy slug shape facetTokens accepts', () => {
    const opts = facetsFor('rentals', 'apartment-rental').find((f) => f.key === 'amenities')!.options
    for (const o of opts) expect(o.value).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    // GoPlus's two headline filters lead the chip row.
    expect(opts.slice(0, 2).map((o) => o.value)).toEqual(['no-landlord', 'car-alley'])
    // The four values the classifier wrote before 2026-10-19 keep their spelling (src/lib/apartment-classify.ts).
    for (const v of ['balcony', 'pool', 'gym', 'pets']) expect(opts.some((o) => o.value === v)).toBe(true)
  })
})
