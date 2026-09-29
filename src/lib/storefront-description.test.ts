import { describe, expect, it } from 'vitest'
import { ratingPhrase, storefrontDescription, storefrontPlace, type StorefrontDescriptionInput } from './storefront-description'

/**
 * The storefront meta description (SEO wave B, I2). Each case is a defect measured on production
 * before this helper existed — see the header of storefront-description.ts.
 */
const base: StorefrontDescriptionInput = {
  name: 'SDC Store',
  total: 47,
  categories: ['Electronics', 'Fashion & Beauty'],
  location: 'Hồ Chí Minh',
  trustTier: 'standard',
  reviewCount: 0,
  rating: 5, // `Seller.rating` defaults to 5: an unreviewed seller still carries it
  ownListing: true,
  siteName: 'eno.vn',
}

describe('storefrontDescription', () => {
  it('0 reviews: no star and no "reviews", although the column says 5', () => {
    const d = storefrontDescription(base)
    expect(d).not.toContain('★')
    expect(d).not.toMatch(/review/i)
    expect(d).toBe('SDC Store — 47 listings in Electronics, Fashion & Beauty · Hồ Chí Minh on eno.vn')
  })

  it('3 reviews averaging 4.67: "4.7★ from 3 reviews"; one review is singular', () => {
    expect(storefrontDescription({ ...base, reviewCount: 3, rating: 14 / 3 })).toContain('4.7★ from 3 reviews')
    expect(ratingPhrase(1, 5)).toBe('5.0★ from 1 review')
    expect(ratingPhrase(0, 4.9)).toBe('')
  })

  it('states the TOTAL, not the 60 rows the storefront loads', () => {
    const sixty = Array.from({ length: 60 }, () => 'Electronics')
    const d = storefrontDescription({ ...base, name: 'CellphoneS', total: 9726, categories: sixty })
    expect(d).toContain('9,726 listings in Electronics')
    expect(d).not.toMatch(/\b60 listings\b/)
  })

  it('every listing links out: the linked wording, and no seller-tier word', () => {
    for (const trustTier of ['trusted', 'exceptional']) {
      const d = storefrontDescription({ ...base, name: 'Nhatot.com', total: 1234, categories: ['Rentals'], trustTier, ownListing: false })
      expect(d).toBe('Nhatot.com on eno.vn: 1,234 listings in Rentals, each linking to its original page on another site')
      expect(d).not.toMatch(/trusted|top-rated/i)
      expect(d).not.toContain('Hồ Chí Minh')
    }
    expect(storefrontDescription({ ...base, total: 1, categories: ['Jobs'], ownListing: false }))
      .toBe('SDC Store on eno.vn: 1 listing in Jobs, which links to its original page on another site')
  })

  it('keeps the tier word for a seller whose stock is its own', () => {
    expect(storefrontDescription({ ...base, trustTier: 'trusted' })).toContain(' · Trusted seller on eno.vn')
    expect(storefrontDescription({ ...base, trustTier: 'exceptional' })).toContain(' · Top-rated seller on eno.vn')
  })

  it('names the edition it is rendered on: eno.forum on the forum, never a literal eno.vn', () => {
    for (const ownListing of [false, true]) {
      const d = storefrontDescription({ ...base, ownListing, siteName: 'eno.forum' })
      expect(d).toContain('eno.forum')
      expect(d).not.toContain('eno.vn')
    }
  })

  it('an empty storefront is the name and the site, never "0 listings" or the linked wording', () => {
    expect(storefrontDescription({ ...base, total: 0, categories: [], location: null, ownListing: false })).toBe('SDC Store on eno.vn')
  })

  it('no tier word without a live listing of its own, even on a trusted row (an emptied importer)', () => {
    for (const trustTier of ['trusted', 'exceptional']) {
      const d = storefrontDescription({ ...base, name: 'Nhatot.com', total: 0, categories: [], location: null, trustTier, ownListing: false })
      expect(d).toBe('Nhatot.com on eno.vn')
    }
  })
})

/** ST-META (UX program, 2026-09-29): the snippet names a district and a city, never a street. */
describe('storefrontPlace', () => {
  it('keeps the district and the city, never the street', () => {
    expect(storefrontPlace('12 Nguyen Hue, District 1, Ho Chi Minh City')).toBe('District 1, Ho Chi Minh City')
    expect(storefrontPlace('Hanoi')).toBe('Hanoi')
    expect(storefrontPlace('  ')).toBeNull()
    expect(storefrontPlace(null)).toBeNull()
  })

  it('drops parts with a house number, keeps "District 1" (codex, 2026-09-29)', () => {
    expect(storefrontPlace('12 Nguyen Hue, Ho Chi Minh City')).toBe('Ho Chi Minh City')
    expect(storefrontPlace('Số 5 Hẻm 12, Quận 1, TP. Hồ Chí Minh')).toBe('Quận 1, TP. Hồ Chí Minh')
    expect(storefrontPlace('District 1, Ho Chi Minh City')).toBe('District 1, Ho Chi Minh City')
  })

  it('is what storefrontDescription prints for the location', () => {
    const d = storefrontDescription({ ...base, location: '12 Nguyen Hue, District 1, Ho Chi Minh City' })
    expect(d).toBe('SDC Store — 47 listings in Electronics, Fashion & Beauty · District 1, Ho Chi Minh City on eno.vn')
    expect(d).not.toContain('Nguyen Hue')
    expect(storefrontDescription({ ...base, location: '12 Nguyen Hue' })).toBe('SDC Store — 47 listings in Electronics, Fashion & Beauty on eno.vn')
  })
})
