import { describe, expect, it } from 'vitest'
import { canonicalCondition, conditionChoice, conditionWhere } from './listing-condition'

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
    for (const junk of ['refurbished', 'USED', 'Used', '', 'all', 'anything']) {
      expect(conditionWhere(junk), `condition=${junk} must not narrow`).toBeUndefined()
    }
    expect(conditionWhere(undefined)).toBeUndefined()
    expect(conditionWhere(null)).toBeUndefined()
    // like_new is the "new" bucket's (owner, 2026-11-17: browse keeps two chips), so ?condition=like_new narrows like ?condition=new.
    expect(conditionWhere('like_new')).toEqual(conditionWhere('new'))
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

/** The post form's three words (owner, 2026-11-17), normalised at the three write cores. */
describe('canonicalCondition', () => {
  it.each([
    ['like_new', 'like_new'], ['Like New', 'like_new'], ['like-new', 'like_new'], ['used-like-new', 'like_new'],
    ['Used - Like New', 'like_new'], ['Như mới', 'like_new'], ['New', 'new'], ['mới', 'new'], ['Used', 'used'], ['đã dùng', 'used'],
  ])('%s → %s', (raw, value) => expect(canonicalCondition(raw)).toBe(value))

  it('keeps any other words as written, trimmed', () => {
    expect(canonicalCondition('Mới 99%')).toBe('Mới 99%')
    expect(canonicalCondition('refurbished')).toBe('refurbished')
    expect(canonicalCondition('  Insured team ')).toBe('Insured team')
  })

  it('⛔ an Object.prototype name comes back as the same string — a plain-object lookup returned a function and crashed cutText', () => {
    for (const k of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const out = canonicalCondition(k)
      expect(typeof out).toBe('string')
      expect(out).toBe(k)
    }
  })
})

describe('conditionChoice', () => {
  it('names the choice for a stored value, and none for the seller\'s own words', () => {
    expect(conditionChoice('like_new')?.labelVi).toBe('Như mới')
    expect(conditionChoice('used')?.label).toBe('Used')
    expect(conditionChoice('Mới 99%')).toBeUndefined()
    expect(conditionChoice(null)).toBeUndefined()
  })
})
