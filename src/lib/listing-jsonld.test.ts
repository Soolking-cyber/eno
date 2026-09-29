import { describe, expect, it } from 'vitest'
import { listingJsonLd, listingLdKind, type ListingLdInput } from './listing-jsonld'

// ─────────────────────────────────────────────────────────────────────────────
// The listing page's structured data (SEO wave B, S3). Each case below is one real shape from
// production (ids in the comments, captured 2026-09-27/29) or a CI fixture, and checks what the
// builder states about it. The sweep at the end holds the five false statements the old
// Product+Offer made to what no later edit may bring back.
// ─────────────────────────────────────────────────────────────────────────────

const URL_OF = (id: string) => `https://eno.vn/listings/${id}`

/** An own goods listing by a private seller: the fields every case starts from. */
function input(over: Partial<ListingLdInput> = {}): ListingLdInput {
  const id = over.id ?? 'l-1'
  return {
    id,
    url: URL_OF(id),
    title: 'Fixture laptop 14"',
    description: '**Specs:**\n- 16 GB RAM\n- 512 GB SSD',
    images: ['https://sb.eno.vn/storage/v1/object/public/listings/a.webp'],
    price: 18_500_000,
    currency: 'VND',
    priceUnit: 'VND',
    listingType: 'sell',
    categorySlug: 'electronics',
    categoryName: 'Electronics',
    subcategorySlug: null,
    condition: null,
    status: 'active',
    sellerId: 'seller-1',
    sellerName: 'Minh',
    sellerHasOwner: true,
    sellerIsBusiness: false,
    sellerOfficialPartner: false,
    imported: false,
    isBooking: false,
    brandName: null,
    areaM2: null,
    attributes: null,
    district: null,
    city: 'Ho Chi Minh City',
    postedAt: '2026-09-24T03:00:00.000Z',
    ...over,
  }
}

/** A portal rental (Nhatot), imported, as it is stored. */
function rental(over: Partial<ListingLdInput> = {}): ListingLdInput {
  return input({
    id: 'cmuetolf80006xbq483w2wc22',
    title: 'Apartment · 1 bed · 1 bath · 28 m² for rent — Ward 22, Bình Thạnh District',
    description: 'Listed on Nhatot.com.\nArea: 28 m²\nBedrooms: 1\nRent: 7,000,000 đ/month',
    price: 7_000_000,
    priceUnit: 'VND/month',
    listingType: 'rent',
    categorySlug: 'rentals',
    categoryName: 'Rentals',
    subcategorySlug: 'apartment-rental',
    sellerId: 'nhatot-import-seller-0001',
    sellerName: 'Nhatot.com',
    sellerHasOwner: false,
    imported: true,
    areaM2: 28,
    attributes: { bedrooms: '1', bathrooms: '1' },
    district: 'Quận Bình Thạnh',
    city: 'Hồ Chí Minh',
    ...over,
  })
}

type Node = Record<string, unknown>
const ld = (l: ListingLdInput) => listingJsonLd(l) as Node
const offersOf = (n: Node) => n.offers as Node
const entityOf = (n: Node) => n.mainEntity as Node
const refQtyOf = (offer: Node) => ((offer.priceSpecification as Node).referenceQuantity as Node)

/** Every key and every @type anywhere in a node. */
function keysAndTypes(o: unknown, keys = new Set<string>(), types = new Set<string>()) {
  if (Array.isArray(o)) o.forEach((v) => keysAndTypes(v, keys, types))
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      keys.add(k)
      if (k === '@type') types.add(String(v))
      keysAndTypes(v, keys, types)
    }
  }
  return { keys, types }
}

const LEASE_OUT = 'http://purl.org/goodrelations/v1#LeaseOut'

