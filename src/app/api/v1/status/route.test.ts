import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/v1/status — the partner API's only unauthenticated operation.
 *
 * ⛔ WHAT THIS FILE IS ACTUALLY PINNING, BECAUSE IT IS NOT THE JSON BODY. An agent audit on
 * 2026-08-23 reported the rate-limit headers as documented-but-unverified: the scanner could not
 * reach a single endpoint that emits them, because everything public rejects before the limiter
 * runs. This route exists to be that reachable response, so the headers ARE the feature and the
 * body is the excuse. A regression here does not throw and does not fail a build — it just
 * quietly returns to the state the audit found, which is why every header is asserted by shape
 * rather than by presence.
 *
 * ⚠️ THE LIMITER IS MOCKED, AND THE MOCK IS ALSO THE ASSERTION. `rateLimit` is the only backend
 * call this handler may make; a spy on it therefore doubles as proof that the endpoint stayed
 * cheap. `@/lib/db` is mocked to an object with NO methods, so any database access added to this
 * route later fails this suite with a TypeError instead of shipping an anonymous-flood amplifier.
 */

const h = vi.hoisted(() => ({
  // Mutable so a test can hand back a denial or a different window.
  result: { success: true, limit: 60, remaining: 59, resetSec: 37, windowSec: 60 },
  calls: [] as Array<[string, string, number, string]>,
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async (name: string, key: string, limit: number, window: string) => {
    h.calls.push([name, key, limit, window])
    return { ...h.result, limit }
  }),
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const IP = '203.0.113.7'

const load = async () => {
  vi.resetModules()
  return import('./route')
}

/** A request the way Cloudflare delivers one — clientIp() prefers `cf-connecting-ip`. */
const req = (ip = IP) =>
  new Request('https://eno.vn/api/v1/status', { headers: { 'cf-connecting-ip': ip } }) as never

beforeEach(() => {
  h.result = { success: true, limit: 60, remaining: 59, resetSec: 37, windowSec: 60 }
  h.calls = []
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/v1/status', () => {
  it('⛔ ANSWERS 200 WITH NO CREDENTIAL — the whole point of the route', async () => {
    const { GET } = await load()
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it('⛔ EMITS WELL-FORMED RateLimit AND RateLimit-Policy, not merely present ones', async () => {
    const { GET } = await load()
    const res = await GET(req())
    // Structured-field dictionary. A missing `reset`, or the literal string "undefined" leaking
    // in from an absent snapshot field, both parse as "a header exists" to a naive check.
    expect(res.headers.get('RateLimit')).toBe('limit=60, remaining=59, reset=37')
    expect(res.headers.get('RateLimit')).toMatch(/^limit=\d+, remaining=\d+, reset=[1-9]\d*$/)
    // `<limit>;w=<window-seconds>` — the quota itself, so a client need not infer the window.
    expect(res.headers.get('RateLimit-Policy')).toBe('60;w=60')
    expect(res.headers.get('RateLimit-Policy')).toMatch(/^\d+;w=\d+$/)
    // The pre-standard aliases ship too: partners already branch on them (src/lib/api/respond.ts).
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('59')
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('⚠️ SETS no-store — per-caller numbers must never reach a shared cache', async () => {
    // A cached 200 would serve caller B the `remaining` measured for caller A. That is the one
    // way an honest header becomes a lie, and it is silent.
    const { GET } = await load()
    const res = await GET(req())
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does NOT send Retry-After on a 200', async () => {
    // RFC 9110 §10.2.3 gives Retry-After a meaning on more than 429; emitting it on a success
    // would tell a client its own successful request is worth repeating later.
    const { GET } = await load()
    expect((await GET(req())).headers.get('Retry-After')).toBeNull()
  })

  it('⛔ 429 CARRIES Retry-After, AND IT MATCHES THE SNAPSHOT reset', async () => {
    h.result = { success: false, limit: 60, remaining: 0, resetSec: 12, windowSec: 60 }
    const { GET } = await load()
    const res = await GET(req())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('12')
    // Two numbers from one measurement: a client that reads either must get the same answer.
    expect(res.headers.get('RateLimit')).toBe('limit=60, remaining=0, reset=12')
    expect(res.headers.get('RateLimit-Policy')).toBe('60;w=60')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } })
  })

  it('⚠️ BODY AND HEADERS COME FROM THE SAME SNAPSHOT — they cannot disagree', async () => {
    h.result = { success: true, limit: 60, remaining: 41, resetSec: 8, windowSec: 60 }
    const { GET } = await load()
    const res = await GET(req())
    const body = await res.json()
    expect(res.headers.get('RateLimit')).toBe('limit=60, remaining=41, reset=8')
    expect(body.rate_limit).toEqual({
      limit: 60,
      remaining: 41,
      reset: 8,
      window_seconds: 60,
      keyed_by: 'ip',
      // Stated outright so a client never infers the 600/min API budget from this small one.
      authenticated: { limit: 600, window_seconds: 60, keyed_by: 'api_key' },
    })
  })

  it('⚠️ KEYS THE BUCKET BY CLIENT IP, in its own named window, and touches nothing else', async () => {
    const { GET, STATUS_RATE_PER_MIN } = await load()
    await GET(req())
    // One backend call for the whole request. `@/lib/db` is mocked to `{}`, so a query added here
    // would have thrown before reaching this line.
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toEqual(['apiv1-status', IP, STATUS_RATE_PER_MIN, '1 m'])
    expect(STATUS_RATE_PER_MIN).toBe(60)
  })

  it('publishes the discovery links on the host that SERVED the response, not a hardcoded eno.vn', async () => {
    // /api/v1 compiles into both editions. The same class of bug put `iss: https://eno.vn` in
    // every token eno.forum issued and `servers: https://eno.vn/api/v1` in the spec it served —
    // and it matters more here, because handing out addresses is this document's only job.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    const { GET } = await load()
    const body = await (await GET(req())).json()
    expect(body.edition).toBe('services')
    expect(body.service).toBe('eno.forum Partner API')
    expect(Object.values(body.documentation).every((u) => String(u).startsWith('https://www.eno.forum/'))).toBe(true)
    expect(JSON.stringify(body)).not.toContain('eno.vn')
    expect(body.documentation).toEqual({
      openapi: 'https://www.eno.forum/openapi.json',
      oauth_authorization_server: 'https://www.eno.forum/.well-known/oauth-authorization-server',
      oauth_protected_resource: 'https://www.eno.forum/.well-known/oauth-protected-resource',
      developers: 'https://www.eno.forum/developers',
      llms_txt: 'https://www.eno.forum/llms.txt',
    })
  })

  it('names itself correctly on the marketplace edition', async () => {
    const { GET } = await load()
    const body = await (await GET(req())).json()
    expect(body.edition).toBe('marketplace')
    expect(body.api_version).toBe('v1')
    expect(body.status).toBe('ok')
    expect(Date.parse(body.time)).not.toBeNaN()
    expect(body.documentation.openapi).toBe('https://eno.vn/openapi.json')
  })
})

describe('the spec entry for /status', () => {
  it('⛔ DECLARES security: [] — an agent must know this one needs no credential', async () => {
    const { SPEC } = await import('../openapi.json/route')
    const op = (SPEC.paths as unknown as Record<string, { get?: Record<string, unknown> }>)['/status']?.get
    expect(op, '/status must be documented or nothing will discover it').toBeTruthy()
    // An empty array is OpenAPI's way of saying "overrides the document-level requirement with
    // none". Omitting the field entirely would inherit `security: [bearerAuth, oauth2]` and
    // produce clients that send a credential they do not have.
    expect(op!.security).toEqual([])
    expect(op!.operationId).toBe('getApiStatus')
  })

  it('documents the headers the handler actually emits, on both statuses', async () => {
    const { SPEC } = await import('../openapi.json/route')
    type Resp = { headers?: Record<string, unknown> }
    const op = (SPEC.paths as unknown as Record<string, { get: { responses: Record<string, Resp> } }>)['/status'].get
    for (const status of ['200', '429']) {
      const headers = Object.keys(op.responses[status].headers || {})
      expect(headers, `${status} must document RateLimit`).toContain('RateLimit')
      expect(headers, `${status} must document RateLimit-Policy`).toContain('RateLimit-Policy')
    }
    expect(Object.keys(op.responses['429'].headers || {})).toContain('Retry-After')
    expect(Object.keys(op.responses['200'].headers || {})).not.toContain('Retry-After')
  })
})
