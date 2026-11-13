import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The public buyer search MCP server (/api/mcp/search, 2026-11-13). What is pinned, and why each matters:
 *  · the feed gets ONLY whitelisted parameters (no `ids`, `seller`, `histogram`…), `facets=0`, a limit ≤ 20, the keyword
 *    path (noAi) — an anonymous POST is origin work and must not reach more than the site's own search does;
 *  · a result row never carries a map pin, a seller id or a tracker link, and a commission listing says `sponsored`;
 *  · a detail read uses the listing page's scope (eno's desk excluded, teachers excluded) and its viewable rule;
 *  · no credential is needed for any method, the limiters answer 429 before parsing, and tools/list stays clean of the
 *    services vocabulary eno.vn may not advertise.
 * 20s per test, like discovery-auth.test.ts: each test re-imports the route after vi.resetModules, and that cold import
 * is what crosses 5s under load — not the assertions.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  feedCalls: [] as { params: URLSearchParams; opts: Row }[],
  feedRows: [] as Row[],
  feedTotal: 0,
  scopeCalls: [] as Row[],
  detail: null as Row | null,
  rl: { ip: true, callIp: true, all: true },
  rlCalls: [] as string[],
  dbReads: 0,
}))

vi.mock('@/app/api/listings/feed-payload', () => ({
  buildFeedPayload: async (params: URLSearchParams, opts: Row) => {
    h.feedCalls.push({ params, opts })
    return { body: { listings: h.feedRows, total: h.feedTotal }, cacheControl: 'x', histogram: false }
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (where: Row, opts?: Row) => { h.scopeCalls.push({ where, opts }); return { AND: [where, { scope: true }] } },
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findFirst: async () => { h.dbReads++; return h.detail } } } }))
vi.mock('@/app/[lang]/listings/[id]/(pdp)/get-listing', () => ({
  // The real rule (get-listing.ts listingIsViewable), restated: its module imports Prisma and React's cache.
  listingIsViewable: (row: Row | null) => !!row && row.verified && (row.status === 'active' || row.status === 'sold'),
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string) => {
    h.rlCalls.push(name)
    const ok = name === 'mcp-search-ip' ? h.rl.ip : name === 'mcp-search-call-ip' ? h.rl.callIp : h.rl.all
    return { success: ok, remaining: ok ? 1 : 0, limit: 1, resetSec: 30, windowSec: 60 }
  },
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://eno.vn/api/mcp/search', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const call = async (name: string, args: Row = {}) => {
  const { POST } = await import('./route')
  const res = await POST(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))
  return { status: res.status, body: await res.json() }
}

const CARD = {
  id: 'l1', sellerId: 's-secret', title: 'Studio Thao Dien', price: 9_000_000, priceUnit: 'VND/month', negotiable: true, listingType: 'rent',
  condition: null, location: 'Thảo Điền', district: 'Thủ Đức', city: 'Hồ Chí Minh', lat: 10.8, lng: 106.73, subcategorySlug: 'apartments',
  category: { slug: 'rentals' }, images: ['https://img/1.jpg', 'https://img/2.jpg'], postedAt: '2026-11-12T00:00:00.000Z', isSponsored: true,
  affiliateUrl: 'https://track.example/x', contactCount: 4,
}

beforeEach(() => {
  h.feedCalls = []; h.feedRows = [CARD]; h.feedTotal = 1; h.scopeCalls = []; h.detail = null; h.rl = { ip: true, callIp: true, all: true }; h.rlCalls = []; h.dbReads = 0
  vi.useRealTimers()
  vi.resetModules()
})

