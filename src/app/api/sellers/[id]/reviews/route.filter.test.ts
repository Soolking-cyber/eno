import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sellers/[id]/reviews — the severe-only word filter (App Store gate `ugc-safety`, plan R5).
 * Off: unchanged. On: a review with a severe term is refused (400 objectionable_content) AFTER every
 * eligibility check — an ineligible caller still hears why they cannot review at all — and nothing is
 * written.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ created: [] as Row[], transacted: true }))

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
    conversation: { findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer-1', listing: { id: 'L1', sellerId: 'shop-1', status: h.transacted ? 'sold' : 'active' } }) },
    message: { count: async () => 0 },
    review: { create: async ({ data }: Row) => { h.created.push(data); return { id: 'r1' } } },
    // The removed-review guard (ugc-safety, R5 report half): no removal on record here.
    forumModerationAction: { findFirst: async () => null },
  },
}))

const { POST } = await import('./route')

async function review(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/sellers/shop-1/reviews', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'shop-1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.created = []; h.transacted = true })
afterEach(() => vi.unstubAllEnvs())

describe('the word filter on a review', () => {
  it('gate OFF: unchanged — the review is created', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await review({ conversationId: 'c1', rating: 1, text: 'heil hitler' })).status).toBe(201)
    expect(h.created).toHaveLength(1)
  })

  it('gate ON: a slur is refused and nothing is written', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await review({ conversationId: 'c1', rating: 1, text: 'cheating gook' })).toEqual({ status: 400, body: { error: 'objectionable_content' } })
    expect(h.created).toEqual([])
  })

  it('gate ON: an angry but clean review — and a rating with no text — go through', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect((await review({ conversationId: 'c1', rating: 1, text: 'Lừa đảo, hàng dỏm, đừng mua!' })).status).toBe(201)
    expect((await review({ conversationId: 'c1', rating: 2 })).status).toBe(201)
  })

  it('gate ON: eligibility is still answered first — no review is possible, so the filter never runs', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.transacted = false
    expect(await review({ conversationId: 'c1', rating: 1, text: 'I will kill you' })).toEqual({ status: 403, body: { error: 'not_transacted' } })
  })
})
