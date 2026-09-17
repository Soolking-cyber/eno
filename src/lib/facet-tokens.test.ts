import { describe, expect, it } from 'vitest'
import { buildFacetTokens, facetTokenFor, facetValues, parseFacetTokens } from './facet-tokens'

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
