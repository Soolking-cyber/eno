import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/dashboard WITHOUT A PROFILE (inbox-10). The page reads 401 as "your session has expired" and
 * offers a sign-out, and anything else as a retryable failure — so a 401 must mean "no session" and nothing
 * else. An auth server that could not be asked is a 503.
 */

const h = vi.hoisted(() => ({ reason: 'none' as 'none' | 'unavailable', core: 0 }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => null,
  missingProfileReason: async () => h.reason,
  getAdmin: async () => null,
  isCurrentUserAdminByClaims: async () => false,
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/trust', () => ({ computeTrustV2: async () => null }))
vi.mock('@/lib/enforcement', () => ({ FLAG_REASONS: [], getEnforcement: async () => ({ state: 'good_standing', until: null }) }))
vi.mock('@/lib/core/dashboard', () => ({ dashboardStatsCore: async () => { h.core += 1; return {} } }))
vi.mock('@/lib/visa/records', () => ({ userHasVisaApplication: async () => false }))

const { GET } = await import('./route')

beforeEach(() => { h.reason = 'none'; h.core = 0 })

describe('no profile', () => {
  it('no session → 401, the page\'s "session expired"', async () => {
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ dashboard: null })
    expect(h.core).toBe(0)
  })

  it('⛔ the auth server could not be asked → 503 (Retry), never a sign-out over a blip', async () => {
    h.reason = 'unavailable'
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ dashboard: null })
    expect(h.core).toBe(0)
  })
})
