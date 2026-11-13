import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Listing } from '@/generated/prisma/client'

/**
 * The listing tools' outputSchema against the REAL serializeListing (src/lib/serialize.ts), not a mock — commit review
 * 2026-11-13 (codex): the declared field types (price a number, images a string array, category an object, postedAt an
 * ISO string…) are only worth publishing if what the serializer actually emits for real rows fits them. Two rows here: a
 * full one, and the sparse shapes the schema must also admit (a job priced by salary, no district, no condition, no
 * photos, a hidden status). The column values are checked against Prisma's own `Listing` type (`satisfies`), so a column
 * added, renamed or retyped in prisma/schema.prisma breaks this file at typecheck instead of drifting silently.
 */

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))

const { serializeListing } = await import('@/lib/serialize')
const { TOOLS } = await import('./tools')

const at = new Date('2026-11-01T03:04:05.000Z')
const category = { id: 'c1', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone', color: 'blue', description: null, sortOrder: 0, createdAt: at, updatedAt: at }
const seller = {
  id: 's1', ownerId: 'p1', name: 'Shop', handle: 'shop', avatarColor: '#123456', avatarUrl: null, bio: null, location: null, phone: null,
  rating: 4.5, reviewCount: 3, verifiedSeller: false, trustTier: 'standard', trustScore: 100, responseRate: 100, responseTime: null,
  memberSince: at, affiliateDiscountCode: null, affiliateDiscountPercent: null, officialPartner: false,
  owner: { accountType: 'business' }, // exactly what tools.ts LISTING_INCLUDE selects
}
const fullRow = {
  id: 'l1', title: 'iPhone 15', titleVi: null, description: 'Mint, boxed', descriptionVi: null, price: 15_000_000, priceUnit: 'VND', currency: '₫',
  negotiable: true, previousPrice: null, affiliateUrl: null, affiliateDiscountCode: null, affiliateDiscountPercent: null, priceDropAt: null,
  lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null, location: 'Thảo Điền', district: 'Thủ Đức', city: 'Hồ Chí Minh',
  lat: 10.8, lng: 106.73, condition: 'used', images: JSON.stringify(['https://img.example/1.jpg']), video: null, categoryId: 'c1',
  subcategorySlug: 'phones', listingType: 'sell', brandSlug: 'apple', model: 'iPhone 15', sellerId: 's1', sellerTrustScore: 100, rankScore: 1,
  rankTrustComponent: null, rankDemandComponent: null, rankRecencyComponent: null, rankFormulaVersion: null, rankComputedAt: null,
  complianceStatus: 'clear', takenDownAt: null, takedownOrderId: null, externalId: 'sku-1', buildingKey: null, verified: true,
  identityHold: false, identityMarkNotice: null, verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null,
  searchText: '', facetTokens: null, status: 'active', marketPosition: null, availabilityConfirmedAt: null, soldChannel: null,
  soldToProfileId: null, soldPlatform: null, soldAt: null, salePrice: null, saleConfirmedAt: null, saleDeclinedAt: null,
  saleBuyerHistory: null, saleConfirmPromptedAt: null, postedAt: at, views: 12, savedCount: 1, featured: false, attributes: null, year: null,
  mileageKm: null, engineL: null, engineCc: null, areaM2: null, salaryM: null, contactCount: 2, createdAt: at, updatedAt: at,
} satisfies Listing
const full = { ...fullRow, category, seller }
// A job with a monthly salary (30 million VND, stored as its price) and nothing optional filled: no text, district,
// condition, photos, brand, map pin, external id or counts — and taken off the site.
const sparseRow = {
  ...fullRow, id: 'l2', title: 'English teacher', description: '', price: 30_000_000, priceUnit: 'VND/month', listingType: 'job',
  condition: null, district: null, lat: null, lng: null, images: '[]', subcategorySlug: null, brandSlug: null, model: null, salaryM: 30,
  status: 'hidden', externalId: null, views: 0, savedCount: 0, contactCount: 0,
} satisfies Listing
const sparse = { ...sparseRow, category: { ...category, id: 'c2', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }, seller }

describe('listing tools — outputSchema vs the real serializer', () => {
  for (const [label, row] of [['a full row', full], ['a sparse row', sparse]] as const) {
    const listing = serializeListing(row as never)

    it(`list_listings fits ${label}`, () => {
      const out = { listings: [listing], next_cursor: null }
      const r = TOOLS.find((t) => t.name === 'list_listings')!.output.safeParse(out)
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    })

    it(`get_listing fits ${label}`, () => {
      const r = TOOLS.find((t) => t.name === 'get_listing')!.output.safeParse({ listing })
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    })
  }

  it('every field list_listings documents is really in the serializer\'s output — none is advertised and missing', () => {
    const tool = TOOLS.find((t) => t.name === 'list_listings')!
    const schema = z.toJSONSchema(tool.output) as unknown as { properties: { listings: { items: { properties: Record<string, unknown> } } } }
    const documented = Object.keys(schema.properties.listings.items.properties)
    expect(documented.length).toBeGreaterThan(10)
    for (const row of [full, sparse]) {
      const l = serializeListing(row as never) as Record<string, unknown>
      expect(documented.filter((k) => !(k in l))).toEqual([])
    }
  })

  it('the serializer really emits the documented fields with the declared types (not just an id)', () => {
    const l = serializeListing(full as never) as Record<string, unknown>
    expect(typeof l.price).toBe('number')
    expect(Array.isArray(l.images) && (l.images as unknown[]).every((x) => typeof x === 'string')).toBe(true)
    expect(typeof (l.category as Record<string, unknown>).slug).toBe('string')
    expect(typeof l.postedAt).toBe('string')
    expect(typeof l.views).toBe('number')
    expect(typeof l.contactCount).toBe('number')
  })
})
