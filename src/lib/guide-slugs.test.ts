import { describe, it, expect } from 'vitest'
import { PHONE_GUIDE_SLUGS, EXPAT_GUIDE_SLUGS, MARKETPLACE_GUIDE_SLUGS } from './guide-slugs'
import { PHONE_GUIDE_PATHS } from './phone-guides'
import { EXPAT_GUIDE_SLUGS as EXPAT_DERIVED, MARKETPLACE_GUIDE_SLUGS as MKT_DERIVED } from './expat-guides'

// ⛔ DRIFT GUARD (speed plan item 8). guide-slugs.ts hand-copies these so handle-format.ts can read the
// reserved guide slugs WITHOUT importing the heavy guide-content arrays (which would ship to the client).
// If a guide is added/removed/renamed, the derived `GUIDES.map(g => g.slug)` changes and these fail until
// guide-slugs.ts is updated to match. Order-insensitive — handle-format uses them as a membership set.
const sorted = (a: readonly string[]) => [...a].sort()

describe('guide-slugs literals match the derived guide arrays', () => {
  it('PHONE_GUIDE_SLUGS === phone-guides PHONE_GUIDE_PATHS', () => {
    expect(sorted(PHONE_GUIDE_SLUGS)).toEqual(sorted(PHONE_GUIDE_PATHS))
  })
  it('EXPAT_GUIDE_SLUGS === expat-guides EXPAT_GUIDE_SLUGS', () => {
    expect(sorted(EXPAT_GUIDE_SLUGS)).toEqual(sorted(EXPAT_DERIVED))
  })
  it('MARKETPLACE_GUIDE_SLUGS === expat-guides MARKETPLACE_GUIDE_SLUGS', () => {
    expect(sorted(MARKETPLACE_GUIDE_SLUGS)).toEqual(sorted(MKT_DERIVED))
  })
  it('no duplicates in any literal list', () => {
    for (const list of [PHONE_GUIDE_SLUGS, EXPAT_GUIDE_SLUGS, MARKETPLACE_GUIDE_SLUGS]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })
})
