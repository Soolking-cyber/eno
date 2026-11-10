// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE PUBLIC HANDLERS THAT PARSE A BODY BEFORE ANY LIMITER (appsec-02) — the ones with no test file of their own.
 * Each reads its body through readJsonCapped (src/lib/api/body.ts): one byte past 64 KB is refused before it is
 * parsed, so nothing behind it runs — no limiter, no auth call, no write. The beacons keep their "always 204".
 * email-link, password, handoff/open, apple/native, translate, unsubscribe and csp-report pin the same in their own tests.
 */
const h = vi.hoisted(() => ({
  limited: [] as unknown[][],
  /** Anything behind the body read that ran: an auth call, a write, a log. */
  touched: [] as string[],
  /** The handoff cookie redeem checks before its body. */
  nonce: '',
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.limited.push(a); return { success: true, remaining: 1, limit: 1, resetSec: 60 } },
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => { h.touched.push('supabase'); throw new Error('not in this test') } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: h.nonce }), set: () => {} }),
  headers: async () => new Headers(),
}))
vi.mock('@/lib/auth/handoff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/handoff')>()),
  consentAndMintPair: async () => { h.touched.push('consent'); return null },
  voidHandoff: async () => { h.touched.push('void') },
  redeemPair: async () => { h.touched.push('redeem'); return { ok: false, reason: 'wrong' } },
}))
vi.mock('@/lib/meta-capi', () => ({
  metaCapiConfigured: () => true,
  metaUserDataFromHeaders: () => { h.touched.push('capi'); return {} },
  sendMetaCapiEvent: async () => { h.touched.push('capi-send') },
}))
vi.mock('@/lib/trending', () => ({ getTrending: async () => [], logSearch: async () => { h.touched.push('logSearch') } }))
vi.mock('@/lib/listing-counters', () => ({
  bumpListingCounter: async () => { h.touched.push('bump') }, dropListingSave: async () => { h.touched.push('drop') },
}))

const { newNonce } = await import('@/lib/auth/handoff')
h.nonce = newNonce()

const CAP = 64 * 1024
/** A valid JSON object of exactly `n` bytes, carrying `fields` — so only the size can refuse it. */
const jsonOfBytes = (n: number, fields: Record<string, unknown> = {}) => {
  const shell = JSON.stringify({ ...fields, pad: '' })
  return JSON.stringify({ ...fields, pad: 'a'.repeat(n - shell.length) })
}
const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://eno.vn', ...headers }, body })

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) })

beforeEach(() => { h.limited.length = 0; h.touched.length = 0 })

describe('one byte past 64 KB → 413 payload_too_large, before the limiter and before anything it guards', () => {
  /** The handoff routes and native-session put no-store on every answer; their 413 keeps it. */
  const HANDOFF_NO_STORE = 'no-store, no-cache, must-revalidate'
  const cases: { name: string; load: () => Promise<Handler>; url: string; fields: Record<string, unknown>; cacheControl: string | null }[] = [
    { name: 'auth/native-session', load: async () => (await import('./auth/native-session/route')).POST as unknown as Handler, url: 'https://eno.vn/api/auth/native-session', fields: { access_token: 'a', refresh_token: 'r' }, cacheControl: 'no-store' },
    { name: 'auth/handoff/consent', load: async () => (await import('./auth/handoff/consent/route')).POST as unknown as Handler, url: 'https://eno.vn/api/auth/handoff/consent', fields: { nonce: newNonce(), agreed: true }, cacheControl: HANDOFF_NO_STORE },
    { name: 'auth/handoff/redeem', load: async () => (await import('./auth/handoff/redeem/route')).POST as unknown as Handler, url: 'https://eno.vn/api/auth/handoff/redeem', fields: { pair: '123456' }, cacheControl: HANDOFF_NO_STORE },
    { name: 'listings/[id]/save', load: async () => (await import('./listings/[id]/save/route')).POST as unknown as Handler, url: 'https://eno.vn/api/listings/l1/save', fields: { saved: true }, cacheControl: null },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const POST = await c.load()
      const res = await POST(post(c.url, jsonOfBytes(CAP + 1, c.fields)), params({ id: 'l1' }))
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: 'payload_too_large' })
      expect(res.headers.get('cache-control')).toBe(c.cacheControl)
      expect(h.limited).toEqual([])
      expect(h.touched).toEqual([])
    })
  }

  it('v1/oauth/token answers in its RFC 6749 envelope, no-store, before either limiter — JSON and form bodies alike', async () => {
    const { POST } = await import('./v1/oauth/token/route')
    const fields = { grant_type: 'client_credentials', client_secret: 'eno_live_x' }
    for (const req of [
      post('https://eno.vn/api/v1/oauth/token', jsonOfBytes(CAP + 1, fields)),
      post('https://eno.vn/api/v1/oauth/token', `grant_type=client_credentials&pad=${'a'.repeat(CAP)}`, { 'content-type': 'application/x-www-form-urlencoded' }),
    ]) {
      const res = await POST(req as never)
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: 'invalid_request', error_description: 'Request body too large.' })
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(h.limited).toEqual([])
  })

  it('v1/oauth/token under the cap still reads JSON and form bodies as before', async () => {
    const { POST } = await import('./v1/oauth/token/route')
    // grant_type is read from the body: a wrong one is refused 400 by name, which proves the body was parsed.
    for (const req of [
      post('https://eno.vn/api/v1/oauth/token', JSON.stringify({ grant_type: 'password' })),
      post('https://eno.vn/api/v1/oauth/token', 'grant_type=password', { 'content-type': 'application/x-www-form-urlencoded' }),
    ]) {
      const res = await POST(req as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('unsupported_grant_type')
    }
    // the shape of the secret is checked from the body too: a well-formed grant with a bad secret reaches 401, not 400
    const res = await POST(post('https://eno.vn/api/v1/oauth/token', 'grant_type=client_credentials&client_secret=nope', { 'content-type': 'application/x-www-form-urlencoded' }) as never)
    expect(res.status).toBe(401)
  })
})

describe('the beacons keep their "always 204" — an oversized body is one more silent no-op, never parsed', () => {
  it('track/view', async () => {
    const { POST } = await import('./track/view/route')
    const res = await POST(post('https://eno.vn/api/track/view', jsonOfBytes(CAP + 1, { id: 'l1', eventId: 'e1' })) as never)
    expect(res.status).toBe(204)
    expect(h.limited).toEqual([])
    expect(h.touched).toEqual([])
  })

  it('search/trending', async () => {
    const { POST } = await import('./search/trending/route')
    const res = await POST(post('https://eno.vn/api/search/trending', jsonOfBytes(CAP + 1, { q: 'bike' })))
    expect(res.status).toBe(204)
    expect(h.touched).toEqual([])
    // …while a body under the cap is still logged
    const ok = await POST(post('https://eno.vn/api/search/trending', JSON.stringify({ q: 'bike' })))
    expect(ok.status).toBe(204)
    expect(h.touched).toEqual(['logSearch'])
  })
})