describe('rentals → RealEstateListing', () => {
  it('1. a Nhatot apartment: an Apartment with its size and rooms, and a monthly LeaseOut offer, and nothing a portal cannot state', () => {
    const n = ld(rental())
    expect(n['@type']).toBe('RealEstateListing')
    expect(n.url).toBe(URL_OF('cmuetolf80006xbq483w2wc22'))
    expect(n.name).toMatch(/for rent/)
    const e = entityOf(n)
    expect(e['@type']).toBe('Apartment')
    expect(e.floorSize).toEqual({ '@type': 'QuantitativeValue', value: 28, unitCode: 'MTK' })
    expect(e.numberOfBedrooms).toBe(1)
    expect(e.numberOfBathroomsTotal).toBe(1)
    expect(e.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Quận Bình Thạnh', addressRegion: 'Hồ Chí Minh', addressCountry: 'VN' })
    expect(e).not.toHaveProperty('geo')
    const o = offersOf(n)
    expect(o['@type']).toBe('Offer')
    expect(o.businessFunction).toBe(LEASE_OUT)
    expect(o.url).toBe(n.url)
    expect(o.priceCurrency).toBe('VND')
    expect(o).not.toHaveProperty('price')
    expect(o.priceSpecification).toEqual({
      '@type': 'UnitPriceSpecification', price: 7_000_000, priceCurrency: 'VND',
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
    })
    const { keys, types } = keysAndTypes(n)
    for (const k of ['seller', 'itemCondition', 'availability', 'priceValidUntil', 'datePosted', 'geo']) expect(keys.has(k), k).toBe(false)
    expect(types.has('Product')).toBe(false)
  })

  it('2. a bare "VND" is monthly from Batdongsan and Rever only; from anyone else the rental keeps no offer', () => {
    for (const sellerId of ['bds-vn-import-seller-0001', 'cmub0wead0000zrq418bqq27m']) {
      expect(refQtyOf(offersOf(ld(rental({ sellerId, priceUnit: 'VND' })))).unitCode, sellerId).toBe('MON')
    }
    const other = ld(rental({ sellerId: 'muaban-net-import-seller-0001', priceUnit: 'VND' }))
    expect(other['@type']).toBe('RealEstateListing')
    expect(other).not.toHaveProperty('offers')
  })

  it('3. the period is the stored one: VND/day → DAY, and an unknown period drops the offer', () => {
    expect(refQtyOf(offersOf(ld(rental({ priceUnit: 'VND/day' })))).unitCode).toBe('DAY')
    expect(refQtyOf(offersOf(ld(rental({ priceUnit: 'VND/week' })))).unitCode).toBe('WEE')
    expect(ld(rental({ priceUnit: 'VND/fortnight' }))).not.toHaveProperty('offers')
    expect(ld(rental({ priceUnit: 'VND/toString' }))).not.toHaveProperty('offers')
    // A rent of 0 is not a price anyone quoted.
    expect(ld(rental({ price: 0 }))).not.toHaveProperty('offers')
  })

  it('4. the "6+" bucket states a minimum; a missing count states nothing', () => {
    const six = entityOf(ld(rental({ attributes: { bedrooms: '6', bathrooms: '6' } })))
    expect(six.numberOfBedrooms).toEqual({ '@type': 'QuantitativeValue', minValue: 6 })
    // schema.org types numberOfBathroomsTotal as an Integer, so "6 or more" cannot be stated.
    expect(six).not.toHaveProperty('numberOfBathroomsTotal')
    const studio = entityOf(ld(rental({ attributes: { bedrooms: '0' } })))
    expect(studio.numberOfBedrooms).toBe(0)
    const none = entityOf(ld(rental({ attributes: null, areaM2: null })))
    expect(none).not.toHaveProperty('numberOfBedrooms')
    expect(none).not.toHaveProperty('numberOfBathroomsTotal')
    expect(none).not.toHaveProperty('floorSize')
    expect(entityOf(ld(rental({ attributes: { bedrooms: 'many' } })))).not.toHaveProperty('numberOfBedrooms')
  })

  it('5. an office and a rental with no subcategory are a Place with no floor size; short stays and vehicle hire publish nothing', () => {
    for (const subcategorySlug of ['office-rental', null, '']) {
      const e = entityOf(ld(rental({ subcategorySlug, attributes: { bedrooms: '2' } })))
      expect(e['@type'], String(subcategorySlug)).toBe('Place')
      expect(e).not.toHaveProperty('floorSize')
      expect(e).not.toHaveProperty('numberOfBedrooms')
    }
    expect(entityOf(ld(rental({ subcategorySlug: 'house-rental' })))['@type']).toBe('House')
    expect(entityOf(ld(rental({ subcategorySlug: 'room-rental' })))['@type']).toBe('Room')
    for (const subcategorySlug of ['hotel-short-stay', 'homestay-serviced', 'motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental', 'toString']) {
      expect(listingJsonLd(rental({ subcategorySlug, priceUnit: 'VND/day' })), subcategorySlug).toBeNull()
    }
  })

  it('6. the CI fixture ci-l-4: a `sell` row in rentals with the bare unit "month" is a rental, priced per month', () => {
    const n = ld(input({ id: 'ci-l-4', listingType: 'sell', categorySlug: 'rentals', categoryName: 'Rentals', priceUnit: 'month', price: 12_300_000 }))
    expect(n['@type']).toBe('RealEstateListing')
    expect(entityOf(n)['@type']).toBe('Place')
    expect(offersOf(n).businessFunction).toBe(LEASE_OUT)
    expect(refQtyOf(offersOf(n)).unitCode).toBe('MON')
    // Its own rental, so it states the date the page's "Posted" line prints.
    expect(n.datePosted).toBe('2026-09-24T03:00:00.000Z')
  })

  it('an own rental states its "Posted" date; an imported one does not (decision S-c); a wanted post in rentals is nothing', () => {
    expect(ld(rental({ imported: false })).datePosted).toBe('2026-09-24T03:00:00.000Z')
    expect(ld(rental({ imported: true }))).not.toHaveProperty('datePosted')
    expect(listingJsonLd(rental({ listingType: 'wanted' }))).toBeNull()
  })
})

describe('goods → Product', () => {
  it('7. a CellphoneS phone: brand, MPN, new, in stock, sold by an organisation, and no expiry, returns or shipping', () => {
    const n = ld(input({
      id: 'cmu2pfshn0007luq4wgwnnoth', title: 'iPhone 18 Pro 256GB', price: 38_490_000, condition: 'new',
      brandName: 'Apple', mpn: 'iPhone 18 Pro', sellerName: 'CellphoneS', sellerHasOwner: false, sellerOfficialPartner: true, imported: true,
    }))
    expect(n['@type']).toBe('Product')
    expect(n.brand).toEqual({ '@type': 'Brand', name: 'Apple' })
    expect(n.mpn).toBe('iPhone 18 Pro')
    expect(n).not.toHaveProperty('gtin')
    expect(n.sku).toBe('cmu2pfshn0007luq4wgwnnoth')
    expect(n.category).toBe('Electronics')
    const o = offersOf(n)
    expect(o).toMatchObject({
      '@type': 'Offer', url: URL_OF('cmu2pfshn0007luq4wgwnnoth'), price: 38_490_000, priceCurrency: 'VND',
      itemCondition: 'https://schema.org/NewCondition', availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'CellphoneS' },
    })
    for (const k of ['priceValidUntil', 'hasMerchantReturnPolicy', 'shippingDetails', 'priceSpecification']) expect(o, k).not.toHaveProperty(k)
  })

  it('8. no condition states none; the other words map as the Merchant feed maps them', () => {
    expect(offersOf(ld(input({ condition: null })))).not.toHaveProperty('itemCondition')
    expect(offersOf(ld(input({ condition: '' })))).not.toHaveProperty('itemCondition')
    expect(offersOf(ld(input({ condition: 'used' }))).itemCondition).toBe('https://schema.org/UsedCondition')
    expect(offersOf(ld(input({ condition: 'refurb' }))).itemCondition).toBe('https://schema.org/RefurbishedCondition')
    expect(offersOf(ld(input({ condition: 'Refurbished' }))).itemCondition).toBe('https://schema.org/RefurbishedCondition')
    expect(offersOf(ld(input({ condition: 'Mới 99%' }))).itemCondition).toBe('https://schema.org/NewCondition')
    // A word nothing maps is not guessed at.
    expect(offersOf(ld(input({ condition: 'like a charm' })))).not.toHaveProperty('itemCondition')
  })

  it('9. a private seller is a Person; no owner, a business account or an official partner is an Organization', () => {
    expect(offersOf(ld(input())).seller).toEqual({ '@type': 'Person', name: 'Minh' })
    expect((offersOf(ld(input({ sellerHasOwner: false }))).seller as Node)['@type']).toBe('Organization')
    expect((offersOf(ld(input({ sellerIsBusiness: true }))).seller as Node)['@type']).toBe('Organization')
    expect((offersOf(ld(input({ sellerOfficialPartner: true }))).seller as Node)['@type']).toBe('Organization')
  })

  it('10. wholesale coffee per kg: the price is stated only inside a UnitPriceSpecification with KGM', () => {
    const o = offersOf(ld(input({ listingType: 'wholesale', priceUnit: 'VND/kg', price: 114_000, categoryName: 'Food & Drink' })))
    expect(o).not.toHaveProperty('price')
    expect(o.priceCurrency).toBe('VND')
    expect(o.priceSpecification).toEqual({
      '@type': 'UnitPriceSpecification', price: 114_000, priceCurrency: 'VND',
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'KGM' },
    })
  })

  it('11. a `sell` at 0 publishes nothing, a giveaway publishes price 0, and a unit with no code publishes nothing', () => {
    expect(listingJsonLd(input({ price: 0 }))).toBeNull()
    expect(listingJsonLd(input({ listingType: 'wholesale', price: 0 }))).toBeNull()
    const free = ld(input({ listingType: 'free', price: 0 }))
    expect(free['@type']).toBe('Product')
    expect(offersOf(free).price).toBe(0)
    expect(listingJsonLd(input({ priceUnit: 'VND/bag' }))).toBeNull()
    expect(listingJsonLd(input({ price: Number.NaN }))).toBeNull()
    // 'VND/service' has no suffix on the page, so it is a plain price here too.
    expect(offersOf(ld(input({ priceUnit: 'VND/service' }))).price).toBe(18_500_000)
  })

  it('12. a partner ticket: an AggregateOffer at the lowest price the page prints after "from", with no condition', () => {
    const n = ld(input({
      id: 'cmt6v9yjd000h4fq4wzfknkwh', title: 'VinWonders Vu Yen', price: 100_000, condition: 'new',
      categorySlug: 'tickets-travel', categoryName: 'Tickets & Travel', sellerHasOwner: false, imported: true, isBooking: true,
    }))
    expect(n['@type']).toBe('Product')
    expect(offersOf(n)).toEqual({ '@type': 'AggregateOffer', url: URL_OF('cmt6v9yjd000h4fq4wzfknkwh'), lowPrice: 100_000, priceCurrency: 'VND' })
    expect(keysAndTypes(n).keys.has('itemCondition')).toBe(false)
    expect(listingJsonLd(input({ isBooking: true, priceUnit: 'VND/day' }))).toBeNull()
  })

  it('photos: absolute ones pass, a root-relative one resolves against the page, anything else is dropped, and none means no key', () => {
    expect(ld(input({ images: ['https://a.example/x.webp', '/icons/ui/rest/camera.svg', 'data:image/png;base64,AA', '//cdn.example/y.webp'] })).image)
      .toEqual(['https://a.example/x.webp', 'https://eno.vn/icons/ui/rest/camera.svg'])
    expect(ld(input({ images: [] }))).not.toHaveProperty('image')
    // A page URL that does not parse (an env without a scheme) drops the relative photo; it never throws.
    expect(ld(input({ url: 'eno.vn/listings/l-1', images: ['https://a.example/x.webp', '/x.svg'] })).image).toEqual(['https://a.example/x.webp'])
  })

  it('the description is the flattened body, and an empty body states none', () => {
    expect(ld(input()).description).toBe('Specs: 16 GB RAM. 512 GB SSD')
    expect(ld(input({ description: '  ' }))).not.toHaveProperty('description')
  })

  it('a USD listing is priced in USD', () => {
    expect(offersOf(ld(input({ currency: 'USD', price: 450 }))).priceCurrency).toBe('USD')
  })
})

