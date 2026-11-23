import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POST /api/conversations/[id]/buy-now — the shop posts its "Buy now" button again (owner 2026-11-23) ──────────────────

const h = vi.hoisted(() => ({
  userId: 'shop-login' as string | null,
  gate: null as null | { error: string },
  convo: null as null | Record<string, unknown>,
  hidden: false,
  enoRun: true,
  blocked: false,
  buyUrl: 'https://go.isclix.com/deep_link/1/2' as string | null,
  inserts: [] as unknown[][],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId, email: 'x@y.z' } : null),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9 }) }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => h.gate }))
vi.mock('@/lib/db', () => ({ db: { conversation: { findUnique: async () => h.convo } } }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => h.hidden }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => h.blocked }))
vi.mock('@/lib/eno-run-partners', () => ({ isEnoRunPartner: () => h.enoRun }))
vi.mock('@/lib/partner-buy', () => ({ partnerBuyUrl: async () => h.buyUrl }))
vi.mock('@/lib/messages', () => ({ insertMessage: async (...a: unknown[]) => { h.inserts.push(a); return { id: 'm1', body: a[2], kind: 'partner_buy' } } }))

const { POST } = await import('./route')
const { PARTNER_BUY_LINE } = await import('@/lib/partner-welcome-line')

const call = async (id = 'c1') => {
  const res = await POST(new Request(`http://x/api/conversations/${id}/buy-now`, { method: 'POST' }), { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.userId = 'shop-login'; h.gate = null; h.hidden = false; h.enoRun = true; h.blocked = false
  h.buyUrl = 'https://go.isclix.com/deep_link/1/2'; h.inserts = []
  h.convo = { id: 'c1', buyerProfileId: 'cust', sellerProfileId: 'shop-login', listingId: 'L1', seller: { id: 's1', ownerId: 'shop-login', officialPartner: true } }
})

describe('buy-now', () => {
  it('the shop\'s login on its own thread: the fixed line, kind partner_buy — no URL written', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(h.inserts).toEqual([[
      { id: 'c1', buyerProfileId: 'cust', sellerProfileId: 'shop-login', listingId: 'L1' }, 'shop-login', PARTNER_BUY_LINE, { kind: 'partner_buy' },
    ]])
    expect(JSON.stringify(h.inserts)).not.toContain('isclix')
  })

  it.each([
    ['the customer', () => { h.userId = 'cust' }, 403],
    ['a stranger', () => { h.userId = 'someone' }, 403],
    ['the thread\'s seller side, no longer the storefront\'s login', () => { h.convo = { ...h.convo!, seller: { id: 's1', ownerId: 'new-owner', officialPartner: true } } }, 403],
    ['a storefront eno does not run', () => { h.enoRun = false }, 403],
    ['a suspended account', () => { h.gate = { error: 'account_suspended' } }, 403],
    ['a block between them', () => { h.blocked = true }, 403],
    ['no live buy link (sold / hidden / none)', () => { h.buyUrl = null }, 409],
    ['an unknown thread', () => { h.convo = null }, 404],
    ['a seller this edition hides', () => { h.hidden = true }, 404],
  ])('%s → refused, nothing written', async (_, set, status) => {
    set()
    expect((await call()).status).toBe(status)
    expect(h.inserts).toEqual([])
  })
})
