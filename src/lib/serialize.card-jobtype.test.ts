import { describe, expect, it } from 'vitest'
import { LISTING_CARD_SELECT, serializeListingCard } from './serialize'

/**
 * rentals-09 (2026-10-04): a job card prints "Toàn thời gian · Hà Nội" where it said "Lương: xem chi
 * tiết", so the card projection carries the job's `jobtype` facet — as ONE short slug, on jobs only.
 * The attributes JSON itself must never reach the wire.
 */
const row = (patch: Record<string, unknown>) => serializeListingCard({
  sellerId: 'eslboards-com-import-seller-0001', id: 'j1', title: 'English teacher', titleVi: null, price: 0, priceUnit: 'VND/month',
  currency: 'VND', negotiable: false, location: 'Hà Nội', district: null, city: 'Hà Nội', previousPrice: null, priceDropAt: null,
  urgentUntil: null, lat: null, lng: null, images: '[]', video: null, brandSlug: null, model: null, condition: null,
  marketPosition: null, verified: true, postedAt: new Date(), createdAt: new Date(), savedCount: 0, contactCount: 0,
  affiliateUrl: 'https://eslboards.com/x', listingType: 'job',
  attributes: JSON.stringify({ employer: 'VUS', jobtype: 'fulltime', english: 'required', source: 'ESL Boards' }),
  category: { id: 'c', name: 'Jobs', nameVi: 'Việc làm', slug: 'jobs', icon: 'Briefcase', color: 'sky' },
  seller: { trustScore: 100, officialPartner: false, ownerId: null },
  ...patch,
} as Parameters<typeof serializeListingCard>[0])

describe('serializeListingCard — jobType', () => {
  it('selects attributes for the projection', () => {
    expect(LISTING_CARD_SELECT.attributes).toBe(true)
  })

  it('projects a job\'s jobtype and a LINKED job\'s employer, and nothing else from its attributes', () => {
    const card = row({})
    expect(card.jobType).toBe('fulltime')
    // The price slot prints it when the posting gives no figure (UI climb 2026-11-09).
    expect(card.jobEmployer).toBe('VUS')
    expect(JSON.stringify(card)).not.toContain('ESL Boards')
    expect(JSON.stringify(card)).not.toContain('required')
    expect(card).not.toHaveProperty('attributes')
  })

  it("an employer's OWN job (no link) gets no employer — its slot keeps \"Salary: negotiable\"", () => {
    expect(row({ affiliateUrl: null }).jobEmployer).toBeNull()
  })

  it('the employer is one short line or nothing', () => {
    expect(row({ attributes: JSON.stringify({ employer: '  RMIT\n University  ' }) }).jobEmployer).toBe('RMIT University')
    expect(row({ attributes: JSON.stringify({ employer: 'x'.repeat(121) }) }).jobEmployer).toBeNull()
    expect(row({ attributes: JSON.stringify({ employer: 7 }) }).jobEmployer).toBeNull()
    expect(row({ attributes: '{not json' }).jobEmployer).toBeNull()
  })

  it('is null for a job with no type, junk, or unparseable attributes', () => {
    expect(row({ attributes: JSON.stringify({ employer: 'X' }) }).jobType).toBeNull()
    expect(row({ attributes: JSON.stringify({ jobtype: 7 }) }).jobType).toBeNull()
    expect(row({ attributes: '{not json' }).jobType).toBeNull()
    expect(row({ attributes: null }).jobType).toBeNull()
    expect(row({ attributes: undefined }).jobType).toBeNull()
  })

  it('is absent on every other listing, so no other card payload grows', () => {
    const card = row({ listingType: 'rent', attributes: JSON.stringify({ jobtype: 'fulltime' }) })
    expect(card).not.toHaveProperty('jobType')
  })
})