describe('services → Service', () => {
  it('13. the e-visa at 790,000: a Service from an Organization with an Offer; a free eSIM: a Service with no offer', () => {
    const visa = ld(input({
      id: 'cmsodthh1001j01s6j3mr1dn8', title: 'Vietnam E-Visa - Single Entry - Standard Processing', listingType: 'service',
      priceUnit: 'VND/service', price: 790_000, categorySlug: 'services', categoryName: 'Services', subcategorySlug: 'visa-legal',
      sellerName: 'VietKite', sellerIsBusiness: true,
    }))
    expect(visa['@type']).toBe('Service')
    expect(visa.url).toBe(URL_OF('cmsodthh1001j01s6j3mr1dn8'))
    expect(visa.provider).toEqual({ '@type': 'Organization', name: 'VietKite' })
    expect(visa.category).toBe('Services')
    expect(offersOf(visa)).toEqual({ '@type': 'Offer', url: URL_OF('cmsodthh1001j01s6j3mr1dn8'), price: 790_000, priceCurrency: 'VND' })
    const esim = ld(input({
      listingType: 'service', priceUnit: 'VND/service', price: 0, condition: 'new', categorySlug: 'services', categoryName: 'Services',
      subcategorySlug: 'esim', sellerHasOwner: false, imported: true,
    }))
    expect(esim['@type']).toBe('Service')
    expect(esim).not.toHaveProperty('offers')
    expect(keysAndTypes(esim).keys.has('itemCondition')).toBe(false)
    // An hourly lesson keeps its unit; a unit with no code keeps the Service and drops the offer.
    expect(refQtyOf(offersOf(ld(input({ listingType: 'service', priceUnit: 'VND/hour', price: 300_000 })))).unitCode).toBe('HUR')
    expect(ld(input({ listingType: 'service', priceUnit: 'VND/session', price: 300_000 }))).not.toHaveProperty('offers')
  })
})

