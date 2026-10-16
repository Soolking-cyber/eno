import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/dashboard WITHOUT A PROFILE (inbox-10). The page reads 401 as "your session has expired" and
 * offers a sign-out, and anything else as a retryable failure — so a 401 must mean "no session" and nothing
 * else. An auth server that could not be asked is a 503.
 */

const h = vi.hoisted(() => ({
  reason: 'none' as 'none' | 'unavailable',
  core: 0,
  profile: null as null | { id: string },
  claimsAdmin: false,
  admin: null as string | null,
  getAdminCalls: 0,
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  missingProfileReason: async () => h.reason,
  getAdmin: async () => { h.getAdminCalls += 1; return h.admin },
  isCurrentUserAdminByClaims: async () => h.claimsAdmin,
}))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => null }, report: { findMany: async () => [] } } }))
vi.mock('@/lib/teachers/draft', () => ({ teacherDraftProgress: async () => null }))
vi.mock('@/lib/trust', () => ({ computeTrustV2: async () => null }))
vi.mock('@/lib/enforcement', () => ({ FLAG_REASONS: [], getEnforcement: async () => ({ state: 'good_standing', until: null }) }))
vi.mock('@/lib/core/dashboard', () => ({ dashboardStatsCore: async () => { h.core += 1; return {} } }))
vi.mock('@/lib/visa/records', () => ({ userHasVisaApplication: async () => false }))

const { GET } = await import('./route')

beforeEach(() => { h.reason = 'none'; h.core = 0; h.profile = null; h.claimsAdmin = false; h.admin = null; h.getAdminCalls = 0 })

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

/**
 * The nav rail's admin flag (speed plan item 6): getAdmin() — an auth-server round trip — only after the locally verified
 * claims say "admin". Everyone else skips the round trip; the flag still needs both to say yes.
 */
describe('isAdmin', () => {
  beforeEach(() => { h.profile = { id: 'p1' } })
  const isAdmin = async () => ((await (await GET()).json()) as { dashboard: { isAdmin: boolean } }).dashboard.isAdmin

  it('a non-admin never pays the auth-server round trip', async () => {
    expect(await isAdmin()).toBe(false)
    expect(h.getAdminCalls).toBe(0)
  })

  it('claims say admin, the auth server says no (demoted, signed out) → false', async () => {
    h.claimsAdmin = true
    expect(await isAdmin()).toBe(false)
    expect(h.getAdminCalls).toBe(1)
  })

  it('claims and the auth server both say admin → true', async () => {
    h.claimsAdmin = true
    h.admin = 'ops@example.test'
    expect(await isAdmin()).toBe(true)
  })

  it('the auth server alone does not set it — a stale claim can only withhold the flag', async () => {
    h.admin = 'ops@example.test'
    expect(await isAdmin()).toBe(false)
    expect(h.getAdminCalls).toBe(0)
  })
})
