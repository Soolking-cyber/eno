import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ searchArgs: [] as unknown[], search: vi.fn(), detail: vi.fn() }))

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
})

describe('UCP profile', () => {
  it('declares the REST shopping service, the two catalog capabilities and no payment handlers (2026-08-25)', () => {
    const p = ucpProfile()
    expect(p.ucp.version).toBe('2026-08-25')
    expect(p.ucp.services['dev.ucp.shopping'][0]).toMatchObject({ transport: 'rest', schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json' })
    expect(p.ucp.services['dev.ucp.shopping'][0].endpoint).toMatch(/\/api\/ucp$/)
    expect(Object.keys(p.ucp.capabilities).sort()).toEqual([UCP_LOOKUP, UCP_SEARCH].sort())
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
