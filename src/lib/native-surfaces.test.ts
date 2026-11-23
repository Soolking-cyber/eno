// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * iOS 1.3 system surfaces (src/lib/native-surfaces.ts): the widget's tiles and a chat notification's photo. Pinned here:
 * the price reads as the card's, the photo is the card's optimizer URL on eno.vn, and no visa / e-Visa / legal-permits
 * listing reaches either surface.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: h.findMany, findFirst: h.findFirst } } }))
vi.mock('@/lib/schema-feed', () => ({ publicFeedListingWhere: async () => ({ PUBLIC: true }) }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (where: object) => ({ AND: [where, { SCOPE: true }] }) }))

import { APP_ORIGIN, NOT_ON_APP_SURFACES, WIDGET_ITEMS, appImageUrl, cardPriceText, chatPushPhoto, resetWidgetFeedForTest, widgetFeed, widgetItems, type WidgetRow } from './native-surfaces'

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/u1/a.webp'
const row = (over: Partial<WidgetRow> = {}): WidgetRow => ({
  id: 'l1', title: 'MacBook Air M2', titleVi: null, images: JSON.stringify([PHOTO]),
  price: 12_800_000, currency: '₫', priceUnit: '', listingType: 'sell', sellerId: 's1', ...over,
})

beforeEach(() => { h.findMany.mockReset(); h.findFirst.mockReset(); resetWidgetFeedForTest() })
afterEach(() => { vi.useRealTimers() })

describe('cardPriceText — a card\'s price line as text', () => {
  it('a whole-thousand sale price of a million or more reads in millions, as on a card', () => {
    expect(cardPriceText(row(), 'en')).toBe('12.8M đ')
    expect(cardPriceText(row(), 'vi')).toBe('12,8 triệu')
  })

  it('an odd sale price keeps every digit (never rounded on a card)', () => {
    expect(cardPriceText(row({ price: 12_345_678 }), 'en')).toBe('12,345,678 đ')
    expect(cardPriceText(row({ price: 12_345_678 }), 'vi')).toBe('12.345.678 đ')
  })

  it('a rent carries its period: short in English, the Vietnamese word in Vietnamese', () => {
    const rent = row({ price: 8_500_000, priceUnit: 'VND/month', listingType: 'rent' })
    expect(cardPriceText(rent, 'en')).toBe('8.5M đ/mo')
    expect(cardPriceText(rent, 'vi')).toBe('8,5 triệu / tháng')
    // An odd per-unit price is rounded to the step and marked, as Price does.
    expect(cardPriceText({ ...rent, price: 8_555_555 }, 'en')).toBe('≈ 8.556M đ/mo')
  })

  it('a bare VND from a seller proven to store monthly rents reads per month (displayPriceUnit)', () => {
    expect(cardPriceText(row({ price: 9_000_000, priceUnit: 'VND', listingType: 'rent', sellerId: 'cmub0wead0000zrq418bqq27m' }), 'en')).toBe('9M đ/mo')
  })

  it('under a million: the full figure, with the locale\'s grouping', () => {
    expect(cardPriceText(row({ price: 350_000 }), 'en')).toBe('350,000 đ')
    expect(cardPriceText(row({ price: 350_000 }), 'vi')).toBe('350.000 đ')
  })

  it('zero is Free — except a job (Negotiable) and a teacher (rate on request)', () => {
    expect(cardPriceText(row({ price: 0 }), 'en')).toBe('Free')
    expect(cardPriceText(row({ price: 0 }), 'vi')).toBe('Miễn phí')
    expect(cardPriceText(row({ price: 0, listingType: 'job' }), 'en')).toBe('Negotiable')
    expect(cardPriceText(row({ price: 0, listingType: 'job' }), 'vi')).toBe('Thỏa thuận')
    expect(cardPriceText(row({ price: 0, listingType: 'teacher' }), 'en')).toBe('Rate on request')
  })
})

