import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── The visa catalogue is the MARKETPLACE ──────────────────────────────────────────
//
// These tests exist to keep one property true: there is no price table. Every number a
// buyer is charged has to come out of a Listing the admin uploaded, and every product
// parameter out of that listing's `attributes` blob. So the suite asserts the DERIVATION
// (money, attributes, ordering, for-sale filtering) rather than any catalogue contents —
// there are no expected SKUs here, because the shop decides what the SKUs are.
//
// ⚠️ THE PRISMA MOCK HONOURS `where` and THROWS on a query it does not model. An
// unscoped listing read would let any seller's row be sold as a visa service, and a stub
// that ignored `where` would keep that green.

/** The Listing columns this module selects. */
type ListingRow = {
  id: string
  sellerId: string
  externalId: string | null
  title: string
  titleVi: string | null
  description: string
  price: number
  currency: string
  priceUnit: string
  images: string
  verified: boolean
  status: string
  attributes: string | null
}

const SHOP_ID = 'eno-visa-shop'
const OTHER_SHOP_ID = 'some-other-shop'

const h = vi.hoisted(() => ({
  state: {
    seller: null as null | { id: string; name: string; ownerId: string | null; avatarUrl: string | null; avatarColor: string },
    listings: [] as Array<Record<string, unknown>>,
    sellerError: null as unknown,
    listingError: null as unknown,
    /** Every findMany argument object, so the scoping can be asserted. */
    listingQueries: [] as Array<Record<string, unknown>>,
  },
}))

vi.mock('./db', () => ({
  db: {
    seller: {
      findFirst: async (args: any) => {
        if (h.state.sellerError) throw h.state.sellerError
        const email = args?.where?.owner?.email
        if (typeof email !== 'string') throw new Error('mock: seller.findFirst must resolve the storefront BY OWNER EMAIL')
        // The module lower-cases and trims VISA_SHOP_OWNER_EMAIL at import.
        if (email !== 'support@eno.vn') return null
        return h.state.seller
      },
    },
    listing: {
      findMany: async (args: any) => {
        if (h.state.listingError) throw h.state.listingError
        const sellerId = args?.where?.sellerId
        if (typeof sellerId !== 'string') {
          throw new Error('mock: listing.findMany must be scoped by sellerId — an unscoped read would sell another shop\'s listing as a visa')
        }
        if (Object.keys(args.where).length !== 1) throw new Error(`mock: unmodelled where clause ${JSON.stringify(args.where)}`)
        h.state.listingQueries.push(args)
        const rows = (h.state.listings as ListingRow[]).filter((l) => l.sellerId === sellerId)
        return typeof args.take === 'number' ? rows.slice(0, args.take) : rows
      },
    },
  },
}))

import { submissionWindow, VISA_SPEED_SPECS } from './visa/speed'
import {
  getVisaShopListings,
  getVisaShopProducts,
  getVisaShopProductsForSale,
  getVisaShopSeller,
  isVisaProductReadyForAutoFill,
  isVisaShopListing,
  resolveVisaProduct,
  usdToCentsExact,
  VISA_PRODUCTS,
  VISA_PRODUCT_EXTERNAL_PREFIX,
  visaPrefillForProduct,
  visaProductForListing,
  visaProductFromExternalId,
} from './visa-shop'

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: 'listing-1',
  sellerId: SHOP_ID,
  externalId: null,
  title: 'Vietnam e-visa — 4 hours, single entry',
  titleVi: null,
  description: 'desc',
  price: 61,
  currency: '$',
  priceUnit: '',
  images: '[]',
  verified: true,
  status: 'active',
  attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '4H' }),
  ...over,
})

let errors: string[]

