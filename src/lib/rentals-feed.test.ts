import { describe, expect, it, vi } from 'vitest'
import type { SerializedRentalFeedListing } from './serialize'

/**
 * The apartment-rentals catalogue rows (rentals-feed.ts). `isListingImageUrl` pins its storage prefix
 * when the module loads, so the env is stubbed BEFORE the import.
 */
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn')
const F = await import('./rentals-feed')
const { feedExcluded } = await import('./product-feed')
const { RENTAL_IMPORT_SELLERS } = await import('./import-sellers')
const { serializeRentalFeedListing, RENTAL_FEED_SELECT } = await import('./serialize')
const { SITE_NAME } = await import('./edition')

const BASE = 'https://sb.eno.vn/storage/v1/object/public/listings/'
const sized = (w: number, h: number, n = 1) => `${BASE}affiliate/m/flat-${n}-a-idl-${w}x${h}.webp`
const HOST = 'https://eno.vn'

const listing = (over: Partial<SerializedRentalFeedListing> = {}): SerializedRentalFeedListing => ({
  id: 'lst_1',
  title: '2 bed · 1 bath · 70 m² for rent — Tan Phong, District 7',
  titleVi: 'Cho thuê căn hộ 2PN Quận 7',
  description: 'Bright flat near the river.\nPool and gym.',
  price: 15_000_000,
  priceUnit: 'VND/month',
  currency: '₫',
  images: [sized(1200, 900, 1), sized(1200, 900, 2)],
  sellerId: 'nhatot-import-seller-0001',
  status: 'active',
  subcategorySlug: 'apartment-rental',
  attributes: JSON.stringify({ bedrooms: '2' }),
  city: 'Hồ Chí Minh',
  district: 'Quận 7',
  areaM2: 70,
  ...over,
})

/** One CSV cell back to its value (the row builder escapes every free-text cell). */
const unquote = (c: string) => (c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c)

function cells(l: SerializedRentalFeedListing, host = HOST): Record<(typeof F.RENTAL_FEED_HEADERS)[number], string> {
  const r = F.rentalFeedRow(l, host)
  if (!('row' in r)) throw new Error(`withheld as ${r.excluded}`)
  expect(r.row).toHaveLength(F.RENTAL_FEED_HEADERS.length)
  return Object.fromEntries(F.RENTAL_FEED_HEADERS.map((h, i) => [h, unquote(r.row[i])])) as never
}
const excludedAs = (l: SerializedRentalFeedListing) => {
  const r = F.rentalFeedRow(l, HOST)
  return 'excluded' in r ? r.excluded : null
}

describe('the header row', () => {
  it('is exactly the Meta products columns this feed fills, in order', () => {
    expect(F.RENTAL_FEED_HEADERS.join(',')).toBe(
      'id,title,description,availability,condition,price,link,image_link,brand,product_type,additional_image_link,' +
      'custom_label_0,custom_label_1,custom_label_2,custom_label_3,custom_label_4',
    )
  })
})

describe('the monthly-rent rule', () => {
  it('admits VND/month from any seller, a member included', () => {
    expect(excludedAs(listing({ sellerId: 'member-seller-1' }))).toBeNull()
  })

  it('admits a bare VND only from the two sellers whose bare VND is monthly', () => {
    expect(excludedAs(listing({ priceUnit: 'VND', sellerId: 'bds-vn-import-seller-0001' }))).toBeNull()
    expect(excludedAs(listing({ priceUnit: 'VND', sellerId: 'cmub0wead0000zrq418bqq27m' }))).toBeNull()
    expect(excludedAs(listing({ priceUnit: 'VND', sellerId: 'nhatot-import-seller-0001' }))).toBe('not_monthly')
  })

  it('withholds a nightly or daily price', () => {
    expect(excludedAs(listing({ priceUnit: 'VND/day' }))).toBe('not_monthly')
    expect(excludedAs(listing({ priceUnit: 'VND/night' }))).toBe('not_monthly')
  })
})

describe('price and currency', () => {
  it('keeps the 1M–500M band inclusive and withholds outside it', () => {
    expect(excludedAs(listing({ price: 999_999 }))).toBe('price_band')
    expect(excludedAs(listing({ price: 1_000_000 }))).toBeNull()
    expect(excludedAs(listing({ price: 500_000_000 }))).toBeNull()
    expect(excludedAs(listing({ price: 500_000_001 }))).toBe('price_band')
    expect(excludedAs(listing({ price: Number.NaN }))).toBe('price_band')
  })

  it('withholds a non-đồng price', () => {
    expect(excludedAs(listing({ currency: '$' }))).toBe('currency')
  })

  it('prints the price as whole đồng with the ISO code', () => {
    expect(cells(listing({ price: 15_000_000.4 })).price).toBe('15000000 VND')
    expect(cells(listing()).price).toMatch(/^\d+ VND$/)
  })
})

