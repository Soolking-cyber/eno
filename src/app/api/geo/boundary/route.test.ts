import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/geo/boundary — the only route that sends a request to a third party (Nominatim) on eno's identified User-Agent.
 * Sweep 2026-10-22: the allow-list checked the ward and the province each on its own (any ward × any province passed:
 * hundreds of thousands of fresh keys, each a cache miss and an outbound search), and nothing throttled the outbound
 * path. A ward must be in its province, a curated district in HCMC, and only a cache miss spends the per-IP budget.
 */
const h = vi.hoisted(() => ({ cached: [] as unknown[], limited: false, limiterCalls: 0, limiters: [] as string[], fetches: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { $queryRaw: async () => h.cached, $executeRaw: async () => 1 } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async (name: string, key: string) => { h.limiterCalls++; h.limiters.push(`${name}:${key}`); return { success: !h.limited } } }))

const { GET } = await import('./route')
const get = (q: Record<string, string>) => GET(new NextRequest(`https://eno.vn/api/geo/boundary?${new URLSearchParams(q)}`))

afterEach(() => { vi.restoreAllMocks() })
beforeEach(() => {
  h.cached = []; h.limited = false; h.limiterCalls = 0; h.limiters = []; h.fetches = []
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { h.fetches.push(String(u)); return new Response('[]', { status: 200 }) }))
})

describe('/api/geo/boundary — what may reach Nominatim', () => {
  it('a ward in its own province passes, in either spelling', async () => {
    expect((await get({ kind: 'ward', name: 'Sài Gòn', province: 'Hồ Chí Minh' })).status).not.toBe(400)
    expect((await get({ kind: 'ward', name: 'Sai Gon', province: 'Ho Chi Minh' })).status).not.toBe(400)
    expect(h.fetches.length).toBeGreaterThan(0)
    // Per caller AND globally: Nominatim's ~1 req/s is per eno's server IP, whoever asked.
    expect(h.limiters).toEqual(expect.arrayContaining([expect.stringMatching(/^geo-boundary:/), 'geo-boundary-global:global']))
  })
  it('⛔ a real ward with ANOTHER province is refused before any lookup', async () => {
    expect((await get({ kind: 'ward', name: 'Sài Gòn', province: 'Hà Nội' })).status).toBe(400)
    expect(h.fetches).toEqual([])
    expect(h.limiterCalls).toBe(0)
  })
  it('⛔ a curated district is only asked for in Ho Chi Minh City — in either spelling vn-units.json gives it', async () => {
    // A district tries several names with a 1.1 s pause between misses (Nominatim's politeness): no pause in a test.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as unknown as typeof setTimeout)
    expect((await get({ kind: 'district', name: 'Bình Thạnh', province: 'Hà Nội' })).status).toBe(400)
    expect(h.fetches).toEqual([])
    expect((await get({ kind: 'district', name: 'Bình Thạnh', province: 'Hồ Chí Minh' })).status).not.toBe(400)
    expect((await get({ kind: 'district', name: 'Binh Thanh District', province: 'Ho Chi Minh' })).status).not.toBe(400)
    expect(h.fetches.length).toBeGreaterThan(0)
  })
  it('⛔ the outbound path is throttled per IP: refused, it answers a transient 503 and asks nothing', async () => {
    h.limited = true
    const r = await get({ kind: 'ward', name: 'Sài Gòn', province: 'Hồ Chí Minh' })
    expect(r.status).toBe(503)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(h.fetches).toEqual([])
  })
  it('a cache hit never touches the limiter', async () => {
    h.cached = [{ geojson: { type: 'Polygon', coordinates: [] }, found: true, stale: false }]
    h.limited = true
    expect((await get({ kind: 'ward', name: 'Sài Gòn', province: 'Hồ Chí Minh' })).status).toBe(200)
    expect(h.limiterCalls).toBe(0)
  })
})
