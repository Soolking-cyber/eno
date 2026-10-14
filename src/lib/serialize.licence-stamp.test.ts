import { describe, expect, it } from 'vitest'
import { serializeListing } from './serialize'
import { licenceStampFor } from './licence-stamp'

/**
 * ⛔ THE FOUR VERIFICATION FIELDS ARE ALWAYS NULL ON THE WIRE (2026-10-14). Listing.verificationMethod / verifiedAt /
 * verifiedBy / verificationNotes hold eno's private licence stamp for an e-Visa or Legal & permits listing
 * (src/lib/licence-stamp.ts) — the approval of the provider's values and when it was given — so serializeListing sends
 * constant nulls whatever the row holds. The fields stay in the shape, so the OpenAPI Listing schema is unchanged.
 */

const V = { legalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const now = new Date('2026-10-14T03:00:00Z')

const listing = (over: Record<string, unknown> = {}) => serializeListing({
  id: 'l1', title: 'Vietnam e-Visa, 3 days', titleVi: null, descriptionVi: null, description: 'Single entry, 90 days.',
  price: 1_200_000, priceUnit: 'VND', currency: 'VND', negotiable: false, sellerId: 's-1', affiliateUrl: null,
  affiliateDiscountCode: null, affiliateDiscountPercent: null, previousPrice: null, priceDropAt: null, urgentUntil: null,
  location: 'Quận 1', district: 'Quận 1', city: 'Ho Chi Minh City', lat: null, lng: null, condition: null, images: '[]',
  video: null, categoryId: 'c-services', subcategorySlug: 'visa-legal', brandSlug: null, model: null, listingType: 'service',
  verified: true, status: 'active', postedAt: now, createdAt: now, views: 0, savedCount: 0, contactCount: 0,
  availabilityConfirmedAt: null, featured: false, year: null, mileageKm: null, engineL: null,
  attributes: JSON.stringify({ providerLegalName: V.legalName, providerLicenceNo: V.licenceNo }),
  verificationMethod: licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, V),
  verifiedAt: now,
  verifiedBy: 'admin@eno.vn',
  verificationNotes: 'licence copy in the support mailbox',
  category: { id: 'c-services', name: 'Services', nameVi: 'Dịch vụ', slug: 'services', icon: 'Wrench', color: 'cyan' },
  seller: {
    id: 's-1', name: 'VietKite', avatarColor: '#0a66c2', avatarUrl: null, rating: 0, reviewCount: 0, verifiedSeller: false,
    officialPartner: true, affiliateDiscountCode: null, affiliateDiscountPercent: null, trustTier: 'standard', trustScore: 80,
    responseRate: 0, responseTime: '', memberSince: now, ownerId: 'p-1', owner: { accountType: 'business' },
  },
  ...over,
} as unknown as Parameters<typeof serializeListing>[0])

describe('serializeListing — the verification fields', () => {
  it('are always null, even when the row holds a licence stamp, an approval time and notes', () => {
    const out = listing()
    expect(out).toMatchObject({ verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null })
    expect(JSON.stringify(out)).not.toContain('licence:v1:')
    expect(JSON.stringify(out)).not.toContain('admin@eno.vn')
  })

  it('stay in the shape (the OpenAPI Listing schema is unchanged)', () => {
    const out = listing({ verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null })
    for (const k of ['verificationMethod', 'verifiedAt', 'verifiedBy', 'verificationNotes']) expect(out, k).toHaveProperty(k, null)
  })

  it('the provider’s values themselves ride in the public attributes on purpose — the listing page prints them', () => {
    expect(listing().attributes).toMatchObject({ providerLegalName: V.legalName, providerLicenceNo: V.licenceNo })
  })
})