beforeEach(() => {
  h.state.seller = { id: SHOP_ID, name: 'eno Visa Services', ownerId: 'owner-uuid', avatarUrl: null, avatarColor: '#0a66c2' }
  h.state.listings = []
  h.state.sellerError = null
  h.state.listingError = null
  h.state.listingQueries = []
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')) })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the shop resolves before anything is seeded', () => {
  it('answers empty rather than throwing when there is no storefront', async () => {
    h.state.seller = null
    expect(await getVisaShopSeller()).toBeNull()
    expect(await getVisaShopListings()).toEqual([])
    expect(await getVisaShopProducts()).toEqual([])
    expect(await resolveVisaProduct('listing-1')).toBeNull()
    expect(await isVisaShopListing('listing-1')).toBe(false)
  })

  it('fails soft when either read throws', async () => {
    h.state.sellerError = new Error('pooler down')
    expect(await getVisaShopSeller()).toBeNull()
    expect(await getVisaShopProducts()).toEqual([])

    h.state.sellerError = null
    h.state.listingError = new Error('statement timeout')
    expect(await getVisaShopListings()).toEqual([])
    expect(await getVisaShopProducts()).toEqual([])
    expect(await resolveVisaProduct('listing-1')).toBeNull()
  })
})

describe('products are derived from listings, never from a table', () => {
  it('reads entry type and speed out of Listing.attributes and the price out of Listing.price', async () => {
    h.state.listings = [
      listing({ id: 'a', price: 115, attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '1H' }) }),
      listing({ id: 'b', price: 140, attributes: JSON.stringify({ visaEntryType: 'multiple', visaSpeed: '1H' }) }),
    ]
    const products = await getVisaShopProducts()
    expect(products.map((p) => [p.listingId, p.entryType, p.speed, p.priceCents, p.currency])).toEqual([
      ['a', 'single', '1H', 11500, 'USD'],
      ['b', 'multiple', '1H', 14000, 'USD'],
    ])
  })

  it('follows the listing when the admin edits the price — there is no second copy', async () => {
    h.state.listings = [listing({ id: 'a', price: 61 })]
    expect((await getVisaShopProducts())[0].priceCents).toBe(6100)
    // The admin re-prices the product in the dashboard, like any other seller.
    ;(h.state.listings[0] as ListingRow).price = 72
    expect((await getVisaShopProducts())[0].priceCents).toBe(7200)
  })

  it('keeps facet attributes alongside the visa ones', async () => {
    h.state.listings = [listing({
      attributes: JSON.stringify({ serviceLocation: 'online', providerType: 'business', visaEntryType: 'multiple', visaSpeed: '2D' }),
    })]
    const [product] = await getVisaShopProducts()
    expect([product.entryType, product.speed]).toEqual(['multiple', '2D'])
  })

  it('only ever reads the visa storefront\'s own listings', async () => {
    h.state.listings = [listing({ id: 'mine' }), listing({ id: 'theirs', sellerId: OTHER_SHOP_ID })]
    expect((await getVisaShopProducts()).map((p) => p.listingId)).toEqual(['mine'])
    expect(await resolveVisaProduct('theirs')).toBeNull()
    expect(await isVisaShopListing('theirs')).toBe(false)
    expect(h.state.listingQueries.every((q) => (q.where as any).sellerId === SHOP_ID)).toBe(true)
  })
})

