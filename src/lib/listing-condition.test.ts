import { describe, expect, it } from 'vitest'
import { conditionWhere } from './listing-condition'

/**
 * `Listing.condition` is free text, so "used" is a three-part predicate rather than an equality
 * check, and it has TWO callers that must agree exactly — the browse feed (`feed-query.ts`, which
 * owns `?condition=`) and the SEO landing rail. seo-landing-href.ts states the invariant they
 * keep: the CTA shows exactly what the rail showed.
 */
describe('conditionWhere', () => {
  it('applies NO filter for an unrecognised value — an allow-list, not a fall-through', () => {
    // ⛔ THE REGRESSION BOTH REVIEWERS CAUGHT. The code this replaced ended in
    // `else if (condition === 'used')`, so an unknown value narrowed nothing. A signature typed to
    // the union looks total and invites `else return used`, which turns a stale link or a crawler
    // mutating params into a used-only feed that still renders a plausible page-1 count.
    for (const junk of ['refurbished', 'like_new', 'USED', 'Used', '', 'all', 'anything']) {
      expect(conditionWhere(junk), `condition=${junk} must not narrow`).toBeUndefined()
    }
    expect(conditionWhere(undefined)).toBeUndefined()
    expect(conditionWhere(null)).toBeUndefined()
  })

  it('narrows to new-ish in both languages', () => {
    expect(conditionWhere('new')).toEqual({
      OR: [
        { condition: { contains: 'new', mode: 'insensitive' } },
        { condition: { contains: 'mới', mode: 'insensitive' } },
      ],
    })
  })

  it('narrows used to "has a condition AND is not new-ish"', () => {
    // ⚠️ THE NULL GUARD IS LOAD-BEARING: without it every row that never set a condition — a
    // service, a job — counts as used merely by being not-new.
    expect(conditionWhere('used')).toEqual({
      AND: [
        { condition: { not: null } },
        {
          NOT: {
            OR: [
              { condition: { contains: 'new', mode: 'insensitive' } },
              { condition: { contains: 'mới', mode: 'insensitive' } },
            ],
          },
        },
      ],
    })
  })

  it('returns an AND-shaped object for used — which is WHY callers must not spread it', () => {
    // ⛔ THE COLLISION THIS DOCUMENTS. seo-landing.tsx builds a `where` literal that ALSO carries
    // an attribute filter shaped `{ AND: [...] }`. Spread as two top-level `AND` keys, the later
    // silently wins and one narrowing vanishes — a "Secondhand" page railing brand-new goods while
    // its CTA carried condition=used. Callers push into ONE array instead.
    expect(Object.keys(conditionWhere('used')!)).toEqual(['AND'])
  })
})
