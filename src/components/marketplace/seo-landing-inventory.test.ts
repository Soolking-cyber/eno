import { describe, expect, it, vi } from 'vitest'
import { hasNoInventory, railFor } from './seo-landing-inventory'

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

describe('a rail switched OFF is neither queried nor "empty"', () => {
  it('rail: false → no query, no listings, and NOT the "be the first to list one" state', async () => {
    const load = vi.fn(async () => ({ listings: ['a used iPhone Duo'], known: true }))
    const r = await railFor({ rail: false }, load)
    expect(load).not.toHaveBeenCalled()
    expect(r.listings).toEqual([])
    expect(hasNoInventory(r.known, r.listings.length)).toBe(false)
  })

  it('any other page reads its rail as before', async () => {
    const load = vi.fn(async () => ({ listings: ['x'], known: true }))
    expect(await railFor({}, load)).toEqual({ listings: ['x'], known: true })
    expect(load).toHaveBeenCalledTimes(1)
  })
})