describe('appImageUrl — the card\'s optimizer URL, on the app\'s origin', () => {
  it('a storage photo goes through /_next/image on eno.vn at an allowed width and quality', () => {
    expect(appImageUrl(PHOTO, 256)).toBe(`${APP_ORIGIN}/_next/image?url=${encodeURIComponent(PHOTO)}&w=256&q=60`)
    expect(appImageUrl(PHOTO, 640)).toBe(`${APP_ORIGIN}/_next/image?url=${encodeURIComponent(PHOTO)}&w=640&q=60`)
    expect(APP_ORIGIN).toBe('https://eno.vn')
  })

  it('refuses anything that is not an https or a root-relative image src', () => {
    for (const bad of [null, 42, '', 'http://sb.eno.vn/x.webp', '//evil.test/x.webp', '/\\evil.test/x.webp', 'javascript:alert(1)', 'https://user@evil.test/x.webp']) {
      expect(appImageUrl(bad, 256)).toBeNull()
    }
  })
})

describe('the widget tiles', () => {
  it('a tile is a photo, a title and a price — a row without a usable photo is skipped', () => {
    const feed = widgetItems([row({ id: 'a' }), row({ id: 'b', images: '[]' }), row({ id: 'c', images: 'not json' }), row({ id: 'd', titleVi: 'Máy MacBook' })])
    expect(feed.en.map((t) => t.id)).toEqual(['a', 'd'])
    expect(feed.en[0]).toEqual({ id: 'a', title: 'MacBook Air M2', price: '12.8M đ', image: appImageUrl(PHOTO, 256) })
    expect(Object.keys(feed.en[0]).sort()).toEqual(['id', 'image', 'price', 'title'])
    // Vietnamese takes the stored Vietnamese title where there is one, and its own price line.
    expect(feed.vi.map((t) => t.title)).toEqual(['MacBook Air M2', 'Máy MacBook'])
    expect(feed.vi[0].price).toBe('12,8 triệu')
  })

  it('at most WIDGET_ITEMS tiles', () => {
    const feed = widgetItems(Array.from({ length: 20 }, (_, i) => row({ id: `l${i}` })))
    expect(feed.en).toHaveLength(WIDGET_ITEMS)
    expect(feed.vi).toHaveLength(WIDGET_ITEMS)
  })

  it('reads /feed.xml\'s public set minus the visa, e-Visa and legal-permits aisles, newest first, bounded', async () => {
    h.findMany.mockResolvedValue([row()])
    const feed = await widgetFeed()
    expect(feed?.en).toHaveLength(1)
    const args = h.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ AND: [{ PUBLIC: true }, NOT_ON_APP_SURFACES] })
    expect(args.orderBy).toEqual([{ postedAt: 'desc' }, { id: 'desc' }])
    expect(args.take).toBeLessThanOrEqual(50)
    // ⛔ No seller, contact or person in what is read.
    expect(Object.keys(args.select).sort()).toEqual(['currency', 'id', 'images', 'listingType', 'price', 'priceUnit', 'sellerId', 'title', 'titleVi'])
  })

  it('NOT_ON_APP_SURFACES keeps a listing with no subcategory and drops the three aisles', () => {
    expect(NOT_ON_APP_SURFACES).toEqual({ OR: [{ subcategorySlug: null }, { subcategorySlug: { notIn: ['visa-legal', 'legal-permits', 'visa-runs'] } }] })
  })

  it('one read per 10-minute window; past 30 minutes without a fresh read the answer is null, never old tiles', async () => {
    vi.useFakeTimers()
    h.findMany.mockResolvedValue([row()])
    await widgetFeed()
    await widgetFeed()
    expect(h.findMany).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(31 * 60_000)
    h.findMany.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await widgetFeed()).toBeNull()
  })
})

describe('a chat notification\'s photo', () => {
  it('the conversation\'s listing, scoped, public now, outside the visa aisles — at 640 through the optimizer', async () => {
    h.findFirst.mockResolvedValue({ images: JSON.stringify([PHOTO, 'https://sb.eno.vn/x/b.webp']) })
    expect(await chatPushPhoto('c1')).toBe(appImageUrl(PHOTO, 640))
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      AND: [{ AND: [{ conversations: { some: { id: 'c1' } } }, { verified: true, status: 'active' }, NOT_ON_APP_SURFACES] }, { SCOPE: true }],
    })
  })

  it('no listing (a support thread, a hidden or held listing, the desk) → no photo', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await chatPushPhoto('c1')).toBeNull()
  })
})
