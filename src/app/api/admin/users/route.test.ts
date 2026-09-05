import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Users console list API: admin-only, and the search/filter/cursor reach the lib unchanged.
const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, admin: null as string | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.admin, isAdminEmail: (e: string | null) => e === 'admin@eno.vn' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/admin-users', () => ({
  ADMIN_USER_FILTERS: ['all', 'pending_identity', 'verified', 'enforced', 'sellers'],
  searchAdminUsers: async (input: Record<string, unknown>) => { h.calls.push(input); return { rows: [], nextCursor: null } },
}))

const { GET } = await import('./route')
const req = (qs = '') => new Request(`https://eno.vn/api/admin/users${qs}`)

beforeEach(() => { h.calls = []; h.admin = 'admin@eno.vn' })

describe('GET /api/admin/users', () => {
  it('is admin-only', async () => {
    h.admin = null
    const res = await GET(req('?q=x'))
    expect(res.status).toBeGreaterThanOrEqual(401)
    expect(res.status).toBeLessThan(500)
    expect(h.calls).toEqual([])
  })
  it('passes q, a known filter and the cursor through; an unknown filter falls back to all', async () => {
    expect((await GET(req('?q=alice&filter=sellers&cursor=c1'))).status).toBe(200)
    expect(h.calls[0]).toEqual({ q: 'alice', filter: 'sellers', cursor: 'c1' })
    await GET(req('?filter=bogus'))
    expect(h.calls[1]).toEqual({ q: '', filter: 'all', cursor: null })
  })
})
