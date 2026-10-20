import { describe, expect, it } from 'vitest'
import { buildFacetTokens, facetTokenFor, facetValues, parseFacetTokens, replaceFacetTokens, sameFacetTokens } from './facet-tokens'

describe('facet tokens', () => {
  it('wraps every token in bars so a filter cannot match a prefix', () => {
    const t = buildFacetTokens({ size: ['m', 'l'] })!
    expect(t).toBe('|size:m|size:l|')
    expect(t.includes(facetTokenFor('size', 'm'))).toBe(true)
    // the trap this format exists for: `size:m` is a prefix of `size:m-l`
    expect(buildFacetTokens({ size: ['m-l'] })!.includes(facetTokenFor('size', 'm'))).toBe(false)
  })

  it('keeps two facets that share a value apart', () => {
    const t = buildFacetTokens({ size: 'free-size' })!
    expect(t.includes(facetTokenFor('shoeSize', 'free-size'))).toBe(false)
    expect(t.includes(facetTokenFor('size', 'free-size'))).toBe(true)
  })

  it('dedupes, so a re-import cannot grow the column', () => {
    expect(buildFacetTokens({ shoeSize: ['eu-44-plus', 'eu-44-plus', 'eu-44-plus'] })).toBe('|shoeSize:eu-44-plus|')
  })

  it('drops anything that is not a taxonomy slug, including a smuggled delimiter', () => {
    expect(buildFacetTokens({ size: ['m|sport:running', '', null as unknown as string] })).toBe(null)
    expect(buildFacetTokens({ 'si|ze': ['m'] })).toBe(null)
    expect(buildFacetTokens({ size: ['"m"'] })).toBe(null)
  })

  it('returns null rather than an empty pair of bars', () => {
    expect(buildFacetTokens({})).toBe(null)
    expect(buildFacetTokens({ size: [] })).toBe(null)
  })

  it('round-trips', () => {
    const t = buildFacetTokens({ size: ['m', 'l'], gender: 'men', sport: ['running', 'training'] })
    expect(parseFacetTokens(t)).toEqual([
      { key: 'size', value: 'm' }, { key: 'size', value: 'l' },
      { key: 'gender', value: 'men' },
      { key: 'sport', value: 'running' }, { key: 'sport', value: 'training' },
    ])
    expect(facetValues(t, 'size')).toEqual(['m', 'l'])
    expect(facetValues(t, 'colour')).toEqual([])
    expect(parseFacetTokens(null)).toEqual([])
  })
})

// The one public writer's token half (owner, 2026-10-20 — a seller's apartment amenities, multi-facet.ts sellerFacetTokens):
// only the named keys' tokens are replaced; every other token — a teacher's places, an importer's sizes — stays, in order.
describe('replaceFacetTokens / sameFacetTokens', () => {
  it('⛔ replaces only the named keys and keeps every other token, in its order', () => {
    const stored = '|coverArea:quan-1|amenities:pool|workIn:ho-chi-minh-city|amenities:gym|size:m|'
    expect(replaceFacetTokens(stored, ['amenities'], { amenities: ['no-landlord', 'car-alley'] }))
      .toBe('|coverArea:quan-1|workIn:ho-chi-minh-city|size:m|amenities:no-landlord|amenities:car-alley|')
    // Nothing picked: the key's tokens go, the rest stay.
    expect(replaceFacetTokens(stored, ['amenities'], { amenities: [] })).toBe('|coverArea:quan-1|workIn:ho-chi-minh-city|size:m|')
    // A key not named is never touched, even when `next` carries it.
    expect(replaceFacetTokens(stored, [], { amenities: ['wifi'] })).toBe(stored)
  })

  it('writes a new value only in the taxonomy slug shape — a smuggled delimiter is dropped', () => {
    expect(replaceFacetTokens(null, ['amenities'], { amenities: ['pool', 'x|size:m', 'a:b', '"q"', ''] })).toBe('|amenities:pool|')
  })

  it('returns null, never `||`, when nothing is left — and dedupes', () => {
    expect(replaceFacetTokens('|amenities:pool|', ['amenities'], { amenities: [] })).toBeNull()
    expect(replaceFacetTokens(null, ['amenities'], {})).toBeNull()
    expect(replaceFacetTokens(null, ['amenities'], { amenities: ['pool', 'pool'] })).toBe('|amenities:pool|')
  })

  it('compares two stored values as sets of tokens', () => {
    expect(sameFacetTokens('|amenities:pool|size:m|', '|size:m|amenities:pool|')).toBe(true)
    expect(sameFacetTokens(null, '')).toBe(true)
    expect(sameFacetTokens('|amenities:pool|', '|amenities:pool|amenities:gym|')).toBe(false)
    expect(sameFacetTokens('|amenities:pool|', null)).toBe(false)
  })
})
