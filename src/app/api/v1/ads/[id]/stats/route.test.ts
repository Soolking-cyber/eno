import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** GET /api/v1/ads/{id}/stats: the booking shop's own ad only (another shop's is a 404), never cached. */
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async (_r: unknown, scope: string) => (scope === 'analytics:read'
    ? { ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set([scope]) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }
    : { ok: false, status: 403, code: 'insufficient_scope', message: 'x' }),
}))
vi.mock('@/lib/ads/stats', () => ({ shopAdFigures: async (id: string, sellerId: string) => (id === 'ad1' && sellerId === 's1' ? { ad_id: 'ad1', totals: { impressions: 3 } } : null) }))
const { GET } = await import('./route')
const get = (id: string) => GET(new NextRequest(`https://eno.vn/api/v1/ads/${id}/stats`, { headers: { authorization: 'Bearer eno_live_x' } }), { params: Promise.resolve({ id }) })

describe('GET /api/v1/ads/{id}/stats', () => {
  it('the shop\'s ad: 200, no-store', async () => {
    const r = await get('ad1')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(await r.json()).toEqual({ stats: { ad_id: 'ad1', totals: { impressions: 3 } } })
  })
  it('another shop\'s ad, or none: 404', async () => {
    expect((await get('ad2')).status).toBe(404)
  })
})
