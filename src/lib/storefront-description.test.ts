import { describe, expect, it } from 'vitest'
import { ratingPhrase, storefrontDescription, type StorefrontDescriptionInput } from './storefront-description'

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
