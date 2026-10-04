import { describe, expect, it } from 'vitest'
import { isEVisaProductListing } from './evisa-listing'

describe('isEVisaProductListing', () => {
  it('an e-Visa product: the visa slot plus an e-Visa chip, as a JSON string or an object', () => {
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{"visaEntryType":"multiple","visaSpeed":"1D","providerType":"business"}' })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H' } })).toBe(true)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: { visaEntryType: 'single' } })).toBe(true)
  })

  it('a work-permit / tax / legal listing in the same slot is not one', () => {
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{"providerType":"business"}' })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: null })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '' } })).toBe(false)
  })

  it('chips outside the slot do not count, and a broken blob is not one', () => {
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'esim', attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'electronics', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: null, attributes: { visaSpeed: '1H' } })).toBe(false)
    expect(isEVisaProductListing({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: '{not json' })).toBe(false)
  })
})
