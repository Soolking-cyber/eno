import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * route()'s `body:` PATH AND ITS CAP (appsec-02). Before: `await req.json()` then `safeParse`, no limit — up to 10 MB
 * parsed, and zod 4.4.3 walking every element of an array before its `.max()` (an 8 MB `{"ids":[[],[],…]}` took ~11 s
 * and ~2.8 GB for one signed-in request). Now the body is read through readJsonCapped: past the cap the answer is 413
 * `payload_too_large` and neither JSON.parse nor the schema ever sees it. The order is unchanged: caller, then limiter,
 * then body — so a stranger's oversized body to an authed route is still a 401 that reads nothing.
 */
const h = vi.hoisted(() => ({ userId: null as string | null, limited: 0, allow: true }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getCurrentProfileId: async () => h.userId,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => { h.limited++; return { success: h.allow, resetSec: 30 } } }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))

const { route } = await import('@/lib/api/handler')

const CAP = 64 * 1024
const jsonOfBytes = (n: number, fields: Record<string, unknown> = {}) => {
  const shell = JSON.stringify({ ...fields, pad: '' })
  return JSON.stringify({ ...fields, pad: 'a'.repeat(n - shell.length) })
}
const post = (body: BodyInit) => new Request('https://eno.vn/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
/** An unlabelled body that records how much of it was pulled. */
function streamed(total: number) {
  const seen = { pulled: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (seen.pulled >= total) return c.close()
      seen.pulled += 4096
      c.enqueue(new Uint8Array(4096).fill(0x20))
    },
  }, { highWaterMark: 0 })
  return { req: new Request('https://eno.vn/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit), seen }
}

const schema = z.object({ pad: z.string(), ids: z.array(z.string().max(64)).max(200).optional() })
const parse = vi.spyOn(schema, 'safeParse')
const handler = vi.fn(async ({ body }: { body: unknown }) => ({ got: Buffer.byteLength(JSON.stringify(body)) }))

beforeEach(() => { h.userId = null; h.limited = 0; h.allow = true; parse.mockClear(); handler.mockClear() })

describe('route() body: — the 64 KB default', () => {
  const POST = route({ body: schema }, handler)

  it('a body of exactly 64 KB is read, validated and handed over', async () => {
    const res = await POST(post(jsonOfBytes(CAP)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ got: CAP })
  })

  it('⛔ one byte more is 413 payload_too_large: never parsed, never validated, the handler never called', async () => {
    const res = await POST(post(jsonOfBytes(CAP + 1)))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    expect(parse).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('⛔ the audit\'s body — 1 MB of empty arrays where the schema wants ≤200 strings — is refused by size, not walked by zod', async () => {
    const res = await POST(post(`{"pad":"","ids":[${Array(350_000).fill('[]').join(',')}]}`))
    expect(res.status).toBe(413)
    expect(parse).not.toHaveBeenCalled()
  })

  it('⛔ an unlabelled 10 MB stream is cut at the cap: the rest is never pulled', async () => {
    const { req, seen } = streamed(10 * 1024 * 1024)
    expect((await POST(req)).status).toBe(413)
    expect(seen.pulled).toBeLessThanOrEqual(CAP + 4096)
  })

  it('unparseable and missing bodies keep their 400 and their code', async () => {
    expect(await (await POST(post('{'))).json()).toEqual({ error: 'bad_request' })
    const coded = route({ body: schema, invalidBodyCode: 'invalid_body' }, handler)
    const res = await coded(post('not json'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect((await coded(new Request('https://eno.vn/api/x', { method: 'POST' }))).status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('route() body: — a route\'s own cap (maxBodyBytes)', () => {
  const POST = route({ body: schema, maxBodyBytes: 128 * 1024 }, handler)

  it('a body over the default but within its own cap is read', async () => {
    const res = await POST(post(jsonOfBytes(100 * 1024)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ got: 100 * 1024 })
  })

  it('one byte past its own cap is 413', async () => {
    expect((await POST(post(jsonOfBytes(128 * 1024 + 1)))).status).toBe(413)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('route() — the order is unchanged: caller, limiter, then body', () => {
  it('⛔ not signed in: 401 before a byte of the body is read', async () => {
    const POST = route({ auth: 'userId', body: schema }, handler)
    const { req, seen } = streamed(10 * 1024 * 1024)
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(seen.pulled).toBe(0)
  })

  it('over the limit: 429 before the body is read', async () => {
    h.userId = 'u1'
    h.allow = false
    const POST = route({ auth: 'userId', body: schema, rateLimit: { bucket: 'b', limit: 1, window: '1 m' } }, handler)
    const { req, seen } = streamed(10 * 1024 * 1024)
    expect((await POST(req)).status).toBe(429)
    expect(seen.pulled).toBe(0)
  })

  it('signed in and within the limit: the oversized body is the 413', async () => {
    h.userId = 'u1'
    const POST = route({ auth: 'userId', body: schema, rateLimit: { bucket: 'b', limit: 1, window: '1 m' } }, handler)
    expect((await POST(post(jsonOfBytes(CAP + 1)))).status).toBe(413)
    expect(h.limited).toBe(1)
  })

  it('without `body:` the wrapper reads nothing: the handler gets the whole body (uploads keep their own readers)', async () => {
    const POST = route({}, async ({ req }) => ({ bytes: (await req.arrayBuffer()).byteLength }))
    expect(await (await POST(post(jsonOfBytes(200 * 1024)))).json()).toEqual({ bytes: 200 * 1024 })
  })
})
