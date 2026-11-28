import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ searchArgs: [] as unknown[], search: vi.fn(), detail: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), adCheck: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: { listing: { findMany: h.findMany, findUnique: h.findUnique } } }))
vi.mock('@/lib/ads/book', () => ({ checkAdListing: h.adCheck }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ AND: [w, { scope: 'marketplace' }] }) }))

vi.mock('@/app/api/mcp/search/tools', () => {
  class SearchToolError extends Error { constructor(readonly code: string, m: string) { super(m) } }
  return {
    SearchToolError,
    SEARCH_TOOLS_BY_NAME: new Map([
      ['search_listings', { handler: (a: unknown) => { h.searchArgs.push(a); return h.search(a) } }],
      ['get_listing_details', { handler: (a: { id: string }) => h.detail(a, SearchToolError) }],
    ]),
  }
})

const { ucpProfile, ucpSearch, ucpLookup, ucpProduct, UcpRequestError, UCP_SEARCH, UCP_LOOKUP } = await import('./catalog')

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Phone ${id}`, price: 12_000_000, price_unit: 'VND', negotiable: true, listing_type: 'sell', condition: 'used',
  location: 'Thảo Điền', district: 'Quận 2', city: 'Hồ Chí Minh', category: 'electronics', subcategory: 'phones-tablets',
  image: `https://eno.vn/img/${id}.webp`, posted_at: '2026-11-27T00:00:00.000Z', sponsored: false, url: `https://eno.vn/listings/${id}`, ...extra,
})

beforeEach(() => {
  h.searchArgs.length = 0
  h.search.mockReset()
  h.detail.mockReset()
  h.findMany.mockReset()
  h.findMany.mockResolvedValue([])
})

const CPS = 'cmt78nvif0000gpq48kvzmxjw' // CellphoneS
const HAGA = 'ed20fff4-0ba5-4ee4-a032-743d9c7cdd4d'

