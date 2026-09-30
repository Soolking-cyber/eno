import { describe, expect, it } from 'vitest'
import { HOME_RENTAL_SUBCATS } from './rental-homes'
import { SUBCATEGORIES } from './subcategories'

describe('HOME_RENTAL_SUBCATS — the rentals that are a home (C1-HOUSING, O-45)', () => {
  it('counts serviced apartments as homes (owner decision O-45)', () => {
    expect(HOME_RENTAL_SUBCATS).toContain('homestay-serviced')
  })

  it('never counts a hotel night, an office or a shopfront as a home', () => {
    expect(HOME_RENTAL_SUBCATS).not.toContain('hotel-short-stay')
    expect(HOME_RENTAL_SUBCATS).not.toContain('office-rental')
  })

  it('names only subcategories the rentals taxonomy really has', () => {
    const real = new Set((SUBCATEGORIES.rentals ?? []).map((s) => s.slug))
    for (const slug of HOME_RENTAL_SUBCATS) expect(real.has(slug)).toBe(true)
  })
})
