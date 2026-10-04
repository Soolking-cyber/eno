import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — a block (App Store gate `ugc-safety`, plan R3).
 * Off: nothing changes and no block lookup runs on this hot path. On: neither side can write into the
 * thread; the support desk (not a party to any block) still can.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ me: 'buyer-1', convo: null as Row | null, blocked: false, lookups: 0, inserted: [] as Row[], admin: null as string | null }))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => h.admin, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async () => 1 },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async () => {} }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _me: string, text: string) => { h.inserted.push({ text }); return { id: 'm1', body: text } },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
// The real gate check, a stubbed table: the gate decides whether the lookup runs at all.
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo },
    forumUserBlock: { findFirst: async () => { h.lookups++; return h.blocked ? { blockerProfileId: 'seller-1' } : null } },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const { POST } = await import('./route')

async function send(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = 'buyer-1'; h.admin = null; h.blocked = false; h.lookups = 0; h.inserted = []
  h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', sellerId: 's1', listing: { id: 'L1', negotiable: true, status: 'active', listingType: 'sell' } }
})
afterEach(() => vi.unstubAllEnvs())

describe('sending across a block', () => {
  it('gate OFF: a stored block changes nothing and is never even looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocked = true
    expect((await send({ body: 'hi' })).status).toBe(200)
    expect(h.lookups).toBe(0)
  })

  it('gate ON, no block: sends', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect((await send({ body: 'hi' })).status).toBe(200)
    expect(h.inserted).toEqual([{ text: 'hi' }])
  })

  it.each(['buyer-1', 'seller-1'])('gate ON, blocked: %s cannot write — 403 blocked, nothing inserted', async (me) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.me = me
    h.blocked = true
    expect(await send({ body: 'hi' })).toEqual({ status: 403, body: { error: 'blocked' } })
    expect(await send({ offerAmount: 100000 })).toEqual({ status: 403, body: { error: 'blocked' } })
    expect(h.inserted).toEqual([])
  })

  it('gate ON: the support desk is not a party to a block', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: null, sellerId: 'support', listing: null }
    h.me = 'operator'
    h.admin = 'support@eno.forum'
    h.blocked = true
    expect((await send({ body: 'How can we help?' })).status).toBe(200)
    expect(h.lookups).toBe(0)
  })
})