describe('search_listings', { timeout: 20_000 }, () => {
  it('sends the feed only whitelisted parameters, facets off, the keyword path, a capped page', async () => {
    const r = await call('search_listings', { q: 'studio district 2', category: 'rentals', type: 'rent', price_max: 10_000_000, limit: 5, offset: 10, sort: 'price-low', seller: 's1', ids: 'a,b', histogram: 1 })
    expect(r.body.result.isError).toBeUndefined()
    const { params, opts } = h.feedCalls[0]
    expect(Object.fromEntries(params)).toEqual({ q: 'studio district 2', category: 'rentals', type: 'rent', priceMax: '10000000', sort: 'price-low', lang: 'en', limit: '5', offset: '10', facets: '0' })
    expect(opts).toEqual({ noAi: true })
  })

  it('refuses more than 20 rows or an offset past 200 instead of quietly honouring it', async () => {
    expect((await call('search_listings', { limit: 100 })).body.result.isError).toBe(true)
    expect((await call('search_listings', { offset: 5000 })).body.result.isError).toBe(true)
    expect(h.feedCalls).toHaveLength(0)
  })

  it('a row carries no map pin, seller id or tracker link; a commission listing is flagged sponsored', async () => {
    const r = await call('search_listings', { q: 'studio' })
    const row = r.body.result.structuredContent.listings[0]
    for (const k of ['lat', 'lng', 'sellerId', 'affiliateUrl', 'contactCount']) expect(row).not.toHaveProperty(k)
    expect(JSON.stringify(r.body.result)).not.toContain('track.example')
    expect(row).toMatchObject({ id: 'l1', sponsored: true, price: 9_000_000, price_unit: 'VND/month', image: 'https://img/1.jpg', category: 'rentals' })
    expect(row.url).toMatch(/\/listings\/l1$/)
  })

  it('the teachers directory is refused, never mixed in, however the slug is cased', async () => {
    for (const category of ['teachers', 'Teachers', ' TEACHERS ']) {
      const r = await call('search_listings', { category })
      expect(r.body.result.isError, category).toBe(true)
    }
    expect(h.feedCalls).toHaveLength(0)
  })

  it('a subcategory this edition withholds is refused, as list_categories leaves it out', async () => {
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    const r = await call('search_listings', { category: 'tickets-travel', subcategory: 'visa-runs' })
    expect(r.body.result.isError === true).toBe(IS_MARKETPLACE)
    vi.resetModules()
    const bare = await call('search_listings', { subcategory: 'Visa-Runs' })
    expect(bare.body.result.isError === true).toBe(IS_MARKETPLACE)
  })

  it('a subcategory with no category is searched, not refused (only withheld ones are)', async () => {
    const r = await call('search_listings', { subcategory: 'apartments' })
    expect(r.body.result.isError).toBeUndefined()
    expect(h.feedCalls[0].params.get('subcategory')).toBe('apartments')
  })

  it('a listing in a subcategory this edition withholds is not served at all: not in search, not by id', async () => {
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    h.feedRows = [{ ...CARD, id: 'vr', category: { slug: 'tickets-travel' }, subcategorySlug: 'visa-runs' }, CARD]
    h.feedTotal = 2
    const out = (await call('search_listings', { q: 'x', limit: 2 })).body.result.structuredContent
    expect(out.listings.map((l: Row) => l.id)).toEqual(IS_MARKETPLACE ? ['l1'] : ['vr', 'l1'])
    h.detail = { id: 'vr', title: 'Visa run', description: 'd', price: 1, priceUnit: 'VND', negotiable: true, listingType: 'sell', condition: null, brandSlug: null, model: null, location: 'x', district: null, city: 'y', subcategorySlug: 'visa-runs', images: '[]', postedAt: new Date(), status: 'active', verified: true, affiliateUrl: null, category: { slug: 'tickets-travel' } }
    expect((await call('get_listing_details', { id: 'vr' })).body.result.isError === true).toBe(IS_MARKETPLACE)
  })

  it('no seller-typed field leaves the site with contact details: title, location, district, condition', async () => {
    h.feedRows = [{ ...CARD, title: 'Studio Thao Dien zalo 0909 123 456', location: 'Thảo Điền 0909.111.222', district: 'Quận 2 a@b.vn', condition: 'mới www.x.vn' }]
    const r = await call('search_listings', { q: 'studio' })
    const row = r.body.result.structuredContent.listings[0]
    expect(JSON.stringify(row)).not.toMatch(/0909|123 456|111\.222|a@b\.vn|www\.x\.vn/)
    expect(row.location).toContain('Thảo Điền')
  })

  it('at the end of the paging window it says capped, not "no more"', async () => {
    h.feedTotal = 300
    h.feedRows = Array.from({ length: 20 }, (_, i) => ({ ...CARD, id: `c${i}` }))
    const out = (await call('search_listings', { limit: 20, offset: 200 })).body.result.structuredContent
    expect(out).toMatchObject({ next_offset: null, capped: true })
  })

  it('next_offset only when a full page leaves more', async () => {
    h.feedTotal = 50
    h.feedRows = Array.from({ length: 2 }, (_, i) => ({ ...CARD, id: `l${i}` }))
    expect((await call('search_listings', { limit: 2 })).body.result.structuredContent.next_offset).toBe(2)
    h.feedTotal = 2
    vi.resetModules()
    expect((await call('search_listings', { limit: 2 })).body.result.structuredContent.next_offset).toBeNull()
  })
})

