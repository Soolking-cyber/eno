import { describe, expect, it } from 'vitest'
import { formatListingCount, liveCountFacts, liveCountWhere } from './live-count-facts'
import { seoLandingWhere } from './seo-landing-where'

describe('liveCountFacts — what a page may say about a live count', () => {
  it('formats the count for the prose language, never compacted', () => {
    expect(liveCountFacts(25502, null, 'en')?.count).toBe('25,502')
    expect(liveCountFacts(25502, null, 'vi')?.count).toBe('25.502')
    expect(formatListingCount(103969, 'en')).toBe('103,969')
    expect(formatListingCount(42, 'vi')).toBe('42')
  })

  it('claims "all in one province" only when both counts came back and agree', () => {
    expect(liveCountFacts(25502, 25502, 'en')?.allInside).toBe(true)
    // One row elsewhere and the claim goes, the same render.
    expect(liveCountFacts(25503, 25502, 'en')?.allInside).toBe(false)
    // The second count failed: a failure may only REMOVE the claim.
    expect(liveCountFacts(25502, null, 'en')?.allInside).toBe(false)
  })

  it('treats "could not count" and zero alike — the page falls back to its neutral wording', () => {
    expect(liveCountFacts(null, null, 'en')).toBeNull()
    expect(liveCountFacts(0, 0, 'en')).toBeNull()
    expect(liveCountFacts(Number.NaN, null, 'en')).toBeNull()
  })
})

describe('liveCountWhere — the rows a live count selects', () => {
  it('is the landing-rail predicate for a category, so a guide and its landing agree on a number', () => {
    expect(liveCountWhere({ categorySlug: 'furniture-appliances', condition: 'used' })).toEqual(
      seoLandingWhere({ categorySlug: 'furniture-appliances', condition: 'used' }),
    )
  })

  it('counts every public listing when no category is named', () => {
    expect(liveCountWhere({})).toEqual({ verified: true, status: 'active' })
  })

  it('adds the province as its own AND element, never spread beside an existing AND', () => {
    const w = liveCountWhere({ categorySlug: 'furniture-appliances', condition: 'used' }, 'Ho Chi Minh') as {
      AND: object[]
    }
    expect(w.AND).toHaveLength(2)
    // The condition narrowing inside the first element survives intact.
    expect(w.AND[0]).toEqual(seoLandingWhere({ categorySlug: 'furniture-appliances', condition: 'used' }))
    expect(JSON.stringify(w.AND[1])).toContain('Ho Chi Minh')
  })
})
