import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — the severe-only word filter (App Store gate `ugc-safety`,
 * plan R5). Off: nothing is scanned. On: a message or an offer's note with a severe term is refused
 * with 400 objectionable_content, nothing is inserted, and the send-idempotency claim is RELEASED (a
 * missed release would 409 the rephrased retry for five minutes). A support-desk thread is exempt on BOTH
 * sides: a victim must be able to quote what they were sent to the eno team, and staff to quote it back.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ me: 'buyer-1', convo: null as Row | null, inserted: [] as Row[], released: [] as string[], admin: null as string | null, docked: [] as string[] }))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => h.admin, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async (k: string) => { h.released.push(k) }, incrby: async () => 1 },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async (id: string) => { h.docked.push(id) } }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _me: string, text: string) => { h.inserted.push({ text }); return { id: 'm1', body: text } },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo },
    forumUserBlock: { findFirst: async () => null },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const { POST } = await import('./route')

async function send(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = 'buyer-1'; h.admin = null; h.inserted = []; h.released = []; h.docked = []
  h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', sellerId: 's1', listing: { id: 'L1', negotiable: true, status: 'active', listingType: 'sell' } }
})
afterEach(() => vi.unstubAllEnvs())

describe('the word filter on a chat message', () => {
  it('gate OFF: nothing is scanned — even a slur is delivered exactly as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await send({ body: 'you gook' })).status).toBe(200)
    expect(h.inserted).toEqual([{ text: 'you gook' }])
  })

  it('gate ON: refused, nothing written, the idempotency claim released for the rephrased retry', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await send({ body: 'I will kill you', clientId: 'cid-1' })).toEqual({ status: 400, body: { error: 'objectionable_content' } })
    expect(h.inserted).toEqual([])
    expect(h.released).toEqual(['msgid:c1:buyer-1:cid-1'])
  })

  it('gate ON: an offer’s note is a message too', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await send({ offerAmount: 500000, body: 'send nudes' })).toEqual({ status: 400, body: { error: 'objectionable_content' } })
    expect(h.inserted).toEqual([])
  })

  it('gate ON: the offer rules answer first — a fixed-price offer with a refused note is still docked', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = { ...h.convo, listing: { id: 'L1', negotiable: false, status: 'active', listingType: 'sell' } }
    expect(await send({ offerAmount: 500000, body: 'send nudes' })).toEqual({ status: 409, body: { error: 'not_negotiable' } })
    expect(h.docked).toEqual(['buyer-1'])
    expect(h.inserted).toEqual([])
  })

  it('gate ON: ordinary haggling — profanity included — goes through', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect((await send({ body: 'đ.m giá chát quá, bớt chút được không?' })).status).toBe(200)
    expect(h.inserted).toHaveLength(1)
  })

  it('gate ON: the support desk is exempt — the operator quoting a user…', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: null, sellerId: 'support', listing: null }
    h.me = 'operator'
    h.admin = 'support@eno.vn'
    expect((await send({ body: 'You wrote "I will kill you" — that is not allowed here.' })).status).toBe(200)
  })

  it('gate ON: …and the user telling the eno team what they were sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: null, sellerId: 'support', listing: null }
    h.me = 'buyer-1'
    expect((await send({ body: 'The seller wrote "I will kill you" after I asked for a refund.' })).status).toBe(200)
  })
})