describe('a half-built product', () => {
  it('still lists, with null parameters and a closed window — never a guessed default', async () => {
    // [name, attributes blob, expected entryType, expected speed]
    const cases: Array<[string, string | null, string | null, string | null]> = [
      ['absent', null, null, null],
      ['empty', '', null, null],
      ['malformed', '{"visaSpeed": ', null, null],
      ['json null', 'null', null, null],
      ['array', '["visaSpeed"]', null, null],
      ['scalar', '5', null, null],
      ['string', '"visaSpeed"', null, null],
      ['other keys only', JSON.stringify({ serviceLocation: 'online' }), null, null],
      ['wrong speed', JSON.stringify({ visaEntryType: 'single', visaSpeed: '5H' }), 'single', null],
      ['wrong entry type', JSON.stringify({ visaEntryType: 'triple', visaSpeed: '1H' }), null, '1H'],
      ['nested', JSON.stringify({ visa: { visaEntryType: 'single', visaSpeed: '1H' } }), null, null],
      ['numeric values', JSON.stringify({ visaEntryType: 1, visaSpeed: 4 }), null, null],
      ['null values', JSON.stringify({ visaEntryType: null, visaSpeed: null }), null, null],
    ]
    for (const [name, attributes, entryType, speed] of cases) {
      h.state.listings = [listing({ id: name, attributes })]
      const products = await getVisaShopProducts()
      expect(products, name).toHaveLength(1)
      const [product] = products
      // LISTED (the admin is mid-setup) …
      expect(product.priceCents, name).toBe(6100)
      // … with exactly what the blob honestly said, and nothing guessed …
      expect(product.entryType, name).toBe(entryType)
      expect(product.speed, name).toBe(speed)
      // … and plainly unusable for auto-fill.
      expect(isVisaProductReadyForAutoFill(product), name).toBe(false)
      if (product.speed === null) {
        expect(product.window, name).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
      }
    }
  })

  it('is ready for auto-fill only once both parameters are set', async () => {
    h.state.listings = [listing({ attributes: JSON.stringify({ visaEntryType: 'multiple', visaSpeed: '3D' }) })]
    const [product] = await getVisaShopProducts()
    expect(isVisaProductReadyForAutoFill(product)).toBe(true)
    expect(isVisaProductReadyForAutoFill(null)).toBe(false)
    expect(isVisaProductReadyForAutoFill(undefined)).toBe(false)
  })
})

describe('money — the price shown is the price captured', () => {
  it('converts whole dollars to exact integer cents', async () => {
    for (const [usd, cents] of [[30, 3000], [42, 4200], [45, 4500], [55, 5500], [61, 6100], [85, 8500], [115, 11500], [140, 14000]] as const) {
      h.state.listings = [listing({ price: usd })]
      expect((await getVisaShopProducts())[0].priceCents).toBe(cents)
    }
  })

  it('refuses a price that cannot be charged', async () => {
    for (const price of [0, -1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2_000_000]) {
      h.state.listings = [listing({ price })]
      expect(await getVisaShopProducts(), String(price)).toEqual([])
      expect(await resolveVisaProduct('listing-1'), String(price)).toBeNull()
    }
    expect(errors.length).toBeGreaterThan(0)
    // The log names the listing and the amount — both public facts, no applicant data.
    expect(errors.every((e) => e.includes('listing-1'))).toBe(true)
  })

  it('refuses a listing priced in anything but USD', async () => {
    for (const currency of ['₫', 'VND', 'đ', '€', '']) {
      h.state.listings = [listing({ price: 61, currency })]
      expect(await getVisaShopProducts(), currency).toEqual([])
    }
    for (const currency of ['$', 'USD', 'usd', ' $ ']) {
      h.state.listings = [listing({ price: 61, currency })]
      expect((await getVisaShopProducts())[0]?.priceCents, currency).toBe(6100)
    }
  })

  it('refuses a fractional price, because the card would advertise a different number', async () => {
    // formatMoneyFull() renders `group(Math.round(price))`, so a 25.50 listing shows
    // "$26". Charging 2550 under that card is the mismatch the seed script also refuses.
    for (const price of [25.5, 25.4, 61.01, 30.99, 0.5]) {
      h.state.listings = [listing({ price })]
      expect(await getVisaShopProducts(), String(price)).toEqual([])
    }
    // A SUB-CENT price is not that mismatch: 25.005 is 2500 cents to the nearest cent and
    // the card renders "$25", so displayed and captured still agree and it stays sellable.
    h.state.listings = [listing({ price: 25.005 })]
    expect((await getVisaShopProducts())[0].priceCents).toBe(2500)
  })

  it('converts to cents without float error at the half-cent boundaries', async () => {
    // usdToCentsExact is the money primitive under the catalogue's whole-dollar gate.
    // These are the values where `Math.round(usd * 100)` invents a cent: the stored
    // double is BELOW the printed decimal, but multiplying by 100 rounds up to an exact
    // .5 and Math.round then goes away from zero.
    for (const [usd, exact, viaFloatMultiply] of [
      [8.475, 847, 848],
      [0.615, 61, 62],
      [1.115, 111, 112],
      [2.675, 267, 268],
      [10.045, 1004, 1005],
      [25.005, 2500, 2501],
    ] as const) {
      expect(usdToCentsExact(usd), String(usd)).toBe(exact)
      expect(Math.round(usd * 100), String(usd)).toBe(viaFloatMultiply)
      expect(usdToCentsExact(usd)).not.toBe(Math.round(usd * 100))
    }
    // …and where the two agree, they agree (0.005 really is above the half cent).
    for (const [usd, cents] of [[0.005, 1], [1.005, 100], [0.01, 1], [25.5, 2550], [61, 6100], [999_999.99, 99_999_999]] as const) {
      expect(usdToCentsExact(usd), String(usd)).toBe(cents)
      expect(Math.round(usd * 100), String(usd)).toBe(cents)
    }
    // Always an integer, never a float artefact.
    for (let usd = 0.01; usd < 200; usd += 0.37) expect(Number.isInteger(usdToCentsExact(usd))).toBe(true)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e21, '61' as unknown as number, null as unknown as number]) {
      expect(usdToCentsExact(bad), String(bad)).toBeNull()
    }
  })
})

