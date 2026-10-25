import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sellers/[id]/reviews — WHO MAY REVIEW (sweep, 2026-10-22). "The listing is sold" let everyone who had asked
 * about a sold item post a "Verified buyer" review that feeds the seller's trust score: a losing bidder, the named buyer
 * who answered "No, I didn't buy this". Now (mayReviewDeal): the buyer the seller named, unless they said "No" — or an
 * accepted offer in THIS thread while the sale record does not contradict it — and never a listing taken down.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ created: [] as Row[], listing: {} as Row, accepted: 0 }))

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
    conversation: { findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer-1', listing: h.listing }) },
    message: { count: async ({ where }: Row) => (where.offerStatus === 'accepted' ? h.accepted : 0) },
    review: { create: async ({ data }: Row) => { h.created.push(data); return { id: 'r1' } } },
    forumModerationAction: { findFirst: async () => null },
  },
}))

const { POST } = await import('./route')

const sold = (patch: Row = {}): Row => ({
  id: 'L1', sellerId: 'shop-1', status: 'sold', complianceStatus: null, soldChannel: 'eno', soldToProfileId: 'buyer-1',
  soldAt: new Date('2026-10-01'), salePrice: null, saleConfirmedAt: new Date('2026-10-02'), saleDeclinedAt: null,
  saleBuyerHistory: null, saleConfirmPromptedAt: null, ...patch,
})

async function review() {
  const res = await POST(new Request('https://eno.vn/api/sellers/shop-1/reviews', { method: 'POST', body: JSON.stringify({ conversationId: 'c1', rating: 1 }) }) as never, { params: Promise.resolve({ id: 'shop-1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.created = []; h.accepted = 0 })

describe('review eligibility', () => {
  it('the named buyer may review — confirmed, or not answered yet (a block must not veto it, R3)', async () => {
    h.listing = sold()
    expect((await review()).status).toBe(201)
    h.listing = sold({ saleConfirmedAt: null })
    expect((await review()).status).toBe(201)
    expect(h.created).toHaveLength(2)
  })

  it.each([
    ['sold to SOMEONE ELSE', sold({ soldToProfileId: 'buyer-2' })],
    ['sold off eno', sold({ soldChannel: 'external', soldToProfileId: null, saleConfirmedAt: null })],
    ['sold with no buyer named', sold({ soldChannel: null, soldToProfileId: null, saleConfirmedAt: null })],
    ['the named buyer said "No, I didn\'t buy this"', sold({ saleConfirmedAt: null, saleDeclinedAt: new Date('2026-10-02') })],
    ['taken down after the sale', sold({ complianceStatus: 'taken_down' })],
  ])('⛔ %s → 403 not_transacted, nothing written', async (_label, listing) => {
    h.listing = listing
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    expect(h.created).toEqual([])
  })

  it('⛔ an accepted offer does not make a TAKEN-DOWN listing reviewable', async () => {
    h.listing = sold({ complianceStatus: 'taken_down' })
    h.accepted = 1
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
  })

  it('⛔ the named buyer who said "No, I didn\'t buy this" is taken at their word — an accepted offer does not override it', async () => {
    h.listing = sold({ saleConfirmedAt: null, saleDeclinedAt: new Date('2026-10-02') })
    h.accepted = 1
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
  })

  it('an accepted offer in this thread counts while the sale record does not contradict it — never over a sale to someone else', async () => {
    h.accepted = 1
    h.listing = sold({ status: 'active', soldChannel: null, soldToProfileId: null, soldAt: null, saleConfirmedAt: null })
    expect((await review()).status).toBe(201)
    h.listing = sold({ soldChannel: null, soldToProfileId: null, saleConfirmedAt: null })
    expect((await review()).status).toBe(201)
    h.listing = sold({ soldToProfileId: 'buyer-2' })
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
  })
})