describe('UCP profile', () => {
  it('declares the REST shopping service, the catalog capabilities and checkout, and no payment handlers (2026-08-25)', () => {
    const p = ucpProfile()
    expect(p.ucp.version).toBe('2026-08-25')
    expect(p.ucp.services['dev.ucp.shopping'][0]).toMatchObject({ transport: 'rest', schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json' })
    expect(p.ucp.services['dev.ucp.shopping'][0].endpoint).toMatch(/\/api\/ucp$/)
    expect(Object.keys(p.ucp.capabilities).sort()).toEqual(['dev.ucp.shopping.checkout', UCP_LOOKUP, UCP_SEARCH].sort())
    expect(p.ucp.capabilities['dev.ucp.shopping.checkout'][0]).toMatchObject({ version: '2026-08-25', schema: 'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json' })
    expect(p.ucp.payment_handlers).toEqual({})
  })
})

describe('catalog search', () => {
  it('searches goods for sale only, maps rows to products in whole đồng, and pages with an opaque cursor', async () => {
    h.search.mockResolvedValue({ total: 31, listings: [row('a'), row('b', { sponsored: true })], next_offset: 10 })
    const out = await ucpSearch({ query: 'iphone', filters: { categories: ['Electronics'], price: { max: 15_000_000 } }, pagination: { limit: 10 } })
    expect(h.searchArgs[0]).toMatchObject({ q: 'iphone', type: 'sell', category: 'electronics', price_min: 1, price_max: 15_000_000, limit: 10, offset: 0 })
    expect(out.ucp).toEqual({ version: '2026-08-25', status: 'success', capabilities: { [UCP_SEARCH]: [{ version: '2026-08-25' }] } })
    const p = out.products[0]
    expect(p).toMatchObject({ id: 'a', title: 'Phone a', price_range: { min: { amount: 12_000_000, currency: 'VND' }, max: { amount: 12_000_000, currency: 'VND' } } })
    expect(p.description.plain.length).toBeGreaterThan(0)
    expect(p.variants).toHaveLength(1)
    expect(p.variants[0]).toMatchObject({ id: 'a', price: { amount: 12_000_000, currency: 'VND' }, availability: { available: true } })
    expect(out.products[1].tags).toEqual(['sponsored'])
    expect(out.pagination).toMatchObject({ has_next_page: true, total_count: 31 })
    // The cursor reads back as the next offset.
    h.search.mockResolvedValue({ total: 31, listings: [row('c')], next_offset: null })
    const next = await ucpSearch({ pagination: { cursor: out.pagination.cursor } })
    expect(h.searchArgs[1]).toMatchObject({ offset: 10 })
    expect(next.pagination).toEqual({ has_next_page: false, total_count: 31 })
  })

  it('caps the page at 20, refuses a bad limit or a foreign cursor, and says when a category is unknown', async () => {
    h.search.mockResolvedValue({ total: 0, listings: [], next_offset: null })
    await ucpSearch({ pagination: { limit: 500 } })
    expect(h.searchArgs[0]).toMatchObject({ limit: 20 })
    await expect(ucpSearch({ pagination: { limit: 0 } })).rejects.toBeInstanceOf(UcpRequestError)
    await expect(ucpSearch({ pagination: { cursor: 'not-ours' } })).rejects.toBeInstanceOf(UcpRequestError)
    const out = await ucpSearch({ filters: { categories: ['Spaceships'] } })
    expect(out.messages?.[0]).toMatchObject({ type: 'info', code: 'not_found' })
    // A next page past the cursor's range is no next page (never a cursor that would be refused).
    h.search.mockResolvedValue({ total: 900, listings: [row('x')], next_offset: 220 })
    expect((await ucpSearch({})).pagination).toEqual({ has_next_page: false, total_count: 900 })
    // A row without a positive price is never published.
    h.search.mockResolvedValue({ total: 2, listings: [row('free', { price: 0 }), row('ok')], next_offset: null })
    expect((await ucpSearch({})).products.map((p) => p.id)).toEqual(['ok'])
  })
})

describe("a partner shop's own return policy (owner 2026-11-28)", () => {
  it('search: partner products name the shop with a refund_policy link; one return policy per shop over its products', async () => {
    h.search.mockResolvedValue({ total: 4, listings: [row('a'), row('b'), row('c'), row('d')], next_offset: null })
    h.findMany.mockResolvedValue([{ id: 'b', sellerId: CPS }, { id: 'c', sellerId: HAGA }, { id: 'd', sellerId: CPS }])
    const out = await ucpSearch({ query: 'phone' })
    // Only partner sellers are asked for: no other seller's id is read.
    const where = h.findMany.mock.calls[0][0].where.AND
    expect(where[1]).toEqual({ scope: 'marketplace' })
    expect(where[0].id).toEqual({ in: ['a', 'b', 'c', 'd'] })
    expect(where[0].sellerId.in).toContain(CPS)
    expect(out.products[0].variants[0]).not.toHaveProperty('seller')
    expect(out.products[1].variants[0].seller).toEqual({ name: 'CellphoneS', links: [{ type: 'refund_policy', url: 'https://cellphones.com.vn/tos?part=refund-policy', title: 'CellphoneS return policy' }] })
    expect(out.policies).toEqual([
      expect.objectContaining({ type: 'dev.ucp.shopping.policy.return', url: 'https://cellphones.com.vn/tos?part=refund-policy', applies_to: ['$.products[1]', '$.products[3]'] }),
      expect.objectContaining({ type: 'dev.ucp.shopping.policy.return', url: 'https://hagasmartech.com/chinh-sach-doi-tra-hang-va-hoan-tien', applies_to: ['$.products[2]'] }),
    ])
    expect(out.policies![0].description.plain).toMatch(/CellphoneS's own policy/)
  })

  it('no partner product, no policies member; product and lookup point at their own nodes', async () => {
    h.search.mockResolvedValue({ total: 1, listings: [row('a')], next_offset: null })
    expect(await ucpSearch({})).not.toHaveProperty('policies')
    h.detail.mockResolvedValue({ listing: { ...row('p'), images: [], status: 'active', description: 'x' } })
    h.findMany.mockResolvedValue([{ id: 'p', sellerId: HAGA }])
    const one = (await ucpProduct({ id: 'p' })).body as { product: { variants: { seller?: { name: string } }[] }; policies: { applies_to: string[] }[] }
    expect(one.product.variants[0].seller?.name).toBe('HAGA Smartech')
    expect(one.policies[0].applies_to).toEqual(['$.product'])
    const many = await ucpLookup({ ids: ['p'] })
    expect(many.policies?.[0]).toMatchObject({ applies_to: ['$.products[0]'] })
    // In Vietnamese when the agent asks in Vietnamese.
    const vi = await ucpLookup({ ids: ['p'], context: { language: 'vi-VN' } })
    expect(vi.policies?.[0].description.plain).toMatch(/^Bán bởi HAGA Smartech: đổi trả/)
    expect(vi.products[0].variants[0]).toMatchObject({ seller: { links: [{ title: 'Chính sách đổi trả của HAGA Smartech' }] } })
  })

  it('a failed partner read still returns the products, without policies', async () => {
    h.search.mockResolvedValue({ total: 1, listings: [row('a')], next_offset: null })
    h.findMany.mockRejectedValue(new Error('pool exhausted'))
    const out = await ucpSearch({})
    expect(out.products.map((p) => p.id)).toEqual(['a'])
    expect(out).not.toHaveProperty('policies')
  })
})

describe("eno.vn's own ad product (ad:<listingId>)", () => {
  const live = (id: string) => ({ listing: { ...row(id), listing_type: 'rent', images: [`https://eno.vn/img/${id}.webp`], status: 'active', description: 'x' } })

  it('lookup: the product id features the week, a variant id is exact; only variants a request named, each with inputs', async () => {
    h.detail.mockImplementation(async ({ id }: { id: string }) => live(id))
    h.findUnique.mockResolvedValue({ sellerId: 's1' })
    h.adCheck.mockResolvedValue({ ok: true })
    const out = await ucpLookup({ ids: ['ad:L1', 'ad:L1:quarter'] })
    expect(out.products).toHaveLength(1)
    const p = out.products[0] as unknown as { id: string; variants: { id: string; price: { amount: number }; inputs: unknown[] }[] }
    expect(p.id).toBe('ad:L1')
    expect(p.variants.map((v) => [v.id, v.price.amount, v.inputs])).toEqual([
      ['ad:L1:week', 99_000, [{ id: 'ad:L1', match: 'featured' }]],
      ['ad:L1:quarter', 899_000, [{ id: 'ad:L1:quarter', match: 'exact' }]],
    ])
    // One eligibility read for the listing, with its own shop.
    expect(h.adCheck).toHaveBeenCalledTimes(1)
    expect(h.adCheck).toHaveBeenCalledWith('L1', 's1')
  })

  it('a listing eno.vn may not show or advertise is not_found, and its title is never printed', async () => {
    h.detail.mockImplementation(async (_: unknown, E: new (c: string, m: string) => Error) => { throw new E('not_found', 'x') })
    const hidden = await ucpLookup({ ids: ['ad:DESK:week'] })
    expect(hidden.products).toEqual([])
    expect(hidden.messages).toEqual([{ type: 'info', code: 'not_found', content: 'ad:DESK:week' }])
    h.detail.mockImplementation(async ({ id }: { id: string }) => live(id))
    h.findUnique.mockResolvedValue({ sellerId: 's1' })
    h.adCheck.mockResolvedValue({ ok: false, status: 403, code: 'ads_not_allowed' })
    expect((await ucpProduct({ id: 'ad:VISA' })).body).toMatchObject({ ucp: { status: 'error' }, messages: [{ code: 'not_found' }] })
  })

  it('catalog/product returns all three periods', async () => {
    h.detail.mockImplementation(async ({ id }: { id: string }) => live(id))
    h.findUnique.mockResolvedValue({ sellerId: 's1' })
    h.adCheck.mockResolvedValue({ ok: true })
    const body = (await ucpProduct({ id: 'ad:L1', context: { language: 'vi' } })).body as { product: { title: string; variants: { id: string }[] } }
    expect(body.product.variants.map((v) => v.id)).toEqual(['ad:L1:week', 'ad:L1:month', 'ad:L1:quarter'])
    expect(body.product.title).toBe('Quảng cáo trên eno.vn: Phone L1')
  })
})

describe('catalog lookup and product', () => {
  const full = (id: string, extra: Record<string, unknown> = {}) => ({ listing: { ...row(id), images: [`https://eno.vn/img/${id}.webp`], status: 'active', description: 'Seller text', ...extra } })

  it('returns what it finds with its input correlation, and names the rest as info not_found', async () => {
    h.detail.mockImplementation(async ({ id }: { id: string }, E: new (c: string, m: string) => Error) => {
      if (id === 'gone') throw new E('not_found', 'x')
      if (id === 'flat') return full(id, { listing_type: 'rent' })
      return full(id)
    })
    const out = await ucpLookup({ ids: ['a', 'gone', 'flat', 'a'] })
    expect(out.products.map((p) => p.id)).toEqual(['a'])
    expect(out.products[0].variants[0].inputs).toEqual([{ id: 'a', match: 'exact' }])
    expect(out.products[0].description).toEqual({ plain: 'Seller text' })
    expect(out.messages).toEqual([{ type: 'info', code: 'not_found', content: 'gone' }, { type: 'info', code: 'not_found', content: 'flat' }])
    await expect(ucpLookup({ ids: [] })).rejects.toBeInstanceOf(UcpRequestError)
  })

  it('a product that is not a live listing for sale is a UCP error at HTTP 200', async () => {
    h.detail.mockImplementation(async (_: unknown, E: new (c: string, m: string) => Error) => { throw new E('not_found', 'x') })
    const out = await ucpProduct({ id: 'nope' })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ucp: { status: 'error' }, messages: [{ type: 'error', code: 'not_found', severity: 'unrecoverable' }] })
    h.detail.mockResolvedValue(full('ok'))
    expect((await ucpProduct({ id: 'ok' })).body).toMatchObject({ ucp: { status: 'success' }, product: { id: 'ok' } })
  })
})
