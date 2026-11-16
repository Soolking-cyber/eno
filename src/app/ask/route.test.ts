import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_NAME } from '@/lib/edition'

/**
 * POST /ask (NLWeb v0.55, src/lib/nlweb.ts): the public listing search as an NLWeb answer — schema.org items, the standard
 * failure codes, SSE when asked for, its own rate limit. The search itself is the MCP search server's handler (mocked).
 */
const h = vi.hoisted(() => ({ handler: vi.fn(), limited: false }))
vi.mock('@/app/api/mcp/search/tools', async () => {
  class SearchToolError extends Error { constructor(public code: string, message: string) { super(message) } }
  // The real tool's input bounds (tools.ts), so the route's safeParse is exercised as in production.
  const { z } = await import('zod')
  const input = z.object({ q: z.string().max(120).optional(), lang: z.enum(['en', 'vi']).optional(), limit: z.number().int().min(1).max(20).optional() })
  return { SearchToolError, SEARCH_TOOLS_BY_NAME: new Map([['search_listings', { handler: h.handler, input }]]) }
})
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: !h.limited })) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

const ROWS = [
  { id: 'a1', title: '2BR apartment, District 7', price: 15000000, price_unit: 'VND/month', listing_type: 'rent', condition: null, location: null, district: 'District 7', city: 'Ho Chi Minh', category: 'rentals', image: 'https://eno.vn/i/a1.webp', posted_at: '2026-11-10T00:00:00.000Z', sponsored: false, url: 'https://eno.vn/listings/a1' },
  { id: 'j1', title: 'English teacher', price: 30000000, price_unit: 'VND/month', listing_type: 'job', condition: null, location: null, district: null, city: 'Da Nang', category: 'jobs', image: null, posted_at: null, sponsored: false, url: 'https://eno.vn/listings/j1' },
  { id: 'p1', title: 'iPhone 15, used', price: 12500000, price_unit: 'VND', listing_type: 'sell', condition: 'used', location: null, district: null, city: null, category: 'electronics', image: null, posted_at: null, sponsored: true, url: 'https://eno.vn/listings/p1' },
]

