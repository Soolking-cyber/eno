import { describe, expect, it } from 'vitest'
import { SLUG_CHARS, caption, listingUrl, opener, type PostInput } from './caption'

/**
 * THE FIRST 25 CHARACTERS ARE THE PRODUCT HERE.
 *
 * LinkedIn builds a post's URL slug from the opening of the body, and LinkedIn's domain authority is
 * far above eno.vn's — so those characters are the highest-leverage string this app publishes. The
 * failure this suite exists to prevent is not a crash: it is someone prefixing the caption with
 * "New on eno.vn:" for tidiness and silently spending the entire slug on branding.
 */
const base: PostInput = {
  id: 'abc123', title: 'Sunny 2BR near Ben Thanh', price: 12_000_000, currency: 'VND',
  location: 'Ho Chi Minh City', district: 'District 1', image: null, categoryName: 'Apartments for rent',
}

describe('social caption', () => {
  it('opens with the search phrase, not with branding', () => {
    const head = caption(base, 'linkedin').slice(0, SLUG_CHARS)
    expect(head).toBe('Apartments for rent in Di')
    // ⚠️ THE REGRESSION ASSERTION. If anyone prefixes the caption, the slug becomes the prefix.
    expect(head.toLowerCase()).not.toContain('eno')
    expect(head.toLowerCase()).not.toContain('new listing')
  })

  it('puts category before place, so the category survives the 25-char cut', () => {
    const longPlace = { ...base, district: null, location: 'Thành phố Hồ Chí Minh' }
    expect(opener(longPlace).slice(0, SLUG_CHARS)).toContain('Apartments for rent')
  })

  it('prefers an explicit keyphrase when one is set', () => {
    expect(opener({ ...base, keyphrase: 'Motorbikes for sale in Vietnam' })).toBe('Motorbikes for sale in Vietnam')
  })

  it('falls back to the bare category when there is no place', () => {
    expect(opener({ ...base, district: null, location: '' })).toBe('Apartments for rent')
  })

  it('tags the listing link per channel so attribution survives a stripped referrer', () => {
    expect(listingUrl('abc123', 'linkedin')).toContain('utm_source=linkedin')
    expect(listingUrl('abc123')).not.toContain('utm_source')
  })

  it('includes title, price and the link in the body', () => {
    const text = caption(base, 'facebook')
    expect(text).toContain('Sunny 2BR near Ben Thanh')
    expect(text).toContain('12.000.000') // vi money format — dots, not commas
    expect(text).toContain('/listings/abc123')
  })
})