describe('everything else → nothing', () => {
  it('14. job, wanted and event publish nothing; goods marked sold are SoldOut', () => {
    for (const listingType of ['job', 'wanted', 'event', 'auction']) expect(listingJsonLd(input({ listingType })), listingType).toBeNull()
    expect(offersOf(ld(input({ status: 'sold' }))).availability).toBe('https://schema.org/SoldOut')
  })

  it('the kind follows the type, and the rentals category makes any non-wanted row a rental', () => {
    expect(listingLdKind({ listingType: 'rent', categorySlug: 'rentals' })).toBe('rental')
    expect(listingLdKind({ listingType: 'sell', categorySlug: 'rentals' })).toBe('rental')
    expect(listingLdKind({ listingType: 'wanted', categorySlug: 'rentals' })).toBeNull()
    expect(listingLdKind({ listingType: 'service', categorySlug: 'tickets-travel' })).toBe('service')
    expect(listingLdKind({ listingType: 'wholesale', categorySlug: 'food-drink' })).toBe('goods')
  })
})

describe('15. the sweep: the old block\'s false statements never come back', () => {
  const ALL: [string, ListingLdInput][] = [
    ['nhatot apartment', rental()],
    ['batdongsan bare VND', rental({ sellerId: 'bds-vn-import-seller-0001', priceUnit: 'VND' })],
    ['other bare VND', rental({ sellerId: 'x', priceUnit: 'VND' })],
    ['per day', rental({ priceUnit: 'VND/day' })],
    ['6+ rooms', rental({ attributes: { bedrooms: '6', bathrooms: '6' } })],
    ['office', rental({ subcategorySlug: 'office-rental' })],
    ['no subcategory', rental({ subcategorySlug: null })],
    ['own rental', rental({ imported: false })],
    ['ci-l-4', input({ listingType: 'sell', categorySlug: 'rentals', priceUnit: 'month' })],
    ['cellphones', input({ condition: 'new', brandName: 'Apple', mpn: 'M1', sellerHasOwner: false, imported: true })],
    ['no condition', input()],
    ['refurb', input({ condition: 'refurb' })],
    ['used', input({ condition: 'used' })],
    ['business seller', input({ sellerIsBusiness: true })],
    ['coffee per kg', input({ listingType: 'wholesale', priceUnit: 'VND/kg' })],
    ['giveaway', input({ listingType: 'free', price: 0 })],
    ['ticket', input({ categorySlug: 'tickets-travel', imported: true, isBooking: true })],
    ['visa', input({ listingType: 'service', priceUnit: 'VND/service', price: 790_000 })],
    ['free esim', input({ listingType: 'service', priceUnit: 'VND/service', price: 0 })],
    ['sold goods', input({ status: 'sold' })],
  ]

  it.each(ALL)('%s: no expiry, rating, review, return policy or shipping terms', (_name, l) => {
    const n = listingJsonLd(l)
    expect(n).not.toBeNull()
    const { keys, types } = keysAndTypes(n)
    for (const k of ['priceValidUntil', 'aggregateRating', 'review', 'hasMerchantReturnPolicy', 'shippingDetails']) expect(keys.has(k), k).toBe(false)
    for (const t of ['MerchantReturnPolicy', 'OfferShippingDetails', 'AggregateRating', 'Review']) expect(types.has(t), t).toBe(false)
    expect((n as Node)['@context']).toBe('https://schema.org')
  })

  it.each(ALL)('%s: no Product unless the listing is goods', (_name, l) => {
    const { types } = keysAndTypes(listingJsonLd(l))
    if (['rent', 'service', 'job', 'wanted'].includes(l.listingType) || l.categorySlug === 'rentals') expect(types.has('Product')).toBe(false)
    else expect(types.has('Product')).toBe(true)
  })

  it('every rental offer is a lease priced per unit, never a sale', () => {
    for (const [, l] of ALL.filter(([, x]) => listingLdKind(x) === 'rental')) {
      const o = (listingJsonLd(l) as Node).offers as Node | undefined
      if (!o) continue
      expect(o.businessFunction).toBe(LEASE_OUT)
      expect(o).not.toHaveProperty('price')
      expect(refQtyOf(o).value).toBe(1)
    }
  })
})
