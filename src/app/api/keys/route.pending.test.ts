import { describe, expect, it, vi } from 'vitest'

/**
 * Dashboard › Developers lists keys and sign-in grants, never a sign-in still waiting for its code — and never loses a
 * live key to SQL's three-valued logic: NOT (revokedAt = epoch) is NULL, i.e. false, for a live key's NULL revokedAt, so
 * the filter must OR in `revokedAt: null` (review 2026-11-13). This runs the real GET and inspects the query it sends.
 */
const h = vi.hoisted(() => ({ where: null as unknown }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', accountType: 'business' }) }))
vi.mock('@/lib/db', () => ({
  db: {
    apiKey: { findMany: async (a: { where: unknown }) => { h.where = a.where; return [] } },
    seller: { findUnique: async () => ({ id: 'shop1' }) },
  },
}))
vi.mock('@/lib/api/auth', () => ({ generateApiKey: () => ({}) }))

describe('GET /api/keys', () => {
  it('excludes pending sign-ins without dropping live keys (revokedAt null)', async () => {
    const { GET } = await import('./route')
    const { PENDING_AT } = await import('@/lib/api/oauth-grant')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.where).toEqual({ sellerId: 'shop1', OR: [{ revokedAt: null }, { revokedAt: { not: PENDING_AT } }] })
    expect(PENDING_AT.getTime()).toBe(0)
  })
})