describe('policy terms', () => {
  it('⛔ a policy hit in the Vietnamese title ALONE withholds the row, under the rule\'s reason', () => {
    const titleVi = 'Máy Đo Đường Huyết ACCU-CHEK Active Dùng Cho Cá Nhân - MMOLL'
    expect(feedExcluded(titleVi)).not.toBeNull()
    expect(excludedAs(listing({ titleVi }))).toBe(feedExcluded(titleVi))
  })
})

describe('images', () => {
  it('⛔ drops every photo that is not in our own storage — a source host, a mock — and never sends a placeholder', () => {
    const r = F.rentalFeedRow(listing({ images: ['https://photo.rever.vn/a.jpg', 'https://picsum.photos/seed/x/600/450'] }), HOST)
    expect(r).toEqual({ excluded: 'no_image' })
    expect(excludedAs(listing({ images: [] }))).toBe('no_image')
  })

  it('keeps a first-party photo whose name records no size, and drops one under 500 px on its shorter edge', () => {
    const memberPhoto = `${BASE}user-abc/photo-1.webp`
    expect(F.feedImages([sized(499, 900, 1), memberPhoto, sized(500, 500, 2)])).toEqual([memberPhoto, sized(500, 500, 2)])
  })

  it('keeps the stored order, sends each photo once, and at most 10 extras', () => {
    const photos = Array.from({ length: 13 }, (_, i) => sized(1200, 900, i + 1))
    const c = cells(listing({ images: [photos[0], photos[0], ...photos.slice(1)] }))
    expect(c.image_link).toBe(photos[0])
    expect(c.additional_image_link.split(',')).toEqual(photos.slice(1, 11))
  })
})

describe('the card title', () => {
  it('names the unit, the place, the floor area and the MONTHLY rent', () => {
    expect(cells(listing()).title).toBe('2BR apartment for rent · District 7 · 70 m² · 15,000,000 đ/month')
  })

  it('says Studio for a zero-bedroom flat — never "0BR" — and Apartment when the count is unknown', () => {
    expect(cells(listing({ attributes: JSON.stringify({ bedrooms: '0' }) })).title).toMatch(/^Studio for rent · /)
    expect(cells(listing({ attributes: null })).title).toMatch(/^Apartment for rent · /)
  })

  it('leaves out an area that is not a floor area', () => {
    expect(cells(listing({ areaM2: 3 })).title).toBe('2BR apartment for rent · District 7 · 15,000,000 đ/month')
    // 70,000 m² at 15M a month is 214 ₫/m²: a plot of land, not a flat.
    expect(cells(listing({ areaM2: 70_000 })).title).not.toContain('m²')
    expect(cells(listing({ areaM2: null })).title).not.toContain('m²')
  })

  it('names a place outside HCMC, or one the index cannot place, by its stored district and its city', () => {
    expect(cells(listing({ city: 'Hà Nội', district: 'Cầu Giấy' })).title).toContain(' · Cau Giay, Hanoi · ')
    expect(cells(listing({ district: 'Khu Nam Sài Gòn' })).title).toContain(' · Khu Nam Sai Gon, Ho Chi Minh City · ')
    expect(cells(listing({ district: null })).title).toContain(' · Ho Chi Minh City · ')
  })

  it('⛔ is at most 150 characters and never loses the monthly rent to a long place name', () => {
    for (const district of ['x'.repeat(300), 'Khu dân cư '.repeat(30)]) {
      const title = cells(listing({ city: 'Bình Dương', district, attributes: JSON.stringify({ bedrooms: '12' }) })).title
      expect(title.length).toBeLessThanOrEqual(150)
      expect(title).toMatch(/ · 70 m² · 15,000,000 đ\/month$/)
      expect(title).toContain('…')
    }
  })
})

describe('the description', () => {
  it('leads with the monthly rent, then the stored title, then the listing text', () => {
    expect(cells(listing()).description).toBe(
      'Monthly rent: 15,000,000 đ. 2 bed · 1 bath · 70 m² for rent — Tan Phong, District 7. Bright flat near the river. Pool and gym.',
    )
  })

  it('⛔ carries no phone number, e-mail or link', () => {
    const d = cells(listing({ description: 'Nice view. Call 0909 123 456 or mail a@b.vn, see https://rival.vn/x' })).description
    expect(d).not.toMatch(/0909|a@b\.vn|rival\.vn/)
  })

  it('⛔ …not even one that markdown splits up, or one written as a link', () => {
    for (const description of ['Call 0909 **123** 456 now', 'Book: [0909 123 456](tel:0909123456)', '**Hotline**\n0909.123.456']) {
      expect(cells(listing({ description })).description, description).not.toMatch(/0909|123 456|123\.456/)
    }
  })

  it('⛔ …nor one in the stored title, which the description carries too', () => {
    for (const title of ['Studio, call 0909 **123** 456', 'Flat [0909 123 456](tel:0909123456)']) {
      expect(cells(listing({ title })).description, title).not.toMatch(/0909|123 456/)
    }
  })

  it('is at most 1,000 characters', () => {
    expect(cells(listing({ description: 'word '.repeat(600) })).description.length).toBeLessThanOrEqual(1000)
  })

  it('⛔ never ends in half an emoji, wherever the cut falls', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const description of ['🏠'.repeat(600), `x${'🏠'.repeat(600)}`]) {
      const d = cells(listing({ description })).description
      expect(d.length).toBeLessThanOrEqual(1000)
      expect(d).not.toMatch(lone)
    }
  })
})

