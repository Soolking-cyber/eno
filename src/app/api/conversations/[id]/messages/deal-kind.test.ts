import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — ⛔ GATE ZERO FOR THE SERVICE-DEAL LINES (2026-11-11). 'deal_confirmed' and
 * 'deal_withdrawn' are written only by POST /api/conversations/[id]/deal. A client that sends `kind` here gets an ordinary
 * text message (the route builds its own options and never forwards a client kind), so a "✅ Rental confirmed" typed by
 * anyone is a plain bubble that opens no review card. insertMessage refuses a deal kind from anyone but the seller anyway
 * (src/lib/messages.deal-lines.test.ts).
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ me: 'seller-1', inserted: [] as Row[] }))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async () => 1 },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async () => {} }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _me: string, text: string, opts?: Row) => { h.inserted.push({ text, opts }); return { id: 'm1', body: text } },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', sellerId: 's1', listing: { id: 'L1', negotiable: true, status: 'active', listingType: 'rent' } }),
    },
    forumUserBlock: { findFirst: async () => null },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const { POST } = await import('./route')

const LINE = '✅ Đã xác nhận cho thuê · Rental confirmed'

async function send(body: Row, as: string) {
  h.me = as
  const res = await POST(new Request('https://eno.vn/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return res.status
}

beforeEach(() => { h.inserted = [] })

describe('⛔ a client cannot author a deal line', () => {
  it.each(['deal_confirmed', 'deal_withdrawn'])('kind %s from the client becomes plain text (no kind forwarded) — from either side', async (kind) => {
    for (const as of ['seller-1', 'buyer-1']) {
      expect(await send({ body: LINE, kind, meta: { forged: true } }, as)).toBe(200)
    }
    expect(h.inserted).toHaveLength(2)
    for (const m of h.inserted) {
      expect(m.text).toBe(LINE)
      expect(m.opts?.kind).toBeUndefined()
      expect(m.opts?.meta).toBeUndefined()
    }
  })
})
