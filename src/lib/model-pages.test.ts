import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

/**
 * The model price pages (src/lib/model-pages.ts): names and slugs, the claim band, the index (one page per brand + model,
 * on its home shelf, goods only), what the sitemap and the PDP may link to, the metadata and the one Product.
 * ⚠️ No database: the feed's builder hands back its params so each read's scope is visible; the db answers from `h`.
 */
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  brands: [] as { slug: string; name: string; status?: string }[],
  prices: [] as unknown[],
  cards: [] as unknown[],
  stale: false,
  reads: 0,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async ({ select, where }: { select: Record<string, unknown>; where: unknown }) => {
        h.reads++
        if ('category' in select && 'affiliateUrl' in select && !('id' in select)) return h.rows
        return 'id' in select ? h.cards.map((c) => ({ ...(c as object), where })) : h.prices
      },
    },
    brand: {
      findMany: async ({ where }: { where: { status: string; slug: { in: string[] } } }) =>
        h.brands.filter((b) => (b.status ?? 'active') === where.status && where.slug.in.includes(b.slug)),
    },
  },
}))
vi.mock('@/app/api/listings/feed-query', () => ({
  buildFeedFilters: async (sp: URLSearchParams) => ({ where: { params: Object.fromEntries(sp) } }),
  buildFeedOrderBy: (sort: string) => [{ sort }],
}))
const stale = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stale-noindex', () => ({ staleBelowFloor: stale }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async <T,>(l: T[], only?: string) => l.map((x) => ({ ...x, only })) }))
vi.mock('@/lib/serialize', async (orig) => ({ ...(await orig<typeof import('@/lib/serialize')>()), serializeListingCard: (r: unknown) => r }))

import {
  __resetModelPageIndex, askingBand, buildModelPageIndex, loadModelPage, modelPageMetadata, modelPageName, modelPagePath,
  modelPageSlug, modelPageSlugFor, modelProductLd, modelSpellings, submittableModelPages, type IndexRow, type ModelPageEntry,
} from './model-pages'
import { SITE_NAME } from '@/lib/edition'

const AT = new Date('2026-11-01T00:00:00Z')
const r = (over: Partial<IndexRow> = {}): IndexRow => ({
  brandSlug: 'apple', model: 'iPhone 13', subcategorySlug: 'phones-tablets', price: 10_000_000, currency: '₫', sellerId: 's0',
  affiliateUrl: null, updatedAt: AT, category: { slug: 'electronics' }, ...over,
})
/** `n` rows from three sellers, 8tr upward — a set that claims a market. */
const market = (n: number, over: Partial<IndexRow> = {}) =>
  Array.from({ length: n }, (_, i) => r({ price: (8 + i) * 1_000_000, sellerId: `s${i % 3}`, ...over }))
const BRANDS = [{ slug: 'apple', name: 'Apple' }, { slug: 'samsung', name: 'Samsung' }, { slug: 'honda', name: 'Honda' }]
const index = (rows: IndexRow[]) => buildModelPageIndex(rows, BRANDS)

