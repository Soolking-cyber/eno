import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sellers/[id]/reviews — WHO counts as having bought (security review 2026-10-22, item 32).
 *
 * "The listing is sold" used to be enough, so anyone who had messaged about an item that sold to SOMEONE ELSE could
 * post a "Verified buyer" review — which also counts toward distinctBuyerReviews and the trust tier. The sale must
 * name THIS caller as its eno buyer (awaiting their answer, or confirmed by them), or an offer in this thread must
 * have been accepted AND the sale record must not say otherwise (unsold, or sold with nobody named).
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  created: [] as Row[],
  listing: {} as Row,
  acceptedOffers: 0,
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'buyer-1', displayName: 'Lan', email: 'lan@example.com' }),
  getCurrentProfileId: async () => 'buyer-1',
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/trust', () => ({ recordReview: async () => {} }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer-1', listing: { id: 'L1', sellerId: 'shop-1', ...h.listing } }) },
    message: { count: async () => h.acceptedOffers },
    review: { create: async ({ data }: Row) => { h.created.push(data); return { id: 'r1' } } },
    forumModerationAction: { findFirst: async () => null },
  },
}))

const { POST } = await import('./route')

async function review() {
  const res = await POST(new Request('https://eno.vn/api/sellers/shop-1/reviews', { method: 'POST', body: JSON.stringify({ conversationId: 'c1', rating: 5 }) }) as never, { params: Promise.resolve({ id: 'shop-1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

const sold = (over: Row = {}): Row => ({
  status: 'sold', complianceStatus: null, soldChannel: 'eno', soldToProfileId: 'buyer-1', soldAt: new Date(),
  salePrice: null, saleConfirmedAt: null, saleDeclinedAt: null, saleBuyerHistory: null, saleConfirmPromptedAt: null, ...over,
})

beforeEach(() => {
  h.created = []
  h.listing = sold()
  h.acceptedOffers = 0
})

describe('a "Verified buyer" review needs a sale to THIS caller', () => {
  it('⛔ sold to someone else: refused — the hole this closes', async () => {
    h.listing = sold({ soldToProfileId: 'buyer-2' })
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    expect(h.created).toEqual([])
  })

  it('sold to this caller, awaiting their answer: allowed', async () => {
    expect((await review()).status).toBe(201)
    expect(h.created).toHaveLength(1)
  })

  it('sold to this caller and confirmed by them: allowed', async () => {
    h.listing = sold({ saleConfirmedAt: new Date() })
    expect((await review()).status).toBe(201)
  })

  it('⛔ sold to this caller but they said "No, I didn\'t buy it": refused', async () => {
    h.listing = sold({ saleDeclinedAt: new Date() })
    expect((await review()).status).toBe(403)
  })

  it('⛔ sold off-platform, or with no buyer named: refused — there is no eno buyer to be', async () => {
    h.listing = sold({ soldChannel: 'external', soldToProfileId: null })
    expect((await review()).status).toBe(403)
    h.listing = sold({ soldChannel: null, soldToProfileId: null })
    expect((await review()).status).toBe(403)
  })

  it('an offer accepted in THIS thread stands in for an unmarked sale, or one with nobody named', async () => {
    h.acceptedOffers = 1
    h.listing = { status: 'active' }
    expect((await review()).status).toBe(201)
    h.listing = sold({ soldChannel: null, soldToProfileId: null })
    expect((await review()).status).toBe(201)
  })

  // Refute review 2026-10-23: an accepted offer is never revoked, so it must not outvote a sale record that says otherwise.
  it.each([
    ['sold to someone else (awaiting their answer)', { soldToProfileId: 'buyer-2' }],
    ['sold to someone else, who confirmed', { soldToProfileId: 'buyer-2', saleConfirmedAt: new Date() }],
    ['sold to this caller, who answered "No, I didn\'t buy it"', { saleDeclinedAt: new Date() }],
    ['sold to "someone not on eno"', { soldChannel: 'external', soldToProfileId: null }],
  ])('⛔ an accepted offer does not count once the item is %s', async (_what, over) => {
    h.acceptedOffers = 1
    h.listing = sold(over)
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    expect(h.created).toEqual([])
  })
})
