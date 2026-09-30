import { describe, expect, it } from 'vitest'
import { facetsFor } from '@/lib/taxonomy'
import { customFilterChipLabel } from './facet-chip-label'

/**
 * E-ACTIVE (2026-09-29): an applied custom filter's chip is named by the taxonomy, never by its state
 * key — "bedrooms: 2" and "areaM2: 30-80" were printed on the result line and the saved-search receipt.
 */
const en = (e: string) => e
const vi = (_e: string, v: string) => v
const apt = facetsFor('rentals', 'apartment-rental')
const facet = (key: string) => apt.find((f) => f.key === key)

describe('customFilterChipLabel', () => {
  it('names a range by the facet and its unit, never by the column key', () => {
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-80', 'en', en)).toBe('Size 30–80 m²')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-80', 'vi', vi)).toBe('Diện tích 30–80 m²')
  })

  it('says which side of an open range is set', () => {
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-', 'en', en)).toBe('Size ≥ 30 m²')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '-80', 'en', en)).toBe('Size ≤ 80 m²')
  })

  it('groups a large range by the reader\'s language, and never a year', () => {
    const car = facetsFor('vehicles', 'car')
    const mileage = car.find((f) => f.range?.column === 'mileageKm')
    const year = car.find((f) => f.range?.column === 'year')
    if (mileage) {
      expect(customFilterChipLabel(mileage, mileage.key, '-50000', 'en', en)).toMatch(/≤ 50,000 km$/)
      expect(customFilterChipLabel(mileage, mileage.key, '-50000', 'vi', vi)).toMatch(/≤ 50\.000 km$/)
    }
    if (year) expect(customFilterChipLabel(year, year.key, '2020-', 'en', en)).toMatch(/≥ 2020$/)
  })

  it('an option that names its own unit is the whole chip; a bare one is prefixed by its facet', () => {
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '2', 'en', en)).toBe('2 BR')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '2', 'vi', vi)).toBe('2 PN')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '0', 'en', en)).toBe('Bedrooms: Studio')
    expect(customFilterChipLabel(facet('bathrooms'), 'bathrooms', '2', 'en', en)).toBe('Bathrooms: 2')
    expect(customFilterChipLabel(facet('furnishing'), 'furnishing', 'fully', 'en', en)).toBe('Furnishing: Furnished')
  })

  it('falls back to the raw pair rather than dropping a filter the taxonomy no longer describes', () => {
    expect(customFilterChipLabel(undefined, 'gone', 'x', 'en', en)).toBe('gone: x')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '99', 'en', en)).toBe('Bedrooms: 99')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', 'abc-def', 'en', en)).toBe('areaM2: abc-def')
  })

  it('no label contains a state key', () => {
    for (const f of apt) {
      const v = f.kind === 'range' ? '1-2' : f.options[0]?.value ?? ''
      if (!v) continue
      expect(customFilterChipLabel(f, f.key, v, 'en', en)).not.toContain(`${f.key}:`)
    }
  })
})