describe('get_listing_details', { timeout: 20_000 }, () => {
  const ROW = { id: 'l1', title: 'Studio', description: 'x'.repeat(5000), price: 9e6, priceUnit: 'VND/month', negotiable: true, listingType: 'rent', condition: null, brandSlug: null, model: null, location: 'Thảo Điền', district: null, city: 'Hồ Chí Minh', subcategorySlug: null, images: JSON.stringify(['https://img/1.jpg']), postedAt: new Date('2026-11-12T00:00:00Z'), status: 'active', verified: true, affiliateUrl: null, category: { slug: 'rentals' } }

  it('reads through the listing page\'s scope with teachers excluded', async () => {
    h.detail = ROW
    await call('get_listing_details', { id: 'l1' })
    expect(h.scopeCalls[0]).toEqual({ where: { id: 'l1' }, opts: undefined })
  })

  it('an unverified, hidden or missing listing is not found', async () => {
    for (const d of [null, { ...ROW, verified: false }, { ...ROW, status: 'hidden' }]) {
      h.detail = d
      vi.resetModules()
      const r = await call('get_listing_details', { id: 'l1' })
      expect(r.body.result.isError).toBe(true)
      expect(r.body.result.content[0].text).toContain('not_found')
    }
  })

  it('a description leaves the site without phone numbers, e-mails, links or contact lines', async () => {
    h.detail = { ...ROW, description: 'Nice studio, 30m2.\nLiên hệ: 0909.123.456\nMail me: a@b.vn or see https://portal.example/x\nDeposit 3.000.000 - 5.000.000đ' }
    const l = (await call('get_listing_details', { id: 'l1' })).body.result.structuredContent.listing
    expect(l.description).toContain('Nice studio, 30m2.')
    expect(l.description).toContain('3.000.000 - 5.000.000đ')
    for (const leak of ['0909', 'a@b.vn', 'portal.example']) expect(l.description).not.toContain(leak)
  })

  it('projects the public fields only: no tracker link, description capped, sponsored flag kept', async () => {
    h.detail = { ...ROW, affiliateUrl: 'https://shopee.vn/x?aff=1' }
    const r = await call('get_listing_details', { id: 'l1' })
    const l = r.body.result.structuredContent.listing
    expect(l).not.toHaveProperty('affiliateUrl')
    expect(JSON.stringify(r.body.result)).not.toContain('aff=1')
    expect(l.description.length).toBeLessThanOrEqual(2001)
    expect(l.images).toEqual(['https://img/1.jpg'])
    expect(l.url).toMatch(/\/listings\/l1$/)
  })
})

