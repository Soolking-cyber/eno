import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The sandbox must never reach the database: any access to `db` fails the test.
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get: () => { throw new Error('the sandbox touched the database') } }) }))
const h = vi.hoisted(() => ({ success: true, calls: [] as Array<[string, string, number, string]> }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async (name: string, key: string, limit: number, window: string) => {
    h.calls.push([name, key, limit, window])
    return { success: h.success, limit, remaining: h.success ? limit - 1 : 0, resetSec: 30, windowSec: 60 }
  }),
}))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))

const IP = '203.0.113.9'
const T0 = Date.UTC(2026, 10, 18, 3, 0, 0)

const load = async () => {
  vi.resetModules()
  return { route: await import('./route'), lib: await import('@/lib/api/sandbox') }
}
type Route = Awaited<ReturnType<typeof load>>['route']
const call = (route: Route, method: string, path: string, opts: { key?: string; body?: string } = {}) => {
  const headers: Record<string, string> = { 'cf-connecting-ip': IP }
  if (opts.key) headers.authorization = `Bearer ${opts.key}`
  const handler = route[method as 'GET']
  return handler(new Request(`https://eno.vn/api/v1/sandbox${path}`, { method, headers, body: opts.body }))
}
const mint = async (route: Route) => (await (await call(route, 'POST', '/keys')).json()).key as string

