import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SchemaFeedRow } from './schema-feed'

/**
 * The NLWeb Schema Feed (src/lib/schema-feed.ts): the sitemap's rows minus teachers, newest first and capped, each line the
 * listing page's own JSON-LD. The fake database records the query, so deleting the teacher exclusion or the cap fails here.
 */
const h = vi.hoisted(() => ({ listings: vi.fn(), brands: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: h.listings }, brand: { findMany: h.brands }, seller: { findMany: async () => [{ id: 'teach-1' }] } } }))
vi.mock('@/lib/sitemap', () => ({ siteOrigin: () => 'https://eno.vn', submittedListingWhere: async () => ({ SUBMITTED: true }) }))
vi.mock('@/lib/edition-scope', () => ({ teacherExclusion: async () => ({ categoryId: { not: 'cat-teachers' } }) }))

import { listingJsonLd } from './listing-jsonld'
import { SCHEMA_FEED_CAP, schemaFeedBody, schemaFeedItem, schemamapXml } from './schema-feed'

const row = (o: Partial<SchemaFeedRow> = {}): SchemaFeedRow => ({
  id: 'l1', title: 'Sofa', description: '**Good** sofa', images: JSON.stringify(['https://cdn.example/x.jpg']), price: 1_500_000,
  currency: '₫', priceUnit: 'VND', listingType: 'sell', subcategorySlug: null, condition: 'used', status: 'active', sellerId: 's1',
  brandSlug: null, model: null, attributes: null, areaM2: null, district: 'Quận 1', city: 'Hồ Chí Minh',
  postedAt: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-11-01T00:00:00Z'),
  category: { slug: 'furniture', name: 'Furniture' },
  seller: { name: 'Lan', ownerId: 'u1', officialPartner: false, owner: { accountType: 'personal' } },
  ...o,
})

beforeEach(() => {
  h.listings.mockReset()
  h.brands.mockReset().mockResolvedValue([])
})

describe('schemaFeedItem', () => {
  it("is the page's own JSON-LD (listingJsonLd, the PDP's inputs) plus its url", () => {
    const item = schemaFeedItem(row(), null, 'https://eno.vn')
    const page = listingJsonLd({
      id: 'l1', url: 'https://eno.vn/listings/l1', title: 'Sofa', description: '**Good** sofa', images: ['https://cdn.example/x.jpg'],
      price: 1_500_000, currency: 'VND', priceUnit: 'VND', listingType: 'sell', categorySlug: 'furniture', categoryName: 'Furniture',
      subcategorySlug: null, condition: 'used', status: 'active', sellerId: 's1', sellerName: 'Lan', sellerHasOwner: true,
      sellerIsBusiness: false, sellerOfficialPartner: false, imported: false, isBooking: false, brandName: null,
      areaM2: null, attributes: null, district: 'Quận 1', city: 'Hồ Chí Minh', postedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(item).toEqual({ ...page, url: 'https://eno.vn/listings/l1' })
    expect(item).toMatchObject({ '@context': 'https://schema.org', '@type': 'Product', offers: { price: 1_500_000, priceCurrency: 'VND' } })
  })

  it('publishes nothing where the page publishes nothing (a job, a wanted post)', () => {
    expect(schemaFeedItem(row({ listingType: 'job' }), null, 'https://eno.vn')).toBeNull()
    expect(schemaFeedItem(row({ listingType: 'wanted' }), null, 'https://eno.vn')).toBeNull()
  })

  it('a rental is the RealEstateListing the page states; malformed images are none, not a throw', () => {
    const item = schemaFeedItem(row({
      listingType: 'rent', priceUnit: 'VND/month', subcategorySlug: 'apartment-rental', images: '{oops',
      category: { slug: 'rentals', name: 'Rentals' },
    }), null, 'https://eno.vn')
    expect(item).toMatchObject({ '@type': 'RealEstateListing', url: 'https://eno.vn/listings/l1', mainEntity: { '@type': 'Apartment' } })
    expect(item).not.toHaveProperty('image')
  })
})

describe('schemaFeedBody', () => {
  it('reads the sitemap set minus teachers, newest first, capped — and writes one JSON object per line', async () => {
    h.listings.mockResolvedValue([row({ id: 'a', brandSlug: 'ikea' }), row({ id: 'b', listingType: 'job' }), row({ id: 'c' })])
    h.brands.mockResolvedValue([{ slug: 'ikea', name: 'IKEA' }])
    const body = await schemaFeedBody()
    const q = h.listings.mock.calls[0][0]
    expect(q.where).toEqual({ AND: [{ SUBMITTED: true }, { categoryId: { not: 'cat-teachers' } },
      // a teacher's whole shop is out, as the .md twin refuses it
      { sellerId: { notIn: ['teach-1'] } }] })
    expect(q.take).toBe(SCHEMA_FEED_CAP)
    expect(q.orderBy).toEqual([{ postedAt: 'desc' }, { id: 'desc' }])
    // ⛔ No seller contact column is ever read.
    expect(Object.keys(q.select.seller.select).sort()).toEqual(['name', 'officialPartner', 'owner', 'ownerId'])
    expect(body.endsWith('\n')).toBe(true)
    const lines = body.trimEnd().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.url)).toEqual(['https://eno.vn/listings/a', 'https://eno.vn/listings/c'])
    expect(lines[0].brand).toEqual({ '@type': 'Brand', name: 'IKEA' })
  })
})

describe('schemamapXml', () => {
  it('is the spec’s sitemap-shaped Schema Map naming the one JSON Lines feed', () => {
    const xml = schemamapXml('https://eno.vn')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1">')
    expect(xml).toContain('<loc>https://eno.vn/schema-feed.jsonl</loc>')
    expect(xml).toContain('<sf:contentType>structuredData/schema.org</sf:contentType>')
  })
})
