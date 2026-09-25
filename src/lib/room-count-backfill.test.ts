import { describe, expect, it } from 'vitest'
import { derivedAttributes } from '../../scripts/backfill-room-counts'

/**
 * scripts/backfill-room-counts.ts re-derives the bedroom facet (clamped at 3 until 2026-09-25) from
 * the "Bedrooms: N" fact line every imported rental carries, and adds the bathroom facet.
 */
describe('backfill-room-counts — derivedAttributes', () => {
  const desc = (beds: number | null, baths: number | null) =>
    ['Type: Apartment', 'Area: 84 m²', beds !== null ? `Bedrooms: ${beds}` : null, baths !== null ? `Bathrooms: ${baths}` : null]
      .filter(Boolean).join('\n')

  it('re-derives a clamped "3" to the real count, 6+ as "6", and adds bathrooms', () => {
    expect(derivedAttributes({ subcategorySlug: 'house-rental', attributes: '{"bedrooms":"3"}', description: desc(4, 3) }))
      .toBe('{"bedrooms":"4","bathrooms":"3"}')
    expect(derivedAttributes({ subcategorySlug: 'house-rental', attributes: '{"bedrooms":"3"}', description: desc(9, 12) }))
      .toBe('{"bedrooms":"6","bathrooms":"6"}')
  })

  it('never ADDS a bedroom value the importer chose not to store (offices, land)', () => {
    expect(derivedAttributes({ subcategorySlug: 'office-rental', attributes: null, description: desc(2, 1) })).toBeNull()
    expect(derivedAttributes({ subcategorySlug: 'room-rental', attributes: null, description: desc(1, 1) })).toBe('{"bathrooms":"1"}')
  })

  it('reads only a real fact line — not prose, not a missing or zero count', () => {
    expect(derivedAttributes({ subcategorySlug: 'apartment-rental', attributes: '{"bedrooms":"2"}', description: 'Lovely flat. Bedrooms: two, bright' }))
      .toBe('{"bedrooms":"2"}')
    expect(derivedAttributes({ subcategorySlug: 'apartment-rental', attributes: '{"bedrooms":"2"}', description: desc(2, 0) }))
      .toBe('{"bedrooms":"2"}')
  })

  it('leaves unparseable attributes alone', () => {
    expect(derivedAttributes({ subcategorySlug: 'apartment-rental', attributes: '{oops', description: desc(2, 2) })).toBeNull()
  })
})