beforeEach(() => {
  __resetModelPageIndex()
  Object.assign(h, { rows: [], brands: BRANDS, prices: [], cards: [], reads: 0 })
  stale.mockReset().mockResolvedValue(false)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('names and slugs', () => {
  it('prefixes the brand unless the model already names it', () => {
    expect(modelPageName('Apple', 'iPhone 13')).toBe('Apple iPhone 13')
    expect(modelPageName('Apple', 'Apple Watch Series 8')).toBe('Apple Watch Series 8')
    expect(modelPageName('Honda', 'honda')).toBe('honda')
    expect(modelPageName('Honda', 'Hondamatic')).toBe('Honda Hondamatic')
  })

  it('slugs: accents and đ folded, + spelled out, one hyphen per run, cut at 80 with no trailing hyphen', () => {
    expect(modelPageSlug('Apple iPhone 13')).toBe('apple-iphone-13')
    expect(modelPageSlug('Samsung Galaxy S23+')).toBe('samsung-galaxy-s23-plus')
    expect(modelPageSlug('Honda Wave Alpha')).toBe('honda-wave-alpha')
    expect(modelPageSlug('Xe Điện Đẹp — Mới!')).toBe('xe-dien-dep-moi')
    const cut = modelPageSlug(`${'a'.repeat(79)} b`)
    expect(cut).toBe('a'.repeat(79))
    expect(modelPageSlug('日本')).toBe('')
  })

  it('paths by language, and every spelling of a model', () => {
    expect(modelPagePath('apple-iphone-13', 'vi')).toBe('/gia/apple-iphone-13')
    expect(modelPagePath('apple-iphone-13', 'en')).toBe('/price/apple-iphone-13')
    expect(modelSpellings('apple', 'Apple Watch Series 8')).toEqual(expect.arrayContaining(['Apple Watch Series 8', 'Apple Watch S8']))
    expect(modelSpellings('nobrand', 'X')).toEqual(['X'])
  })
})

describe('askingBand', () => {
  const rows = (prices: number[], sellers = 3) => prices.map((price, i) => ({ price, currency: '₫', sellerId: `s${i % sellers}` }))

  it("P25 and P75 by percentile_cont, as PriceStat's cron computes them", () => {
    const b = askingBand(rows([1, 2, 3, 4, 5].map((x) => x * 1_000_000)))!
    expect([b.p25, b.p75, b.low, b.high, b.n, b.sellers]).toEqual([2_000_000, 4_000_000, 1_000_000, 5_000_000, 5, 3])
    const four = askingBand(rows([10, 20, 30, 40]))!
    expect([four.p25, four.p75]).toEqual([18, 33]) // 17.5 and 32.5, rounded
  })

  it('claims a market only with 5 rows, a spread of at most 3× and 3 sellers', () => {
    const five = [8, 9, 10, 11, 12].map((x) => x * 1_000_000)
    expect(askingBand(rows(five))!.claim).toBe(true)
    expect(askingBand(rows(five.slice(0, 4)))!.claim).toBe(false)
    expect(askingBand(rows(five, 2))!.claim).toBe(false)
    expect(askingBand(rows([1, 1, 1, 10, 10].map((x) => x * 1_000_000)))!.claim).toBe(false)
  })

  it('no band with any row in another currency, or none at all', () => {
    expect(askingBand([...rows([1, 2, 3, 4]), { price: 5, currency: '$', sellerId: 'x' }])).toBeNull()
    expect(askingBand([])).toBeNull()
  })

  it('a 1,000 ₫ lure fails the low check; a 389tr typo against a 9tr band fails the high one', () => {
    const lure = askingBand(rows([1_000, 9_000_000, 9_100_000, 9_200_000, 9_300_000, 9_400_000]))!
    expect([lure.claim, lure.ldLow, lure.ldHigh]).toEqual([true, false, true])
    const typo = askingBand(rows([8_900_000, 9_000_000, 9_100_000, 9_200_000, 9_300_000, 389_000_000]))!
    expect([typo.claim, typo.ldLow, typo.ldHigh]).toEqual([true, true, false])
  })
})

describe('buildModelPageIndex', () => {
  it('folds an alias into its model', () => {
    const e = index([...market(3, { model: 'Apple Watch Series 8', subcategorySlug: 'wearables' }), ...market(2, { model: 'Apple Watch S8', subcategorySlug: 'wearables' })])
    expect([...e.bySlug.keys()]).toEqual(['apple-watch-series-8'])
    expect(e.bySlug.get('apple-watch-series-8')).toMatchObject({ model: 'Apple Watch Series 8', n: 5, claim: true })
  })

  it("the model's largest shelf is its page; its case shelf gets none", () => {
    const e = index([...market(6), ...market(3, { subcategorySlug: 'phone-cases' })])
    expect(e.bySlug.size).toBe(1)
    expect(e.bySlug.get('apple-iphone-13')).toMatchObject({ categorySlug: 'electronics', subcategorySlug: 'phones-tablets', n: 6 })
  })

  it('⛔ an accessory shelf is never the home shelf, however many cases carry the model', () => {
    const e = index([...market(4), ...market(8, { subcategorySlug: 'phone-cases' })])
    expect([...e.bySlug.keys()]).toEqual(['apple-iphone-13'])
    expect(e.bySlug.get('apple-iphone-13')).toMatchObject({ subcategorySlug: 'phones-tablets', n: 4 })
    expect(index(market(6, { subcategorySlug: 'phone-cases' })).bySlug.size).toBe(0)
    for (const sub of ['screen-protectors', 'cables-chargers', 'power-banks', 'accessories']) {
      expect(index(market(6, { subcategorySlug: sub })).bySlug.size, sub).toBe(0)
    }
  })

  it('nothing for services, tickets-travel (visa runs too), a retired shelf, a hidden brand or the handwritten iPhone pages', () => {
    const e = buildModelPageIndex([
      ...market(5, { category: { slug: 'services' }, subcategorySlug: 'repairs' }),
      ...market(5, { category: { slug: 'tickets-travel' }, subcategorySlug: 'visa-runs' }),
      ...market(5, { category: { slug: 'tickets-travel' }, subcategorySlug: 'tours' }),
      ...market(5, { category: { slug: 'pets' }, subcategorySlug: 'dogs' }),
      ...market(5, { brandSlug: 'hidden' }),
      ...market(5, { model: 'iPhone 18 Pro' }),
      ...market(5, { model: 'iPhone Duo' }),
      ...market(5, { model: ' padded' }),
    ], BRANDS)
    expect([...e.bySlug.keys()]).toEqual([])
  })

  it('counts our own rows only for `own`, and dates by the newest own row', () => {
    const later = new Date('2026-11-09T00:00:00Z')
    const e = index([...market(3), r({ sellerId: 's1', updatedAt: later }), r({ affiliateUrl: 'https://x', sellerId: 's2', updatedAt: new Date('2026-11-12T00:00:00Z') })])
    expect(e.bySlug.get('apple-iphone-13')).toMatchObject({ n: 5, own: 4, lastmod: later })
  })

  it('a contested slug publishes neither model, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const e = index([...market(5, { model: 'iPhone 13' }), ...market(6, { model: 'iphone 13' }), ...market(5, { model: 'IPHONE 13' }), ...market(5, { model: 'iPhone 14' })])
    expect([...e.bySlug.keys()]).toEqual(['apple-iphone-14'])
    for (const k of ['apple|iPhone 13', 'apple|iphone 13', 'apple|IPHONE 13']) expect(e.byKey.has(k), k).toBe(false)
    expect(warn).toHaveBeenCalledWith('[model-pages] slug collision', 'apple-iphone-13', expect.any(String), expect.any(String))
    warn.mockRestore()
  })
})

describe('the database side', () => {
  it('submits a page only with the claim and 5 own rows; 5 rows of which 4 are own is left out', async () => {
    h.rows = [...market(5), ...market(4, { brandSlug: 'samsung', model: 'Galaxy S23' }), r({ brandSlug: 'samsung', model: 'Galaxy S23', affiliateUrl: 'https://x', sellerId: 's1' })]
    expect(await submittableModelPages()).toEqual([{ slug: 'apple-iphone-13', lastmod: AT }])
    // The index is read once an hour, whatever asks.
    await modelPageSlugFor({ brandSlug: 'apple', model: 'iPhone 13', categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell', status: 'active' })
    expect(h.reads).toBe(1)
  })

  it("links a live sale on the model's home shelf, and nothing else", async () => {
    h.rows = [...market(5), ...market(2, { subcategorySlug: 'phone-cases' }), ...market(5, { brandSlug: 'samsung', model: 'Galaxy S23', sellerId: 'one' })]
    const at = (over: object) => modelPageSlugFor({ brandSlug: 'apple', model: 'iPhone 13', categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell', status: 'active', ...over })
    expect(await at({})).toBe('apple-iphone-13')
    expect(await at({ status: 'sold' })).toBeNull()
    expect(await at({ listingType: 'wanted' })).toBeNull()
    expect(await at({ subcategorySlug: 'phone-cases' })).toBeNull()
    expect(await at({ brandSlug: 'samsung', model: 'Galaxy S23' })).toBeNull() // one seller: no claim
  })

  it('loads a page: the scoped params, the stale check, Vietnamese titles left alone; null when unknown or empty', async () => {
    h.rows = market(5)
    h.prices = market(3)
    h.cards = [{ id: 'a' }]
    const page = (await loadModelPage('apple-iphone-13', 'vi'))!
    expect(page.params).toEqual({ category: 'electronics', subcategory: 'phones-tablets', brand: 'apple', model: 'iPhone 13', type: 'sell', priceMin: '1' })
    expect(page.total).toBe(3)
    expect(page.band?.claim).toBe(false)
    expect(page.listings[0]).toMatchObject({ id: 'a', only: 'vi' })
    expect(stale).toHaveBeenCalledWith(expect.objectContaining({ live: 3, floor: 5 }))
    expect(page.indexable).toBe(true)
    expect(await loadModelPage('nope', 'en')).toBeNull()
    h.prices = []
    expect(await loadModelPage('apple-iphone-13', 'en')).toBeNull()
  })
})

const ENTRY: ModelPageEntry = {
  slug: 'apple-iphone-13', brandSlug: 'apple', brandName: 'Apple', model: 'iPhone 13', name: 'Apple iPhone 13',
  categorySlug: 'electronics', subcategorySlug: 'phones-tablets', n: 6, own: 6, claim: true, lastmod: AT,
}
const BAND = askingBand([8, 9, 10, 11, 12, 13].map((x, i) => ({ price: x * 1_000_000, currency: '₫', sellerId: `s${i % 3}` })))!

describe('modelPageMetadata', () => {
  it('titles and the claim description in each language, with reciprocal alternates', () => {
    const en = modelPageMetadata(ENTRY, { band: BAND, indexable: true }, 'en')
    expect(en.title).toBe(`Apple iPhone 13 price in Vietnam | ${SITE_NAME}`)
    expect(en.description).toBe(`Typical ask 9.3M–11.8M đ for Apple iPhone 13, from 6 listings on ${SITE_NAME}. Cheapest first.`)
    expect(en.alternates).toEqual({ canonical: '/price/apple-iphone-13', languages: { en: '/price/apple-iphone-13', 'vi-VN': '/gia/apple-iphone-13', 'x-default': '/price/apple-iphone-13' } })
    expect(en.robots).toBeUndefined()
    const vi = modelPageMetadata(ENTRY, { band: BAND, indexable: true }, 'vi')
    expect(vi.title).toBe(`Giá Apple iPhone 13 tại Việt Nam | ${SITE_NAME}`)
    expect(vi.description).toBe(`Giá rao phổ biến 9,3tr–11,8tr cho Apple iPhone 13, từ 6 tin trên ${SITE_NAME}. Rẻ nhất trước.`)
    expect((vi.alternates as { canonical: string }).canonical).toBe('/gia/apple-iphone-13')
  })

  it('no claim: the plain description; noindex only when the page says so', () => {
    const plain = modelPageMetadata(ENTRY, { band: { ...BAND, claim: false }, indexable: false }, 'en')
    expect(plain.description).toBe(`Apple iPhone 13 listings on ${SITE_NAME}, cheapest first.`)
    expect(plain.robots).toEqual({ index: false, follow: true })
    expect(modelPageMetadata(ENTRY, { band: null, indexable: true }, 'vi').description).toBe(`Tin rao Apple iPhone 13 trên ${SITE_NAME}, rẻ nhất trước.`)
  })
})

describe('modelProductLd', () => {
  const card = (images: string[], seller: object) => ({ images, seller: { trustScore: 0, isBusiness: false, officialPartner: false, unrated: false, ...seller } }) as unknown as SerializedListingCard
  const person = card(['https://img/person.jpg'], {})
  const guest = card(['https://img/guest.jpg'], { unrated: true })
  const shop = card(['/img/shop.jpg'], { isBusiness: true })

  it('the cheapest partner or business photo, absolute; VND; lowPrice, offerCount and a credible highPrice', () => {
    expect(modelProductLd(ENTRY, BAND, [person, guest, shop], 'vi')).toEqual({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Apple iPhone 13', brand: { '@type': 'Brand', name: 'Apple' },
      image: 'https://eno.vn/img/shop.jpg', url: 'https://eno.vn/gia/apple-iphone-13',
      offers: { '@type': 'AggregateOffer', priceCurrency: 'VND', lowPrice: 8_000_000, offerCount: 6, highPrice: 13_000_000 },
    })
  })

  it('no highPrice past 2× P75', () => {
    expect((modelProductLd(ENTRY, { ...BAND, ldHigh: false }, [shop], 'en')!.offers as object)).not.toHaveProperty('highPrice')
  })

  it("⛔ nothing without the claim, under a lure, or with no shop's photo (a person's or a guest storefront's is never used)", () => {
    expect(modelProductLd(ENTRY, { ...BAND, claim: false }, [shop], 'en')).toBeNull()
    expect(modelProductLd(ENTRY, { ...BAND, ldLow: false }, [shop], 'en')).toBeNull()
    expect(modelProductLd(ENTRY, BAND, [person, guest, card([], { officialPartner: true })], 'en')).toBeNull()
    expect(modelProductLd(ENTRY, null, [shop], 'en')).toBeNull()
  })
})
