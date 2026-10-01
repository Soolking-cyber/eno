import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — AN OFFER ON A REMOVED LISTING (2026-10-01 review).
 *
 * A removed listing used to be hard-deleted and its conversations cascaded with it; an offer into such
 * a thread was a 404. Tombstones keep the thread (src/lib/listing-removed.ts), and the route tests
 * `negotiable` BEFORE `status` — so an offer on a removed FIXED-PRICE listing was answered
 * not_negotiable AND docked the buyer's trust (recordFixedPriceOfferAttempt). Pinned: a tombstone
 * refuses the offer as listing_unavailable with NO trust charge; plain text still goes through; an
 * ACTIVE fixed-price listing still refuses + docks (the CLAUDE.md landmine — unchanged).
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  convo: null as Row | null,
  docked: [] as string[],
  inserted: [] as Row[],
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'buyer-1', getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async () => 1 },
}))
vi.mock('@/lib/db', () => ({ db: { conversation: { findUnique: async () => h.convo } } }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async (id: string) => { h.docked.push(id) } }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _me: string, text: string, opts?: Row) => { h.inserted.push({ text, ...(opts ?? {}) }); return { id: 'm1', body: text } },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))

const { POST } = await import('./route')

const convoOn = (listing: Row) => ({ id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', sellerId: 's1', listing: { id: 'L1', ...listing } })
async function send(body: Row) {
  const res = await POST(new Request('https://eno.vn/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.convo = null; h.docked = []; h.inserted = [] })

describe('an offer on a removed listing', () => {
  it.each([false, true])('negotiable=%s → 409 listing_unavailable, and the buyer is NOT docked', async (negotiable) => {
    h.convo = convoOn({ negotiable, status: 'removed' })
    expect(await send({ offerAmount: 500000 })).toEqual({ status: 409, body: { error: 'listing_unavailable' } })
    expect(h.docked).toEqual([])
    expect(h.inserted).toEqual([])
  })

  it('plain text in the surviving thread still goes through', async () => {
    h.convo = convoOn({ negotiable: false, status: 'removed' })
    expect((await send({ body: 'Is this still available?' })).status).toBe(200)
    expect(h.inserted).toEqual([{ text: 'Is this still available?' }])
  })

  it('UNCHANGED: an active fixed-price listing still refuses the offer AND docks the buyer', async () => {
    h.convo = convoOn({ negotiable: false, status: 'active' })
    expect(await send({ offerAmount: 500000 })).toEqual({ status: 409, body: { error: 'not_negotiable' } })
    expect(h.docked).toEqual(['buyer-1'])
  })
})
