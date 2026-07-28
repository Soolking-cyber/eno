import { describe, expect, it } from 'vitest'
import { hasNoInventory } from './seo-landing-inventory'

describe('an empty shelf is not the same as a failed look', () => {
  it('says empty only when the query actually returned nothing', () => {
    expect(hasNoInventory(true, 0)).toBe(true)
  })

  it('⚠️ NEVER says empty when the query did not run', () => {
    // SeoLanding catches a build-time DB outage and renders the shell with listings = [].
    // If that read as "nothing is listed", a page with a hundred listings would advertise
    // "Be the first to list one" — and at revalidate = 604800 it would say so for a WEEK.
    expect(hasNoInventory(false, 0)).toBe(false)
  })

  it('says stocked whenever anything came back', () => {
    for (const n of [1, 8, 500]) expect(hasNoInventory(true, n)).toBe(false)
  })

  it('is not fooled by a count arriving without a successful query', () => {
    // Defensive: the flag is the authority, not the number.
    expect(hasNoInventory(false, 8)).toBe(false)
  })
})