describe('for sale vs. merely present', () => {
  it('charges only for a verified, active listing', async () => {
    h.state.listings = [
      listing({ id: 'live' }),
      listing({ id: 'hidden', status: 'hidden' }),
      listing({ id: 'sold', status: 'sold' }),
      listing({ id: 'unverified', verified: false }),
    ]
    expect((await getVisaShopProducts()).map((p) => p.listingId)).toEqual(['live'])
    expect((await getVisaShopProductsForSale()).map((l) => l.id)).toEqual(['live'])
    for (const id of ['hidden', 'sold', 'unverified']) {
      expect(await resolveVisaProduct(id), id).toBeNull()
      expect(await visaProductForListing(id), id).toBeNull()
      // …but they are still the visa desk's listings, so visa chrome still applies.
      expect(await isVisaShopListing(id), id).toBe(true)
    }
    expect((await getVisaShopListings()).map((l) => l.id).sort()).toEqual(['hidden', 'live', 'sold', 'unverified'])
  })

  it('resolveVisaProduct is the authoritative lookup, and refuses anything else', async () => {
    h.state.listings = [listing({ id: 'live', price: 85, attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '2H' }) })]
    const product = await resolveVisaProduct('live')
    expect(product).not.toBeNull()
    expect(product!.priceCents).toBe(8500)
    // It answers exactly what the catalogue answers — one set of rules, not two.
    expect(product).toEqual((await getVisaShopProducts())[0])
    expect(await resolveVisaProduct('nope')).toBeNull()
    expect(await resolveVisaProduct('')).toBeNull()
    expect(await resolveVisaProduct(null as unknown as string)).toBeNull()
    expect(await resolveVisaProduct(undefined as unknown as string)).toBeNull()
  })
})

describe('catalogue order', () => {
  it('is the owner grid: speed, then entry type, then price, then id', async () => {
    h.state.listings = [
      listing({ id: 'normal-multi', price: 55, attributes: JSON.stringify({ visaEntryType: 'multiple', visaSpeed: 'normal' }) }),
      listing({ id: 'unset', attributes: null }),
      listing({ id: '1h-multi', price: 140, attributes: JSON.stringify({ visaEntryType: 'multiple', visaSpeed: '1H' }) }),
      listing({ id: '4h-single', price: 61, attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '4H' }) }),
      listing({ id: '1h-single', price: 115, attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '1H' }) }),
      listing({ id: 'normal-single', price: 30, attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: 'normal' }) }),
    ]
    expect((await getVisaShopProducts()).map((p) => p.listingId)).toEqual([
      '1h-single', '1h-multi', '4h-single', 'normal-single', 'normal-multi',
      // A product the admin has not finished configuring sorts last.
      'unset',
    ])
  })

  it('is stable — the same input always produces the same order', async () => {
    h.state.listings = [
      listing({ id: 'b', price: 61 }),
      listing({ id: 'a', price: 61 }),
      listing({ id: 'c', price: 45 }),
    ]
    const first = (await getVisaShopProducts()).map((p) => p.listingId)
    expect(first).toEqual(['c', 'a', 'b'])
    expect((await getVisaShopProducts()).map((p) => p.listingId)).toEqual(first)
  })
})