describe('the fixed columns', () => {
  it('links the listing on the feed\'s own host with the rentals campaign tag', () => {
    expect(cells(listing()).link).toBe('https://eno.vn/listings/lst_1?utm_source=facebook&utm_medium=catalog&utm_campaign=rentals')
    expect(cells(listing(), 'https://eno.vn/').link).toBe('https://eno.vn/listings/lst_1?utm_source=facebook&utm_medium=catalog&utm_campaign=rentals')
  })

  it('is in stock, used, branded with this edition\'s site name, typed by bedrooms', () => {
    const c = cells(listing())
    expect([c.availability, c.condition, c.brand, c.product_type]).toEqual(['in stock', 'used', SITE_NAME, 'Rentals > Apartment > 2 bedrooms'])
    expect(F.productType(null)).toBe('Rentals > Apartment')
    expect(F.productType(0)).toBe('Rentals > Apartment > Studio')
    expect(F.productType(1)).toBe('Rentals > Apartment > 1 bedroom')
    expect(F.productType(7)).toBe('Rentals > Apartment > 6+ bedrooms')
  })
})

describe('the brand on each edition', () => {
  it('⛔ is eno.vn on the marketplace build and eno.forum on the services build — never the other site\'s name', async () => {
    const brandOn = async (edition: string) => {
      vi.resetModules()
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
      const mod = await import('./rentals-feed')
      const r = mod.rentalFeedRow(listing(), HOST)
      return 'row' in r ? r.row[mod.RENTAL_FEED_HEADERS.indexOf('brand')] : null
    }
    try {
      expect(await brandOn('marketplace')).toBe('eno.vn')
      expect(await brandOn('services')).toBe('eno.forum')
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
      vi.resetModules()
    }
  })
})

describe('the custom labels', () => {
  it('label 0 is the subcategory; label 1 the city', () => {
    expect(cells(listing()).custom_label_0).toBe('apartment-rental')
    expect(F.cityLabel('Hồ Chí Minh')).toBe('hcmc')
    expect(F.cityLabel('TP. Hồ Chí Minh')).toBe('hcmc')
    expect(F.cityLabel('Hà Nội')).toBe('hanoi')
    expect(F.cityLabel('Thành phố Hà Nội'.normalize('NFD'))).toBe('hanoi')
    expect(F.cityLabel('Đà Nẵng')).toBe('danang')
    expect(F.cityLabel('Bình Dương')).toBe('other')
    expect(F.cityLabel('')).toBe('other')
  })

  it('label 2 is the curated district, for HCMC rows only', () => {
    expect(cells(listing()).custom_label_2).toBe('d7')
    expect(cells(listing({ city: 'Hà Nội', district: 'Quận 7' })).custom_label_2).toBe('')
    expect(cells(listing({ district: 'Khu Nam Sài Gòn' })).custom_label_2).toBe('')
  })

  it('label 3 is the monthly-rent band, lower bounds inclusive', () => {
    expect([9_999_999, 10_000_000, 19_999_999, 20_000_000, 39_999_999, 40_000_000].map(F.priceBand))
      .toEqual(['lt10m', '10-20m', '10-20m', '20-40m', '20-40m', '40m-plus'])
  })

  it('label 4 names every rental importer distinctly, and a member\'s post as eno', () => {
    const labels = RENTAL_IMPORT_SELLERS.map(F.sourceLabel)
    expect(new Set(labels).size).toBe(RENTAL_IMPORT_SELLERS.length)
    expect(labels).not.toContain('eno')
    expect(F.sourceLabel('member-seller-1')).toBe('eno')
    expect(cells(listing()).custom_label_4).toBe('nhatot')
  })
})

describe('the projection', () => {
  it('⛔ loads no seller relation — phone and e-mail never enter a feed', () => {
    expect(Object.keys(RENTAL_FEED_SELECT)).not.toContain('seller')
  })

  it('⚠️ reads a malformed images value as no images rather than throwing', () => {
    const raw = { ...listing(), images: '' }
    for (const images of ['{"a":1}', 'not json', '[1,"x.webp"]']) {
      expect(() => serializeRentalFeedListing({ ...raw, images } as never)).not.toThrow()
    }
    expect(serializeRentalFeedListing({ ...raw, images: '[1,"x.webp"]' } as never).images).toEqual(['x.webp'])
    expect(serializeRentalFeedListing({ ...raw, images: '{"a":1}' } as never).images).toEqual([])
  })
})
