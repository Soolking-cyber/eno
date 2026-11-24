import { describe, expect, it } from 'vitest'
import { chatgptFeedItem, type ChatgptFeedRow } from './chatgpt-feed'

/**
 * The ChatGPT product feed row (OpenAI product feed schema: developers.openai.com/commerce/specs/file-upload/products):
 * every REQUIRED field on every row, prices in whole đồng, VN market, search-only, and the withholding rules.
 */
const HOST = 'https://eno.vn'
const row = (over: Partial<ChatgptFeedRow> = {}): ChatgptFeedRow => ({
  id: 'cl1', title: 'iPhone 15 Pro 256GB', titleVi: 'iPhone 15 Pro 256GB', description: '**Like new**\n- Box included', descriptionVi: null,
  price: 21500000, currency: '₫', condition: 'used', images: ['https://cdn.eno.vn/a.jpg', '/storage/b.jpg'],
  brandSlug: 'apple', model: 'iPhone 15 Pro', status: 'active', subcategorySlug: 'phones-tablets', attributes: {}, facetTokens: [],
  category: { slug: 'electronics', name: 'Electronics' },
  seller: { id: 's1', name: 'Saigon Phones' },
  ...over,
} as unknown as ChatgptFeedRow)
const item = (r: ChatgptFeedRow, brandName: string | null = 'Apple') => {
  const out = chatgptFeedItem(r, { host: HOST, brandName, excludeMock: false })
  if ('withheld' in out) throw new Error(out.withheld)
  return out.item
}

describe('chatgptFeedItem', () => {
  it('carries every required field of the schema, in đồng, for Vietnam, search-only', () => {
    const it0 = item(row())
    for (const k of ['item_id', 'title', 'description', 'url', 'brand', 'seller_name', 'image_url', 'availability', 'price', 'target_countries', 'store_country']) {
      expect(it0[k as keyof typeof it0], k).toBeTruthy()
    }
    expect(it0).toMatchObject({
      item_id: 'cl1',
      url: 'https://eno.vn/listings/cl1?utm_source=chatgpt&utm_medium=shopping',
      brand: 'Apple',
      seller_name: 'Saigon Phones',
      seller_url: 'https://eno.vn/sellers/s1',
      availability: 'in_stock',
      price: '21500000 VND',
      condition: 'used',
      target_countries: ['VN'],
      store_country: 'VN',
      is_eligible_search: true,
      is_eligible_checkout: false,
      product_category: 'Electronics > phones tablets',
    })
  })

  it('makes every image URL absolute and keeps the rest as extra images', () => {
    const it0 = item(row())
    expect(it0.image_url).toBe('https://cdn.eno.vn/a.jpg')
    expect(it0.additional_image_urls).toEqual(['https://eno.vn/storage/b.jpg'])
  })

  it('plain-text description (no markdown), and "Unbranded" (never the shop) when the listing names no brand', () => {
    const it0 = item(row({ brandSlug: null, model: null }), null)
    expect(it0.description).not.toMatch(/\*\*|^- /m)
    expect(it0.description).toContain('Like new')
    expect(it0.brand).toBe('Unbranded')
  })

  it('never repeats a brand or model the title already has; titles stay ≤ 150', () => {
    expect(item(row()).title).toBe('Apple iPhone 15 Pro 256GB')
    expect(item(row({ title: 'x'.repeat(400) }), null).title.length).toBeLessThanOrEqual(150)
  })

  it('withholds a row with no price, no usable image, or a non-đồng price', () => {
    const why = (r: ChatgptFeedRow) => { const o = chatgptFeedItem(r, { host: HOST, brandName: null, excludeMock: false }); return 'withheld' in o ? o.withheld : null }
    expect(why(row({ price: 0 }))).toBe('no_price')
    expect(why(row({ images: [] }))).toBe('no_image')
    expect(why(row({ images: ['relative.jpg'] }))).toBe('no_image')
    expect(why(row({ currency: 'USD' }))).toBe('not_vnd')
  })

  it('⛔ "như mới" (like new) and "mới 99%" are USED; only a plain "new" / "mới" is new', () => {
    expect(item(row({ condition: 'Như mới' })).condition).toBe('used')
    expect(item(row({ condition: 'mới 99%' })).condition).toBe('used')
    expect(item(row({ condition: 'new' })).condition).toBe('new')
    expect(item(row({ condition: 'Mới' })).condition).toBe('new')
    expect(item(row({ condition: 'Refurbished' })).condition).toBe('refurbished')
  })

  it('a banned term in EITHER title withholds the row', () => {
    const why = (r: ChatgptFeedRow) => { const o = chatgptFeedItem(r, { host: HOST, brandName: null, excludeMock: false }); return 'withheld' in o ? o.withheld : null }
    expect(why(row({ title: 'Blood pressure monitor Omron', titleVi: 'Đồ gia dụng' }))).toBe('medical')
    expect(why(row({ title: 'Home appliance', titleVi: 'Máy đo huyết áp Omron' }))).toBe('medical')
  })

  it('carries no seller contact data, whatever the row holds', () => {
    const it0 = item(row({ seller: { id: 's1', name: 'Shop', phone: '0901234567', email: 'a@b.vn' } as unknown as ChatgptFeedRow['seller'] }))
    expect(JSON.stringify(it0)).not.toMatch(/0901234567|a@b\.vn/)
  })
})