beforeEach(() => {
  h.success = true
  h.calls = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-material')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('/api/v1/sandbox', () => {
  it('answers its service document with no credential, marked as sandbox', async () => {
    const { route } = await load()
    const res = await call(route, 'GET', '')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-sandbox')).toBe('true')
    const body = await res.json()
    expect(body).toMatchObject({ sandbox: true, get_a_key: 'POST https://eno.vn/api/v1/sandbox/keys' })
  })

  it('mints a test key per-IP limited, no-store; a denial is a 429 with Retry-After', async () => {
    const { route } = await load()
    const res = await call(route, 'POST', '/keys')
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).key).toMatch(/^eno_test_/)
    expect(h.calls[0]).toEqual(['apiv1-sandbox-key', IP, 10, '1 h'])
    h.success = false
    const denied = await call(route, 'POST', '/keys')
    expect(denied.status).toBe(429)
    expect(denied.headers.get('retry-after')).toBe('30')
    expect(await denied.json()).toMatchObject({ sandbox: true, error: { code: 'rate_limited' } })
  })

  it('⛔ a test key cannot pass for a live key or an access token, so every live endpoint refuses it unlooked-up', async () => {
    const { route } = await load()
    const { API_KEY_RE } = await import('@/lib/api/auth')
    const { looksLikeAccessToken } = await import('@/lib/api/oauth')
    const key = await mint(route)
    expect(API_KEY_RE.test(key)).toBe(false)
    expect(looksLikeAccessToken(key)).toBe(false)
  })

  it('refuses no key, a live key, a forged key and an expired key — and never echoes the credential', async () => {
    const { route, lib } = await load()
    const key = await mint(route)
    const forged = key.slice(0, -1) + (key.endsWith('0') ? '1' : '0')
    const expired = lib.mintSandboxKey(T0 - (lib.SANDBOX_KEY_TTL_SEC + 1) * 1000)!.key
    for (const k of [undefined, `eno_live_${'A'.repeat(32)}`, 'aaa.bbb.ccc', forged, expired]) {
      const res = await call(route, 'GET', '/listings', { key: k })
      expect(res.status, String(k)).toBe(401)
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer realm="sandbox"/)
      const text = await res.text()
      if (k) expect(text).not.toContain(k)
      if (k === expired) expect(text).toContain('expired')
    }
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    vi.stubEnv('CRON_SECRET', '')
    expect((await call(route, 'GET', '/listings', { key })).status).toBe(503)
  })

  it('lists, searches, pages and gets the fixture listings in the live shapes', async () => {
    const { route } = await load()
    const key = await mint(route)
    const all = await (await call(route, 'GET', '/listings', { key })).json()
    expect(all.listings).toHaveLength(6)
    expect(all.next_cursor).toBeNull()
    expect((await (await call(route, 'GET', '/listings?q=HONDA', { key })).json()).listings.map((l: { id: string }) => l.id)).toEqual(['sbx_lst_3'])
    expect((await (await call(route, 'GET', '/listings?categorySlug=rentals', { key })).json()).listings).toHaveLength(2)
    const p1 = await (await call(route, 'GET', '/listings?limit=4', { key })).json()
    const p2 = await (await call(route, 'GET', `/listings?limit=4&cursor=${p1.next_cursor}`, { key })).json()
    expect([...p1.listings, ...p2.listings].map((l: { id: string }) => l.id)).toEqual(all.listings.map((l: { id: string }) => l.id))
    expect(p2.next_cursor).toBeNull()
    expect((await (await call(route, 'GET', '/listings/sbx_lst_1', { key })).json()).listing.title).toMatch(/iPhone/)
    expect((await call(route, 'GET', '/listings/nope', { key })).status).toBe(404)
    expect((await (await call(route, 'GET', '/categories', { key })).json()).categories).toHaveLength(3)
    expect(h.calls.at(-1)).toEqual(['apiv1-sandbox', IP, 120, '1 m'])
  })

  it('create and update run the checks and store nothing', async () => {
    const { route } = await load()
    const key = await mint(route)
    const ok = await call(route, 'POST', '/listings', { key, body: JSON.stringify({ categorySlug: 'electronics', title: 'Old phone', price: 100 }) })
    expect(ok.status).toBe(201)
    expect(await ok.json()).toMatchObject({ sandbox: true, stored: false, listing: { verified: true }, received: { title: 'Old phone' } })
    const cases: Array<[string, string, string, number, string]> = [
      ['POST', '/listings', JSON.stringify({ categorySlug: 'e-visa', title: 'abc', price: 1 }), 422, 'unknown_category'],
      ['POST', '/listings', JSON.stringify({ categorySlug: 'electronics', title: 'Call 0901234567', price: 1 }), 422, 'no_phone_in_listing'],
      ['POST', '/listings', JSON.stringify({ categorySlug: 'electronics', title: 'ok title', price: -1 }), 422, 'invalid_input'],
      ['POST', '/listings', '{nope', 400, 'bad_request'],
      ['POST', '/listings', JSON.stringify({ title: 'x'.repeat(17_000) }), 413, 'payload_too_large'],
      ['PATCH', '/listings/sbx_lst_1', '{}', 422, 'invalid_input'],
      ['PATCH', '/listings/nope', '{"price":1}', 404, 'not_found'],
    ]
    for (const [method, path, body, status, code] of cases) {
      const res = await call(route, method, path, { key, body })
      expect(res.status, `${method} ${path} ${body.slice(0, 40)}`).toBe(status)
      expect((await res.json()).error.code).toBe(code)
    }
    const patched = await call(route, 'PATCH', '/listings/sbx_lst_1', { key, body: '{"price":1}' })
    expect(await patched.json()).toMatchObject({ ok: true, stored: false, received: { price: 1 } })
    // Nothing changed: the fixture still has its own price.
    expect((await (await call(route, 'GET', '/listings/sbx_lst_1', { key })).json()).listing.price).toBe(9_500_000)
  })

  it('the export is a 202 + Location job, pending → running → done, readable only by its own key for an hour', async () => {
    const { route } = await load()
    const key = await mint(route)
    const other = await mint(route)
    const res = await call(route, 'POST', '/exports', { key })
    expect(res.status).toBe(202)
    const job = await res.json()
    expect(job).toMatchObject({ status: 'pending', sandbox: true })
    expect(res.headers.get('location')).toBe(job.statusUrl)
    expect(job.statusUrl).toBe(`https://eno.vn/api/v1/sandbox/exports/${job.jobId}`)
    const poll = () => call(route, 'GET', `/exports/${job.jobId}`, { key })
    const first = await poll()
    expect(first.headers.get('retry-after')).toBe('5')
    expect(await first.json()).toMatchObject({ status: 'pending', result: null })
    vi.setSystemTime(T0 + 3_000)
    expect((await (await poll()).json()).status).toBe('running')
    vi.setSystemTime(T0 + 6_000)
    const done = await poll()
    expect(done.headers.get('retry-after')).toBeNull()
    expect(await done.json()).toMatchObject({ status: 'done', result: { count: 6 } })
    expect((await call(route, 'GET', `/exports/${job.jobId}`, { key: other })).status).toBe(404)
    expect((await call(route, 'GET', `/exports/${job.jobId.slice(0, -1)}${job.jobId.endsWith('0') ? '1' : '0'}`, { key })).status).toBe(404)
    vi.setSystemTime(T0 + 3_601_000)
    expect((await poll()).status).toBe(404)
  })

  it('a wrong method is a JSON 405 with Allow; an unknown path a JSON 404', async () => {
    const { route } = await load()
    const res = await call(route, 'DELETE', '/listings/sbx_lst_1')
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, PATCH')
    const nf = await call(route, 'GET', '/shop')
    expect(nf.status).toBe(404)
    expect(await nf.json()).toMatchObject({ sandbox: true, error: { code: 'not_found' } })
  })

  it('every /sandbox operation in the OpenAPI document is answered by the route, and the export documents 202 + Location', async () => {
    const { route } = await load()
    const { SPEC } = await import('@/app/api/v1/openapi.json/route')
    const key = await mint(route)
    const { jobId } = await (await call(route, 'POST', '/exports', { key })).json()
    const paths = (SPEC as unknown as { paths: Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>> }).paths
    const sandbox = Object.entries(paths).filter(([p]) => p.startsWith('/sandbox'))
    expect(sandbox.length).toBe(7)
    for (const [p, ops] of sandbox) {
      for (const method of Object.keys(ops)) {
        const path = p.replace(/^\/sandbox/, '').replace('{id}', 'sbx_lst_1').replace('{jobId}', jobId)
        const res = await call(route, method.toUpperCase(), path, { key, body: method === 'get' ? undefined : '{"price":1}' })
        expect([404, 405], `${method} ${p}`).not.toContain(res.status)
      }
    }
    expect(Object.keys(paths['/sandbox/exports'].post.responses['202'].headers ?? {})).toEqual(expect.arrayContaining(['Location', 'Retry-After', 'X-Sandbox']))
  })
})