describe('the server', { timeout: 20_000 }, () => {
  it('every method works without a credential; tools/list is read-only, described and clean', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    expect(res.status).toBe(200)
    const { result } = await res.json()
    expect(result.tools.map((t: Row) => t.name)).toEqual(['search_listings', 'get_listing_details', 'list_categories'])
    for (const t of result.tools) {
      expect(t.title).toBeTruthy()
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
      for (const [k, p] of Object.entries((t.inputSchema.properties ?? {}) as Record<string, Row>)) expect(p.description, `${t.name}.${k}`).toBeTruthy()
      expect(t.outputSchema.$schema).toBeUndefined()
      expect(JSON.stringify(t.outputSchema)).not.toContain('"additionalProperties":false')
    }
    // The same licensing pin as /api/mcp's tools/list (discovery-auth.test.ts).
    const blob = JSON.stringify(result).toLowerCase()
    for (const word of ['visa', 'itinerary', 'paypal']) expect(blob).not.toContain(word)
  })

  it('initialize names this edition\'s search server on its own host', async () => {
    const { POST } = await import('./route')
    const { SITE_NAME } = await import('@/lib/edition')
    const { result } = await (await POST(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))).json()
    expect(result.serverInfo.name).toBe(`${SITE_NAME} Search`)
    expect([SITE_NAME, `www.${SITE_NAME}`]).toContain(new URL(result.serverInfo.websiteUrl).host)
  })

  it('every answer fits its tool\'s outputSchema', async () => {
    const { SEARCH_TOOLS } = await import('./tools')
    h.detail = { id: 'l1', title: 'S', description: 'd', price: 1, priceUnit: 'VND', negotiable: true, listingType: 'sell', condition: null, brandSlug: null, model: null, location: 'x', district: null, city: 'y', subcategorySlug: null, images: '[]', postedAt: new Date(), status: 'sold', verified: true, affiliateUrl: null, category: { slug: 'electronics' } }
    const args: Record<string, Row> = { search_listings: { q: 'x' }, get_listing_details: { id: 'l1' }, list_categories: {} }
    for (const t of SEARCH_TOOLS) {
      const out = await t.handler(t.input.parse(args[t.name]) as Row)
      expect(t.output.safeParse(out).success, t.name).toBe(true)
    }
  })

  it('the request limiter answers 429 before the body is read', async () => {
    const { POST } = await import('./route')
    h.rl = { ip: false, callIp: true, all: true }
    expect((await POST(new Request('https://eno.vn/api/mcp/search', { method: 'POST', body: 'not json' }))).status).toBe(429)
  })

  it('every tool call in a batch is counted, per IP and globally, and refused one by one when over', async () => {
    const { POST } = await import('./route')
    const batch = Array.from({ length: 3 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'list_categories', arguments: {} } }))
    await POST(post(batch))
    expect(h.rlCalls.filter((n) => n === 'mcp-search-call-ip')).toHaveLength(3)
    expect(h.rlCalls.filter((n) => n === 'mcp-search-call-all')).toHaveLength(3)
    // A call its address may not make never touches the global bucket.
    h.rlCalls = []
    h.rl = { ip: true, callIp: false, all: true }
    vi.resetModules()
    const { POST: once } = await import('./route')
    await once(post(batch))
    expect(h.rlCalls.filter((n) => n === 'mcp-search-call-all')).toHaveLength(0)
    for (const over of [{ ip: true, callIp: false, all: true }, { ip: true, callIp: true, all: false }]) {
      h.rl = over
      vi.resetModules()
      const { POST: fresh } = await import('./route')
      const out = await (await fresh(post(batch))).json()
      for (const r of out) expect(r.result.content[0].text).toContain('rate_limited')
    }
  })

  it('nothing is cached: a search right after a takedown already reflects it', async () => {
    await call('search_listings', { q: 'studio' })
    h.feedRows = [] // taken down
    const r = await call('search_listings', { q: 'studio' })
    expect(h.feedCalls).toHaveLength(2)
    expect(r.body.result.structuredContent.listings).toEqual([])
  })

  it('list_categories names only what this edition names: no teachers, no subcategory eno.vn withholds', async () => {
    const r = await call('list_categories')
    const cats = r.body.result.structuredContent.categories as Row[]
    expect(cats.some((c) => c.slug === 'teachers')).toBe(false)
    const { POST_HIDDEN_ON_MARKETPLACE } = await import('@/lib/taxonomy')
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    const named = new Set(cats.flatMap((c) => (c.subcategories as Row[]).map((s) => `${c.slug}/${s.slug}`)))
    for (const hidden of POST_HIDDEN_ON_MARKETPLACE) expect(named.has(hidden), hidden).toBe(!IS_MARKETPLACE)
    // Nothing in it names an itinerary or a payment surface on either edition.
    const blob = JSON.stringify(cats).toLowerCase()
    for (const word of ['itinerary', 'paypal']) expect(blob).not.toContain(word)
  })

  it('a detail read is never cached: a listing taken down is gone on the very next call', async () => {
    h.detail = { id: 'l1', title: 'S', description: 'd', price: 1, priceUnit: 'VND', negotiable: true, listingType: 'sell', condition: null, brandSlug: null, model: null, location: 'x', district: null, city: 'y', subcategorySlug: null, images: '[]', postedAt: new Date(), status: 'active', verified: true, affiliateUrl: null, category: { slug: 'electronics' } }
    expect((await call('get_listing_details', { id: 'l1' })).body.result.isError).toBeUndefined()
    h.detail = { ...h.detail, status: 'hidden' }
    expect((await call('get_listing_details', { id: 'l1' })).body.result.isError).toBe(true)
    expect(h.dbReads).toBe(2)
  })

  it('JSON-RPC edges: an explicit null id is answered; junk bodies and an empty batch get Invalid Request', async () => {
    const { POST } = await import('./route')
    const nullId = await (await POST(post({ jsonrpc: '2.0', id: null, method: 'ping' }))).json()
    expect(nullId).toMatchObject({ jsonrpc: '2.0', id: null, result: {} })
    for (const junk of [null, 42, {}, { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0', id: [1], method: 'ping' }]) {
      const r = await (await POST(post(junk))).json()
      expect(r.error.code, JSON.stringify(junk)).toBe(-32600)
    }
    const empty = await POST(post([]))
    expect(empty.status).toBe(400)
    expect((await empty.json()).error.code).toBe(-32600)
  })

  it('a tool name that is not a string is an unknown tool, and it never takes the batch down', async () => {
    const { POST } = await import('./route')
    const res = await POST(post([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: { toString: null } } },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]))
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out[0].error.code).toBe(-32602)
    expect(out[1]).toMatchObject({ id: 2, result: {} })
  })

  it('an unsupported MCP-Protocol-Version header is a 400; a supported one is served', async () => {
    const { POST } = await import('./route')
    expect((await POST(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' }))).status).toBe(400)
    expect((await POST(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2025-06-18' }))).status).toBe(200)
  })

  it('params that are not an object or array are Invalid params', async () => {
    const { POST } = await import('./route')
    const r = await (await POST(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: 42 }))).json()
    expect(r.error.code).toBe(-32602)
  })

  it('a body over 64 KB is refused before it is parsed', async () => {
    const { POST } = await import('./route')
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } })
    expect((await POST(new Request('https://eno.vn/api/mcp/search', { method: 'POST', body: big }))).status).toBe(413)
  })

  it('a tools/call sent as a notification (no id) runs nothing and gets no reply', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'search_listings', arguments: { q: 'x' } } }))
    expect(res.status).toBe(202)
    expect(h.feedCalls).toHaveLength(0)
    expect(h.rlCalls.filter((n) => n.startsWith('mcp-search-call'))).toHaveLength(0)
  })

  it('a batch over 8 messages is refused', async () => {
    const { POST } = await import('./route')
    const res = await POST(post(Array.from({ length: 9 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))))
    expect(res.status).toBe(400)
  })

  it('a browser is sent to the setup page; an MCP GET is a 405', async () => {
    const { GET } = await import('./route')
    const browser = await GET(new Request('https://eno.vn/api/mcp/search', { headers: { accept: 'text/html' } }))
    expect(browser.status).toBe(302)
    expect(browser.headers.get('location')).toMatch(/\/developers\/mcp#search$/)
    expect((await GET(new Request('https://eno.vn/api/mcp/search', { headers: { accept: 'text/event-stream' } }))).status).toBe(405)
  })
})
