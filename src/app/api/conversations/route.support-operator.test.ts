import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations — who sees the support desk's threads (speed plan item 6). The operators, confirmed by
 * getAdmin() (an auth-server round trip), asked only after the locally verified claims say "admin": every other
 * signed-in page load skips the round trip, and nobody gains the desk who did not have it.
 */

const h = vi.hoisted(() => ({ claimsAdmin: false, admin: null as string | null, getAdminCalls: 0, where: null as null | { OR: unknown[] } }))

vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, editionSellerScope: async () => ({}) }))
vi.mock('@/lib/db', () => ({
  db: { conversation: { findMany: async ({ where }: { where: { OR: unknown[] } }) => { h.where = where; return [] } } },
}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => null,
  getCurrentProfileId: async () => 'me-1',
  isCurrentUserAdminByClaims: async () => h.claimsAdmin,
  getAdmin: async () => { h.getAdminCalls += 1; return h.admin },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => Promise.resolve({ success: true }) }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: () => Promise.resolve(null) }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: () => Promise.resolve(false), blockedConversationIds: () => Promise.resolve([]) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: () => Promise.resolve() }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: () => Promise.resolve() }))
vi.mock('@/lib/messages', () => ({ insertMessage: () => Promise.resolve({ id: 'm1', body: '', createdAt: new Date().toISOString() }) }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing', threadKindResolver: async () => () => 'listing' }))
vi.mock('@/lib/visa-shop', () => ({ isVisaShopListing: async () => false, getVisaShopSeller: async () => null }))
vi.mock('@/lib/visa/dm-flow', () => ({ startVisaDmFlow: async () => ({ ok: false }) }))

const { GET } = await import('./route')
const { SUPPORT_SELLER_ID } = await import('@/lib/support-thread')

beforeEach(() => { h.claimsAdmin = false; h.admin = null; h.getAdminCalls = 0; h.where = null })

const deskBranch = () => (h.where?.OR ?? []).some((b) => (b as { sellerId?: unknown }).sellerId === SUPPORT_SELLER_ID)
const load = async () => {
  const res = await GET(new Request('http://test/api/conversations'))
  expect(res.status).toBe(200)
}

describe('the support desk in the inbox', () => {
  it('a non-admin never pays the auth-server round trip and never gets the desk', async () => {
    await load()
    expect(h.getAdminCalls).toBe(0)
    expect(deskBranch()).toBe(false)
  })

  it('claims say admin, the auth server says no (demoted, signed out) → no desk', async () => {
    h.claimsAdmin = true
    await load()
    expect(h.getAdminCalls).toBe(1)
    expect(deskBranch()).toBe(false)
  })

  it('claims and the auth server both say admin → the desk threads are listed', async () => {
    h.claimsAdmin = true
    h.admin = 'ops@example.test'
    await load()
    expect(deskBranch()).toBe(true)
  })

  it('the auth server alone does not add the desk — a stale claim can only withhold it', async () => {
    h.admin = 'ops@example.test'
    await load()
    expect(h.getAdminCalls).toBe(0)
    expect(deskBranch()).toBe(false)
  })
})