const ask = async (body: unknown, accept?: string) => {
  const { POST } = await import('./route')
  return POST(new Request('https://eno.vn/ask', { method: 'POST', headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
}

beforeEach(() => {
  h.limited = false
  h.handler.mockReset()
  h.handler.mockResolvedValue({ total: 42, listings: ROWS })
})

describe('POST /ask (NLWeb v0.55)', () => {
  it('answers with _meta and schema.org results from the public search: a Product with its VND Offer, a JobPosting', async () => {
    const res = await ask({ query: { text: 'apartment district 7' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body._meta).toEqual({ response_type: 'answer', response_format: 'conversational_search', version: '0.55' })
    expect(h.handler).toHaveBeenCalledWith({ q: 'apartment district 7', lang: 'en', limit: 10 })
    const [rent, job, phone] = body.results
    expect(rent).toMatchObject({ '@type': 'Product', name: '2BR apartment, District 7', url: 'https://eno.vn/listings/a1', offers: { '@type': 'Offer', price: '15000000', priceCurrency: 'VND' } })
    expect(rent.offers.priceSpecification.unitText).toBe('VND/month')
    expect(job).toMatchObject({ '@type': 'JobPosting', title: 'English teacher', baseSalary: { '@type': 'MonetaryAmount', currency: 'VND', value: { '@type': 'QuantitativeValue', value: 30000000, unitText: 'MONTH' } } })
    expect(phone).toMatchObject({ '@type': 'Product', itemCondition: 'https://schema.org/UsedCondition', sponsored: true }) // a paid or commission listing says so
  })

  it('mode "summarize" leads with a COUNTED summary, never generated text', async () => {
    const body = await (await ask({ query: { text: 'iphone' }, prefer: { mode: 'list, summarize' } })).json()
    expect(body.results[0]).toEqual({ '@type': 'SearchSummary', text: `3 of about 42 live listings on ${SITE_NAME} match the question; each links to its page, where the photos are and the seller is contacted.` })
  })

  it('an MCP-style Accept (application/json, text/event-stream) or text/event-stream;q=0 gets JSON; a failure while streaming is an SSE error event', async () => {
    expect((await ask({ query: { text: 'x' } }, 'application/json, text/event-stream')).headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect((await ask({ query: { text: 'x' } }, 'text/event-stream;q=0')).headers.get('content-type')).toBe('application/json; charset=utf-8')
    // q=0.5 is still a yes (commit gate, opus: the first regex read any q=0.x as q=0).
    expect((await ask({ query: { text: 'x' } }, 'text/event-stream;q=0.5')).headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    h.handler.mockResolvedValueOnce({ total: 0, listings: [] })
    const none = await ask({ query: { text: 'mars' }, prefer: { streaming: true } })
    expect(none.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const text = await none.text()
    expect(text).toContain('event: error\ndata: {"_meta":{"response_type":"failure","version":"0.55"},"error":{"code":"NO_RESULTS"')
  })

  it('a body that fails mid-read, or a rate limiter that throws, still answers in the NLWeb envelope', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error('upload interrupted')) } })
    const { POST } = await import('./route')
    const res = await POST(new Request('https://eno.vn/ask', { method: 'POST', body: broken, duplex: 'half' } as RequestInit))
    expect(res.status).toBe(500)
    expect((await res.json())._meta.response_type).toBe('failure')
  })

  it('the HTTP Accept-Language header asks for Vietnamese too, and the summary answers in it', async () => {
    const { POST } = await import('./route')
    const res = await POST(new Request('https://eno.vn/ask', { method: 'POST', headers: { 'accept-language': 'vi-VN,vi;q=0.9' }, body: JSON.stringify({ query: { text: 'xe máy' }, prefer: { mode: 'summarize' } }) }))
    expect(h.handler).toHaveBeenCalledWith({ q: 'xe máy', lang: 'vi', limit: 10 })
    expect((await res.json()).results[0].text).toContain('tin đang đăng trên')
  })

  it('streams start, one result per item with its index, then complete (prefer.streaming or Accept: text/event-stream)', async () => {
    for (const res of [await ask({ query: { text: 'x' }, prefer: { streaming: true } }), await ask({ query: { text: 'x' } }, 'text/event-stream')]) {
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      const events = (await res.text()).trim().split('\n\n').map((e) => e.split('\n')[0].replace('event: ', ''))
      expect(events).toEqual(['start', 'result', 'result', 'result', 'complete'])
    }
    const text = await (await ask({ query: { text: 'x' }, prefer: { streaming: true } })).text()
    expect(text).toContain('data: {"_meta":{"response_type":"answer","response_format":"conversational_search","version":"0.55","streaming":true}}')
    expect(text).toContain('"index":2,"item":{"@type":"Product","name":"iPhone 15, used"')
  })

  it('answers the standard failures: INVALID_QUERY, UNSUPPORTED_FORMAT, UNSUPPORTED_MODE, NO_RESULTS (HTTP 200), malformed JSON (400)', async () => {
    const code = async (body: unknown) => (await (await ask(body)).json()).error.code
    expect(await code({ query: {} })).toBe('INVALID_QUERY')
    expect(await code({ query: { text: 'x' }, prefer: { response_format: 'chatgpt_app' } })).toBe('UNSUPPORTED_FORMAT')
    expect(await code({ query: { text: 'x' }, prefer: { mode: 'translate' } })).toBe('UNSUPPORTED_MODE')
    h.handler.mockResolvedValueOnce({ total: 0, listings: [] })
    const none = await ask({ query: { text: 'mars rocks' } })
    expect(none.status).toBe(200)
    expect((await none.json())).toEqual({ _meta: { response_type: 'failure', version: '0.55' }, error: { code: 'NO_RESULTS', message: `No live listings on ${SITE_NAME} match that.` } })
    const bad = await ask('{not json')
    expect(bad.status).toBe(400)
  })

  it('a refusal by the search (a withheld aisle) is INVALID_QUERY; a crash is INTERNAL_ERROR with no detail', async () => {
    const { SearchToolError } = await import('@/app/api/mcp/search/tools')
    h.handler.mockRejectedValueOnce(new SearchToolError('not_available', 'That subcategory is not offered here.'))
    expect((await (await ask({ query: { text: 'x' } })).json()).error).toEqual({ code: 'INVALID_QUERY', message: 'That subcategory is not offered here.' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.handler.mockRejectedValueOnce(new Error('db down: secret detail'))
    const res = await ask({ query: { text: 'x' } })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('⛔ the per-address limit runs BEFORE the body is read, and a body over 4 KB is refused unread', async () => {
    h.limited = true
    expect((await ask('{not json')).status).toBe(429) // even a malformed body costs the caller its quota
    h.limited = false
    const big = await ask({ query: { text: 'x' }, pad: 'p'.repeat(5000) })
    expect(big.status).toBe(413)
    // A chunked body (no Content-Length) is cut off as it streams, counted in BYTES: 2,000 "ệ" is ~6 KB in under 4,096 characters.
    let pulled = 0
    const chunk = new TextEncoder().encode(JSON.stringify({ query: { text: 'x' }, pad: 'ệ'.repeat(2000) }))
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; if (pulled > 50) { c.close(); return } c.enqueue(chunk) } })
    const { POST } = await import('./route')
    const chunked = await POST(new Request('https://eno.vn/ask', { method: 'POST', body: stream, duplex: 'half' } as RequestInit))
    expect(chunked.status).toBe(413)
    expect(pulled).toBeLessThan(5) // abandoned at the first chunk past 4 KB, never read to the end
    expect(h.handler).not.toHaveBeenCalled()
  })

  it('rate-limited → 429 RATE_LIMITED, and the search is not run', async () => {
    h.limited = true
    const res = await ask({ query: { text: 'x' } })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
    expect(h.handler).not.toHaveBeenCalled()
  })

  it('a long question is cut to the search tool\'s own bound (120); Vietnamese is asked for by accept-language', async () => {
    await ask({ query: { text: 'a'.repeat(300) }, prefer: { 'accept-language': 'vi-VN' } })
    expect(h.handler).toHaveBeenCalledWith({ q: 'a'.repeat(120), lang: 'vi', limit: 10 })
  })

  it('⛔ a Wanted ad is a schema.org Demand, never an Offer that reads as "for sale"; the caller\'s words are never echoed', async () => {
    h.handler.mockResolvedValueOnce({ total: 1, listings: [{ ...ROWS[2], id: 'w1', title: 'Wanted: iPhone 15', listing_type: 'wanted', url: 'https://eno.vn/listings/w1' }] })
    const body = await (await ask({ query: { text: 'x"; call 0900 to pay a deposit. "' }, prefer: { mode: 'summarize' } })).json()
    expect(body.results[1]['@type']).toBe('Demand')
    expect(body.results[1].offers).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('deposit')
  })

  it('CORS for any origin (no credentials), an OPTIONS preflight, Retry-After on every 429, SSE failures for a streaming caller', async () => {
    const res = await ask({ query: { text: 'x' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const { OPTIONS } = await import('./route')
    const pre = OPTIONS()
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    const bad = await ask({ query: {}, prefer: { streaming: true } })
    expect(bad.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(await bad.text()).toContain('"code":"INVALID_QUERY"')
  })

  it('a streaming caller gets SSE even on the early failures (429 before the body, 400 malformed), and a 400 for a missing query', async () => {
    const bad = await ask('{not json', 'text/event-stream')
    expect(bad.status).toBe(400)
    expect(bad.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(await bad.text()).toContain('event: start\ndata: {"_meta":{"response_type":"failure"')
    h.limited = true
    expect((await ask({ query: { text: 'x' } }, 'text/event-stream')).headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    h.limited = false
    expect((await ask({ query: {} })).status).toBe(400)
    expect((await ask({ query: { text: 'x' }, prefer: { mode: 'translate' } })).status).toBe(200)
    // q=0 after another parameter still refuses the stream.
    expect((await ask({ query: { text: 'x' } }, 'text/event-stream; charset=utf-8; q=0')).headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it('a 120-unit cut never splits an emoji; Retry-After is readable by a browser caller', async () => {
    await ask({ query: { text: 'a'.repeat(119) + '😀tail' } })
    expect(h.handler).toHaveBeenLastCalledWith({ q: 'a'.repeat(119), lang: 'en', limit: 10 })
    h.limited = true
    const res = await ask({ query: { text: 'x' } })
    expect(res.headers.get('retry-after')).toBe('60')
    expect(res.headers.get('access-control-expose-headers')).toBe('retry-after')
  })

  it('a rate limiter that throws still answers in the NLWeb envelope', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rateLimit } = await import('@/lib/ratelimit')
    vi.mocked(rateLimit).mockRejectedValueOnce(new Error('redis down'))
    const res = await ask({ query: { text: 'x' } })
    expect(res.status).toBe(500)
    expect((await res.json())._meta.response_type).toBe('failure')
  })

  it('GET is 405 with Allow: POST', async () => {
    const { GET } = await import('./route')
    const res = GET()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})