describe('the submission window rides on the product', () => {
  it('is the tier\'s window at the current instant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 08:00 in Ho Chi Minh City — before the 4H tier's 08:30 cutoff.
    vi.setSystemTime(new Date('2026-07-21T01:00:00.000Z'))
    h.state.listings = [listing({ attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '4H' }) })]
    expect((await getVisaShopProducts())[0].window).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-07-21T01:30:00.000Z',
      nextOpensIso: null,
    })
    expect((await getVisaShopProducts())[0].window).toEqual(submissionWindow('4H', new Date('2026-07-21T01:00:00.000Z')))

    // 23:00 local — past the last cutoff, so the desk is shut until tomorrow.
    vi.setSystemTime(new Date('2026-07-21T16:00:00.000Z'))
    expect((await resolveVisaProduct('listing-1'))!.window).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-07-22T01:30:00.000Z',
      nextOpensIso: '2026-07-21T17:00:00.000Z',
    })
  })

  it('leaves a cutoff-free tier permanently open', async () => {
    h.state.listings = [listing({ attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: 'normal' }) })]
    expect((await getVisaShopProducts())[0].window).toEqual({ acceptingNow: true, nextCutoffIso: null, nextOpensIso: null })
    expect(VISA_SPEED_SPECS.normal.cutoffs).toEqual([])
  })
})

describe('the engine prefill', () => {
  it('takes the entry type from the listing, and refuses to invent one', async () => {
    expect(visaPrefillForProduct({ entryType: null })).toBeNull()
    expect(visaPrefillForProduct({ entryType: 'multiple' })).toEqual({ entryType: 'multiple', stayLengthDays: 90 })
    expect(visaPrefillForProduct({ entryType: 'single' }, '2026-08-01')).toEqual({
      entryType: 'single',
      stayLengthDays: 90,
      visaValidFrom: '2026-08-01',
      visaValidTo: '2026-10-29',
      intendedEntryDate: '2026-08-01',
    })
  })

  it('feeds straight off a resolved product', async () => {
    h.state.listings = [listing({ attributes: JSON.stringify({ visaEntryType: 'multiple', visaSpeed: '1D' }) })]
    const product = (await resolveVisaProduct('listing-1'))!
    expect(visaPrefillForProduct(product)).toEqual({ entryType: 'multiple', stayLengthDays: 90 })
  })
})

describe('back-compat with the seeder', () => {
  it('still declares the seed\'s keys and prefix (scripts/seed-visa-shop.mjs asserts on them)', () => {
    expect(VISA_PRODUCT_EXTERNAL_PREFIX).toBe('visa:')
    expect(VISA_PRODUCTS.map((p) => p.key)).toEqual(['evisa-90-single', 'evisa-90-multiple'])
    expect(VISA_PRODUCTS.every((p) => p.externalId.startsWith('visa:'))).toBe(true)
    expect(visaProductFromExternalId('visa:evisa-90-single')?.key).toBe('evisa-90-single')
    expect(visaProductFromExternalId('visa:nope')).toBeNull()
    expect(visaProductFromExternalId(null)).toBeNull()
    // ⚠️ And carries no product PARAMETER and no price — those live on the listing.
    for (const product of VISA_PRODUCTS) {
      expect(Object.keys(product).sort()).toEqual(['externalId', 'key', 'order'])
    }
  })
})
