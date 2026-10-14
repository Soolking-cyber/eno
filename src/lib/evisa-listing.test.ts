import { describe, expect, it } from 'vitest'
import { isEVisaProductListing } from './evisa-listing'

// Since 2026-10-14 the e-Visa subcategory (services/visa-legal) holds e-visa listings only (legal work moved to
// legal-permits) and is open to every poster, so the SLOT alone is the test: both chips are optional, and an ordinary
// seller's unchipped e-Visa listing must not escape the checks that read this.
describe('isEVisaProductListing', () => {
  it('any listing in the e-Visa subcategory is one — with chips, without, or with a broken blob', () => {
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{"visaEntryType":"multiple","visaSpeed":"1D","providerType":"business"}' })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H' } })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{"providerType":"individual"}' })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: null })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{not json' })).toBe(true)
  })

  it('outside the subcategory nothing is — not Legal & permits, not chips elsewhere', () => {
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'legal-permits', attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'esim', attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'electronics', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: null, attributes: { visaSpeed: '1H' } })).toBe(false)
  })
})
