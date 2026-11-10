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
  summaryCore: 0,
  trust: 0,
  enforcement: 0,
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  missingProfileReason: async () => h.reason,
  getAdmin: async () => { h.getAdminCalls += 1; return h.admin },
  isCurrentUserAdminByClaims: async () => h.claimsAdmin,
}))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => null }, report: { findMany: async () => [] } } }))
vi.mock('@/lib/teachers/draft', () => ({ teacherDraftProgress: async () => null }))
vi.mock('@/lib/trust', () => ({ computeTrustV2: async () => { h.trust += 1; return null } }))
vi.mock('@/lib/enforcement', () => ({ FLAG_REASONS: [], getEnforcement: async () => { h.enforcement += 1; return { state: 'good_standing', until: null } } }))
vi.mock('@/lib/core/dashboard', () => ({
  dashboardStatsCore: async () => { h.core += 1; return { tier: 'individual', profile: {}, seller: null, stats: {}, listings: [] } },
  dashboardSummaryCore: async () => { h.summaryCore += 1; return { tier: 'individual', profile: {}, seller: null } },
}))
vi.mock('@/lib/visa/records', () => ({ userHasVisaApplication: async () => false }))

const route = await import('./route')
const GET = (query = '') => route.GET(new Request(`http://x/api/dashboard${query}`))

beforeEach(() => {
  h.reason = 'none'; h.core = 0; h.profile = null; h.claimsAdmin = false; h.admin = null; h.getAdminCalls = 0
  h.summaryCore = 0; h.trust = 0; h.enforcement = 0
})

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

/**
 * ?view=summary (speed plan R13, audit api-01): the rail, the explorer and the dashboard pages that show no listing read
 * the summary. One account's full answer was 16.5 MB, sent on every page it opened, and stalled the server each time.
 */
describe('?view=summary', () => {
  beforeEach(() => { h.profile = { id: 'p1' } })

  it('never loads the listings, the trust inputs or the enforcement panel — and answers without them', async () => {
    const res = await GET('?view=summary')
    expect(res.status).toBe(200)
    const { dashboard } = (await res.json()) as { dashboard: Record<string, unknown> }
    expect(h.core).toBe(0)
    expect(h.trust).toBe(0)
    expect(h.enforcement).toBe(0)
    expect(h.summaryCore).toBe(1)
    expect(Object.keys(dashboard).sort()).toEqual(['hasTeacher', 'hasVisa', 'isAdmin', 'profile', 'seller', 'teacherDraft', 'tier'])
  })

  it('carries the same admin verdict as the full answer (claims first, then the auth server)', async () => {
    h.claimsAdmin = true
    h.admin = 'ops@example.test'
    const { dashboard } = (await (await GET('?view=summary')).json()) as { dashboard: { isAdmin: boolean } }
    expect(dashboard.isAdmin).toBe(true)
    expect(h.getAdminCalls).toBe(1)
  })

  it('no session → the same 401, and nothing is read', async () => {
    h.profile = null
    const res = await GET('?view=summary')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ dashboard: null })
    expect(h.summaryCore).toBe(0)
  })

  it('the plain URL is unchanged: the listings, the stats, enforcement and trustProgress (a native build may read them)', async () => {
    const { dashboard } = (await (await GET()).json()) as { dashboard: Record<string, unknown> }
    expect(h.core).toBe(1)
    expect(h.summaryCore).toBe(0)
    expect(dashboard).toHaveProperty('listings')
    expect(dashboard).toHaveProperty('stats')
    expect(dashboard).toHaveProperty('enforcement')
    expect(dashboard).toHaveProperty('trustProgress')
    expect(dashboard).toMatchObject({ isAdmin: false, hasVisa: false, hasTeacher: false, teacherDraft: null })
  })
})
