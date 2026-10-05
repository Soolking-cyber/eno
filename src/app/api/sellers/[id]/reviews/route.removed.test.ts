import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sellers/[id]/reviews — a review a moderator REMOVED does not come straight back (App Store gate
 * `ugc-safety`, plan R5). The takedown deletes the row (Review has no status column), which frees the
 * conversation's one-review slot; the moderation log remembers the deal, and a new review on it answers
 * `already_reviewed` — the code the review prompt already treats as "done". Not gated: a removal made while
 * the gate was on still holds when it is off; with none on record the route answers exactly as before.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ created: [] as Row[], removedNotes: [] as string[], lookups: 0 }))

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
    conversation: { findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer-1', listing: { id: 'L1', sellerId: 'shop-1', status: 'sold' } }) },
    message: { count: async () => 0 },
    review: { create: async ({ data }: Row) => { h.created.push(data); return { id: 'r2' } } },
    forumModerationAction: {
      findFirst: async ({ where }: Row) => {
        h.lookups++
        return h.removedNotes.find((n) => where.targetProfileId === 'buyer-1' && n.includes(where.note.contains)) ? { id: 'fma-1' } : null
      },
    },
  },
}))

const { POST } = await import('./route')
const { reviewRemovalNote } = await import('@/lib/reported-content')

async function review(conversationId = 'c1') {
  const res = await POST(new Request('https://www.eno.forum/api/sellers/shop-1/reviews', { method: 'POST', body: JSON.stringify({ conversationId, rating: 1, text: 'again' }) }) as never, { params: Promise.resolve({ id: 'shop-1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.created = []; h.removedNotes = []; h.lookups = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('a removed review cannot be re-posted on the same deal', () => {
  it('gate ON: after a moderator removal the slot answers already_reviewed and nothing is written', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.removedNotes = [reviewRemovalNote('r1', 'c1', 'case-1', 'mod@eno.vn')]
    expect(await review()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
    expect(h.created).toEqual([])
  })

  it('gate ON: the note matches the WHOLE conversation id — c1 does not block c12', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.removedNotes = [reviewRemovalNote('r1', 'c12', 'case-1', 'mod@eno.vn')]
    expect((await review('c1')).status).toBe(201)
  })

  it('gate OFF: a removal made while it was on still holds', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.removedNotes = [reviewRemovalNote('r1', 'c1', 'case-1', 'mod@eno.vn')]
    expect(await review()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
    expect(h.created).toEqual([])
  })

  it('gate OFF, nothing on record (every deal until the gate is ever on): created exactly as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await review()).status).toBe(201)
    expect(h.created).toHaveLength(1)
  })
})
